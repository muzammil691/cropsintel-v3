/**
 * Strata position scraper
 *
 * Strata is a paid almond-trading intelligence platform. This scraper logs in
 * with username + password (env-driven, never hardcoded), fetches the latest
 * positions page, and parses position rows using selectors from
 * `selectors.json`.
 *
 * Behaviour without credentials:
 *   STRATA_BASE_URL / STRATA_USERNAME / STRATA_PASSWORD missing → log + skip.
 *   The scraper still completes successfully; it does NOT write to
 *   scraper_errors because absent credentials in non-production envs are
 *   expected, not a failure.
 *
 * Behaviour with credentials but on parse failure:
 *   Bubble error to scheduler → retried up to N times → dead-letter to
 *   scraper_errors.
 */

import { readFileSync } from "fs"
import path from "path"
import { load as cheerioLoad } from "cheerio"
import { config } from "../config"
import { startRun, finishRun } from "../audit"
import {
  insertPositions,
  resolveCommodityId,
  type PositionRow,
} from "../db"

// ---------------------------------------------------------------------------
// Load selectors config (externalised — never hardcode HTML selectors)
// ---------------------------------------------------------------------------
const selectorsPath = path.resolve(__dirname, "./selectors.json")

interface StrataSelectors {
  loginPath: string
  positionsPath: string
  selectors: {
    row: string
    variety: string
    size: string
    long: string
    short: string
    open: string
    committed: string
  }
}

function loadSelectors(): StrataSelectors {
  const raw = readFileSync(selectorsPath, "utf-8")
  const parsed = JSON.parse(raw) as { strata: StrataSelectors }
  return parsed.strata
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  attempts = 3
): Promise<Response> {
  let lastErr: Error | null = null
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, opts)
      if (res.ok || res.status === 302 || res.status === 303) return res
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (i < attempts) {
        const delay = 1500 * Math.pow(2, i - 1)
        console.warn(`[strata] Attempt ${i} failed, retrying in ${delay}ms:`, lastErr.message)
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
// Login + cookie session
// ---------------------------------------------------------------------------
async function login(baseUrl: string, username: string, password: string, loginPath: string): Promise<string> {
  const body = new URLSearchParams({ username, password })
  const res = await fetchWithRetry(`${baseUrl}${loginPath}`, {
    method: "POST",
    body,
    headers: {
      "User-Agent": config.abc.userAgent,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
  })

  const cookies = res.headers.getSetCookie?.() ?? []
  if (cookies.length === 0) {
    throw new Error("Strata login did not return Set-Cookie — selectors/auth flow may have changed")
  }
  return cookies.map((c) => c.split(";")[0]).join("; ")
}

// ---------------------------------------------------------------------------
// Parse positions HTML using configurable selectors
// ---------------------------------------------------------------------------
function parsePositionsHtml(
  html: string,
  selectors: StrataSelectors["selectors"],
  commodityId: string,
  sourceUrl: string
): PositionRow[] {
  const $ = cheerioLoad(html)
  const rows: PositionRow[] = []
  const occurredAt = new Date().toISOString()

  $(selectors.row).each((_, el) => {
    const variety = $(el).find(selectors.variety).text().trim() || null
    const size = $(el).find(selectors.size).text().trim() || null

    const pushRow = (positionType: string, qtyText: string) => {
      const qty = parseLbs(qtyText)
      if (qty == null) return
      rows.push({
        commodity_id: commodityId,
        source: "Strata",
        source_url: sourceUrl,
        occurred_at: occurredAt,
        position_type: positionType,
        variety,
        size_grade: size,
        quantity_lbs: qty,
        raw_payload: { variety, size, position_type: positionType, raw_text: qtyText },
      })
    }

    pushRow("long", $(el).find(selectors.long).text())
    pushRow("short", $(el).find(selectors.short).text())
    pushRow("open", $(el).find(selectors.open).text())
    pushRow("committed", $(el).find(selectors.committed).text())
  })

  return rows
}

function parseLbs(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "").trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Main scraper export
// ---------------------------------------------------------------------------
export async function runStrataScraper(): Promise<void> {
  const baseUrl = process.env.STRATA_BASE_URL
  const username = process.env.STRATA_USERNAME
  const password = process.env.STRATA_PASSWORD

  if (!baseUrl || !username || !password) {
    console.log("[strata] Credentials not set (STRATA_BASE_URL/USERNAME/PASSWORD) — skipping run")
    const run = await startRun("strata").catch(() => null)
    if (run) {
      await finishRun(run.id, "skipped", {
        rows_skipped: 0,
        metadata: { reason: "credentials_not_set" },
      })
    }
    return
  }

  const run = await startRun("strata")
  console.log(`[strata] Run ${run.id} started`)

  try {
    const cfg = loadSelectors()
    const commodityId = await resolveCommodityId("almonds")

    // 1. Login
    console.log("[strata] Logging in…")
    const cookieHeader = await login(baseUrl, username, password, cfg.loginPath)

    // 2. Fetch positions page
    const positionsUrl = `${baseUrl}${cfg.positionsPath}`
    console.log("[strata] Fetching positions:", positionsUrl)
    const res = await fetchWithRetry(positionsUrl, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": config.abc.userAgent,
        Accept: "text/html,application/json,*/*",
      },
    })

    const contentType = res.headers.get("content-type") ?? ""
    let rows: PositionRow[] = []

    if (contentType.includes("application/json")) {
      // Future: structured JSON parse path (selector schema unknown until prod)
      const json = await res.json()
      rows = normaliseJsonPositions(json, commodityId, positionsUrl)
    } else {
      const html = await res.text()
      rows = parsePositionsHtml(html, cfg.selectors, commodityId, positionsUrl)
    }

    if (rows.length === 0) {
      console.warn("[strata] Parsed 0 position rows — selectors may have drifted")
      await finishRun(run.id, "success", {
        rows_inserted: 0,
        metadata: { reason: "zero_rows_parsed" },
      })
      return
    }

    // 3. Batch insert
    const result = await insertPositions(rows)
    console.log(
      `[strata] Inserted ${result.inserted}, skipped ${result.skipped}, errors ${result.errors.length}`
    )

    if (result.errors.length > 0) {
      throw new Error(`Insert errors: ${result.errors.slice(0, 3).join(" | ")}`)
    }

    await finishRun(run.id, "success", {
      rows_inserted: result.inserted,
      rows_skipped: result.skipped,
      metadata: { positions_url: positionsUrl },
    })
    console.log(`[strata] Done.`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[strata] Scraper failed:", msg)
    await finishRun(run.id, "failed", { error_message: msg.slice(0, 2000) })
    throw err
  }
}

function normaliseJsonPositions(
  json: unknown,
  commodityId: string,
  sourceUrl: string
): PositionRow[] {
  if (!Array.isArray(json)) return []
  const occurredAt = new Date().toISOString()
  const rows: PositionRow[] = []
  for (const entry of json as Array<Record<string, unknown>>) {
    const variety = (entry.variety as string | undefined) ?? null
    const size = (entry.size as string | undefined) ?? null
    for (const positionType of ["long", "short", "open", "committed"] as const) {
      const value = entry[`${positionType}_lbs`]
      const qty = typeof value === "number" ? value : null
      if (qty == null) continue
      rows.push({
        commodity_id: commodityId,
        source: "Strata",
        source_url: sourceUrl,
        occurred_at: occurredAt,
        position_type: positionType,
        variety,
        size_grade: size,
        quantity_lbs: qty,
        raw_payload: entry,
      })
    }
  }
  return rows
}
