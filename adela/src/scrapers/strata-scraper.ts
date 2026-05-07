/**
 * Strata price scraper (Phase 1.6d)
 *
 * Fetches the Strata almond price sheet and parses prices by variety × form × grade.
 * Distinct from strata.ts which handles POSITIONS — this handles PRICES.
 *
 * Writes audit to both:
 *   - adela_runs (existing pattern)
 *   - atlas_dispatches (new requirement)
 *
 * Uses the canonical retry utility from @/lib/retry.ts
 */

import { load as cheerioLoad } from "cheerio"
import { config } from "../config"
import { startRun, finishRun } from "../audit"
import {
  insertPrices,
  resolveCommodityId,
  type PriceRow,
} from "../db"
import { withRetry } from "../lib/retry"
import { supabase } from "../supabase"

// ---------------------------------------------------------------------------
// CSS Selector config (externalized — never inline selectors in parse logic)
// ---------------------------------------------------------------------------
const STRATA_PRICE_SELECTORS = {
  priceTable: "table.prices, table.price-sheet, table[data-type='prices']",
  priceRow: "tr.price-row, tr[data-type='price']",
  variety: "td.variety, td[data-field='variety']",
  form: "td.form, td.product-type, td[data-field='form']",
  grade: "td.grade, td.size, td[data-field='grade']",
  price: "td.price, td.usd-per-lb, td[data-field='price']",
} as const

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------
async function fetchPriceSheet(url: string, authHeader?: string): Promise<string> {
  return withRetry(
    async () => {
      const headers: Record<string, string> = {
        "User-Agent": config.abc.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
      if (authHeader) {
        headers.Cookie = authHeader
      }

      const res = await fetch(url, { headers })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
      }
      return await res.text()
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1500,
      onRetry: (attempt, err) => {
        console.warn(`[strata-scraper] Attempt ${attempt} failed:`, err.message)
      },
    }
  )
}

// ---------------------------------------------------------------------------
// Parse prices HTML
// ---------------------------------------------------------------------------
function parsePricesHtml(
  html: string,
  commodityId: string,
  sourceUrl: string
): PriceRow[] {
  const $ = cheerioLoad(html)
  const rows: PriceRow[] = []
  const occurredAt = new Date().toISOString()

  // Try multiple selector strategies (Strata structure may vary)
  const tableSelector = STRATA_PRICE_SELECTORS.priceTable
  const rowSelector = STRATA_PRICE_SELECTORS.priceRow

  $(tableSelector).each((_: number, table: any) => {
    $(table)
      .find(rowSelector)
      .each((_: number, el: any) => {
        const variety = $(el).find(STRATA_PRICE_SELECTORS.variety).text().trim() || null
        const form = $(el).find(STRATA_PRICE_SELECTORS.form).text().trim() || null
        const grade = $(el).find(STRATA_PRICE_SELECTORS.grade).text().trim() || null
        const priceText = $(el).find(STRATA_PRICE_SELECTORS.price).text().trim()

        const price = parsePrice(priceText)
        if (price == null) return

        rows.push({
          commodity_id: commodityId,
          source: "Strata",
          source_url: sourceUrl,
          occurred_at: occurredAt,
          variety,
          product_type: form,
          size_grade: grade,
          price_per_lb_usd: price,
          currency: "USD",
          raw_payload: {
            variety,
            form,
            grade,
            raw_price_text: priceText,
          },
        })
      })
  })

  // Fallback: if no structured table, try generic table parsing
  if (rows.length === 0) {
    $("table tr").each((_: number, el: any) => {
      const cells = $(el).find("td")
      if (cells.length < 3) return

      const variety = cells.eq(0).text().trim() || null
      const form = cells.eq(1).text().trim() || null
      const priceText = cells.eq(cells.length - 1).text().trim()

      const price = parsePrice(priceText)
      if (price == null) return

      rows.push({
        commodity_id: commodityId,
        source: "Strata",
        source_url: sourceUrl,
        occurred_at: occurredAt,
        variety,
        product_type: form,
        size_grade: null,
        price_per_lb_usd: price,
        currency: "USD",
        raw_payload: {
          variety,
          form,
          raw_price_text: priceText,
          fallback_parse: true,
        },
      })
    })
  }

  return rows
}

function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "").trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------------------
// Atlas dispatch logging
// ---------------------------------------------------------------------------
async function writeAtlasDispatch(
  status: "success" | "failed",
  rowsUpserted: number,
  errorMessage?: string
): Promise<void> {
  try {
    await supabase.from("atlas_dispatches").insert({
      trust_mode: "autonomous",
      initiated_by: "cron",
      tool: "strata-price-scraper",
      arguments: { phase: "phase-1.6d", scraper: "strata-scraper" },
      result: {
        rows_upserted: rowsUpserted,
      },
      status,
      error_message: errorMessage ?? null,
      cost_usd: 0,
    })
  } catch (err) {
    console.error(
      "[strata-scraper] Failed to write atlas_dispatches:",
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ---------------------------------------------------------------------------
// Main scraper export
// ---------------------------------------------------------------------------
export async function runStrataPriceScraper(): Promise<void> {
  const priceSheetUrl = process.env.STRATA_PRICE_SHEET_URL

  if (!priceSheetUrl) {
    console.log(
      "[strata-scraper] STRATA_PRICE_SHEET_URL not set — skipping price scraper run"
    )
    const run = await startRun("strata-price-scraper").catch(() => null)
    if (run) {
      await finishRun(run.id, "skipped", {
        rows_skipped: 0,
        metadata: { reason: "credentials_not_set" },
      })
    }
    await writeAtlasDispatch("success", 0)
    return
  }

  const run = await startRun("strata-price-scraper")
  console.log(`[strata-scraper] Run ${run.id} started`)

  try {
    const commodityId = await resolveCommodityId("almonds")

    // Fetch the price sheet
    console.log("[strata-scraper] Fetching price sheet:", priceSheetUrl)
    const html = await fetchPriceSheet(priceSheetUrl)

    // Parse prices
    const rows = parsePricesHtml(html, commodityId, priceSheetUrl)

    if (rows.length === 0) {
      console.warn(
        "[strata-scraper] Parsed 0 price rows — selectors may have drifted"
      )
      await finishRun(run.id, "success", {
        rows_inserted: 0,
        metadata: { reason: "zero_rows_parsed" },
      })
      await writeAtlasDispatch("success", 0)
      return
    }

    // Batch insert
    const result = await insertPrices(rows)
    console.log(
      `[strata-scraper] Inserted ${result.inserted}, skipped ${result.skipped}, errors ${result.errors.length}`
    )

    if (result.errors.length > 0) {
      throw new Error(`Insert errors: ${result.errors.slice(0, 3).join(" | ")}`)
    }

    await finishRun(run.id, "success", {
      rows_inserted: result.inserted,
      rows_skipped: result.skipped,
      metadata: { price_sheet_url: priceSheetUrl },
    })
    await writeAtlasDispatch("success", result.inserted)
    console.log("[strata-scraper] Done.")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[strata-scraper] Scraper failed:", msg)
    await finishRun(run.id, "failed", { error_message: msg.slice(0, 2000) })
    await writeAtlasDispatch("failed", 0, msg)
    throw err
  }
}
