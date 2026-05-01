/**
 * ABC Position Report scraper
 *
 * Source: https://www.almonds.org/tools-and-resources/crop-reports/position-reports
 * PDF pattern: /sites/default/files/YYYY-MM/YYYY.MM_PosRpt_XXXX.pdf
 *
 * Steps:
 *  1. Fetch index page, extract latest PDF href
 *  2. Check whether this report_date is already in position_reports (idempotent)
 *  3. Download PDF, store in Supabase Storage adela-raw/abc/
 *  4. Send to Gemini Pro for structured extraction (strict JSON schema)
 *  5. Validate with Zod, INSERT into position_reports
 *  6. Send WhatsApp notification
 */

import { load as cheerioLoad } from "cheerio"
import { z } from "zod"
import { supabase } from "../supabase.js"
import { extractPdfJson } from "../gemini.js"
import { notifyWhatsApp } from "../notify.js"
import { startRun, finishRun } from "../audit.js"
import { config } from "../config.js"

// ---------------------------------------------------------------------------
// Zod schema for Gemini extraction output
// ---------------------------------------------------------------------------
const VarietySchema = z.object({
  variety: z.string(),
  shipments_lbs: z.number().nullable(),
  inventory_lbs: z.number().nullable(),
})

const ExtractionSchema = z.object({
  report_date: z.string().describe("ISO date YYYY-MM-DD for the month this report covers"),
  total_shipments_lbs: z.number().nullable(),
  total_inventory_lbs: z.number().nullable(),
  domestic_shipments_lbs: z.number().nullable(),
  export_shipments_lbs: z.number().nullable(),
  crop_year: z.string().nullable().describe("e.g. '2025-2026'"),
  by_variety: z.array(VarietySchema).nullable(),
  notes: z.string().nullable().describe("Any notable caveats or corrections mentioned"),
})

type Extraction = z.infer<typeof ExtractionSchema>

// Gemini JSON schema (OpenAPI-subset understood by the SDK)
const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    report_date: { type: "string", description: "ISO date YYYY-MM-DD for the month the report covers" },
    total_shipments_lbs: { type: "number", nullable: true },
    total_inventory_lbs: { type: "number", nullable: true },
    domestic_shipments_lbs: { type: "number", nullable: true },
    export_shipments_lbs: { type: "number", nullable: true },
    crop_year: { type: "string", nullable: true, description: "e.g. 2025-2026" },
    by_variety: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          variety: { type: "string" },
          shipments_lbs: { type: "number", nullable: true },
          inventory_lbs: { type: "number", nullable: true },
        },
        required: ["variety"],
      },
    },
    notes: { type: "string", nullable: true },
  },
  required: ["report_date", "total_shipments_lbs", "total_inventory_lbs"],
}

const EXTRACTION_PROMPT = `
You are a precise data extractor for the Almond Board of California (ABC) monthly Position Report.

Extract EXACTLY these fields from the PDF:
- report_date: The ISO date (YYYY-MM-DD) for the first day of the month this report covers
- total_shipments_lbs: Total shipments in pounds (sum of all markets) for the month
- total_inventory_lbs: Total inventory/position held at end of period in pounds
- domestic_shipments_lbs: Domestic (USA) shipments in pounds
- export_shipments_lbs: Export shipments in pounds (total of all export markets)
- crop_year: The crop year string (e.g. "2025-2026")
- by_variety: Array of {variety, shipments_lbs, inventory_lbs} for each almond variety listed
- notes: Any correction notices or footnotes in the report (null if none)

IMPORTANT rules:
- All weight values are in POUNDS. If the report shows numbers in thousands, multiply by 1000.
- If a value is not present in the report, return null for that field.
- Return ONLY valid JSON matching the schema. Do not add explanatory text.
`.trim()

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  attempts = config.abc.retryAttempts
): Promise<Response> {
  const headers = {
    "User-Agent": config.abc.userAgent,
    Accept: "text/html,application/pdf,*/*",
    ...((opts.headers as Record<string, string>) ?? {}),
  }

  let lastErr: Error | null = null
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { ...opts, headers })
      if (res.ok) return res
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (i < attempts) {
        const delay = config.abc.retryDelayMs * Math.pow(2, i - 1)
        console.warn(`[abc] Attempt ${i} failed, retrying in ${delay}ms:`, lastErr.message)
        await sleep(delay)
      }
    }
  }
  throw lastErr!
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Parse index page to find latest PDF href
// ---------------------------------------------------------------------------
function extractLatestPdfHref(html: string): string | null {
  const $ = cheerioLoad(html)

  // Look for .pdf links anywhere on the page (newest will be first in the listing)
  const pdfLinks: string[] = []
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? ""
    if (href.toLowerCase().includes(".pdf") && href.toLowerCase().includes("posrpt")) {
      pdfLinks.push(href)
    }
  })

  if (pdfLinks.length === 0) return null

  // The index page lists newest first — return the first match
  return pdfLinks[0]
}

// Derive report_date from the PDF path — e.g. /sites/default/files/2026-04/2026.03_PosRpt_4435.pdf
// The filename prefix YYYY.MM is the reporting month.
function reportDateFromPdfPath(pdfPath: string): string | null {
  // Match YYYY.MM in filename portion
  const match = pdfPath.match(/\/(\d{4})\.(\d{2})_PosRpt/i)
  if (!match) return null
  return `${match[1]}-${match[2]}-01`
}

// ---------------------------------------------------------------------------
// Main scraper export
// ---------------------------------------------------------------------------
export async function runAbcScraper(): Promise<void> {
  const run = await startRun("abc")
  console.log(`[abc] Run ${run.id} started`)

  try {
    // 1. Fetch index page
    console.log("[abc] Fetching position reports index page...")
    const indexRes = await fetchWithRetry(config.abc.indexUrl)
    const html = await indexRes.text()

    const pdfHref = extractLatestPdfHref(html)
    if (!pdfHref) {
      throw new Error("Could not find any PDF links on the ABC position reports page")
    }

    const pdfUrl = pdfHref.startsWith("http")
      ? pdfHref
      : `${config.abc.baseUrl}${pdfHref}`
    console.log("[abc] Latest PDF URL:", pdfUrl)

    // 2. Derive report date and check for existing record
    const reportDate = reportDateFromPdfPath(pdfHref)
    if (!reportDate) {
      throw new Error(`Cannot derive report_date from PDF path: ${pdfHref}`)
    }

    // Resolve commodity_id for almonds
    const { data: commodity, error: commodityErr } = await supabase
      .from("commodities")
      .select("id")
      .eq("slug", "almonds")
      .single()

    if (commodityErr || !commodity) {
      throw new Error(`Cannot find 'almonds' commodity: ${commodityErr?.message}`)
    }

    const { data: existing } = await supabase
      .from("position_reports")
      .select("id")
      .eq("source", "ABC")
      .eq("report_date", reportDate)
      .eq("commodity_id", commodity.id)
      .maybeSingle()

    if (existing) {
      console.log(`[abc] Report for ${reportDate} already exists — skipping`)
      await finishRun(run.id, "skipped", { rows_skipped: 1 })
      return
    }

    // 3. Download PDF
    console.log("[abc] Downloading PDF...")
    const pdfRes = await fetchWithRetry(pdfUrl)
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())
    const pdfBase64 = pdfBuffer.toString("base64")

    // 4. Store raw PDF in Supabase Storage
    const storagePath = `${config.supabase.storagePrefix}/${reportDate}_PosRpt.pdf`
    const { error: storageErr } = await supabase.storage
      .from(config.supabase.storageBucket)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (storageErr) {
      // Non-fatal: log but continue — the parsed data is more important than the raw backup
      console.warn("[abc] Storage upload failed (non-fatal):", storageErr.message)
    }

    // 5. Extract structured data with Gemini Pro
    console.log("[abc] Sending PDF to Gemini for extraction...")
    let extracted: Extraction
    try {
      const raw = await extractPdfJson<unknown>(pdfBase64, EXTRACTION_PROMPT, GEMINI_SCHEMA)
      extracted = ExtractionSchema.parse(raw)
    } catch (geminiErr) {
      const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr)
      throw new Error(`Gemini extraction failed: ${msg}`)
    }

    console.log("[abc] Extraction result:", JSON.stringify(extracted, null, 2))

    // 6. INSERT into position_reports
    const { error: insertErr } = await supabase.from("position_reports").insert({
      commodity_id: commodity.id,
      source: "ABC",
      report_date: extracted.report_date ?? reportDate,
      report_url: pdfUrl,
      raw_pdf_storage_path: storageErr ? null : storagePath,
      extracted: extracted as Record<string, unknown>,
      total_shipments_lbs: extracted.total_shipments_lbs ?? null,
      total_inventory_lbs: extracted.total_inventory_lbs ?? null,
      domestic_shipments_lbs: extracted.domestic_shipments_lbs ?? null,
      export_shipments_lbs: extracted.export_shipments_lbs ?? null,
      ingested_by: "adela",
    })

    if (insertErr) {
      // Duplicate key = already existed (race condition) — treat as skipped
      if (insertErr.code === "23505") {
        console.log("[abc] Duplicate key — already ingested by another process")
        await finishRun(run.id, "skipped", { rows_skipped: 1 })
        return
      }
      throw new Error(`DB insert failed: ${insertErr.message}`)
    }

    // 7. WhatsApp notification
    const shipmentsM = extracted.total_shipments_lbs
      ? `${(extracted.total_shipments_lbs / 1_000_000).toFixed(1)}M lbs`
      : "N/A"
    const inventoryM = extracted.total_inventory_lbs
      ? `${(extracted.total_inventory_lbs / 1_000_000).toFixed(1)}M lbs`
      : "N/A"
    const month = new Date(extracted.report_date ?? reportDate + "T00:00:00Z")
      .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })

    await notifyWhatsApp(
      `📊 New ABC position report for ${month}. Shipments: ${shipmentsM}, Inventory: ${inventoryM}.`
    )

    await finishRun(run.id, "success", {
      rows_inserted: 1,
      metadata: { report_date: reportDate, pdf_url: pdfUrl },
    })
    console.log(`[abc] Done. Report for ${reportDate} ingested.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[abc] Scraper failed:", msg)
    await finishRun(run.id, "failed", { error_message: msg.slice(0, 2000) })
    // Rethrow so the scheduler's outer retry + scraper_errors dead-letter engage.
    throw err
  }
}
