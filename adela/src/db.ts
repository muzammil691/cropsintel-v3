/**
 * Adela DB write layer
 *
 * Provides:
 *   - resolveCommodityId(slug): cached lookup of commodities.id
 *   - insertPrices(rows), insertPositions(rows), insertNewsItems(rows)
 *       batched inserts; each splits the input into chunks to avoid Supabase
 *       request-size limits and reports per-chunk results
 *   - logScraperError({...}): write a row to scraper_errors after retries fail
 *
 * Every function is best-effort: it logs and resolves rather than throwing,
 * so the caller's audit + scraper_errors logging stays in control.
 */

import { supabase } from "./supabase"

const BATCH_SIZE = 200

// ---------------------------------------------------------------------------
// Commodity-id cache (slug -> uuid)
// ---------------------------------------------------------------------------
const commodityCache = new Map<string, string>()

export async function resolveCommodityId(slug: string): Promise<string> {
  const cached = commodityCache.get(slug)
  if (cached) return cached

  const { data, error } = await supabase
    .from("commodities")
    .select("id")
    .eq("slug", slug)
    .single()

  if (error || !data) {
    throw new Error(`Cannot resolve commodity slug '${slug}': ${error?.message ?? "not found"}`)
  }
  commodityCache.set(slug, data.id as string)
  return data.id as string
}

// ---------------------------------------------------------------------------
// Batched inserts
// ---------------------------------------------------------------------------
export interface PriceRow {
  commodity_id: string
  source: string
  source_url?: string | null
  occurred_at: string
  origin_country?: string | null
  destination_country?: string | null
  trade_basis?: string | null
  variety?: string | null
  product_type?: string | null
  size_grade?: string | null
  price_per_lb_usd?: number | null
  currency?: string
  raw_payload?: Record<string, unknown>
}

export interface PositionRow {
  commodity_id: string
  source?: string
  source_url?: string | null
  occurred_at: string
  position_type?: string | null
  variety?: string | null
  size_grade?: string | null
  quantity_lbs?: number | null
  raw_payload?: Record<string, unknown>
}

export interface NewsItemRow {
  commodity_id: string
  source: string
  source_url: string
  occurred_at: string
  title: string
  summary?: string | null
  body?: string | null
  raw_payload?: Record<string, unknown>
}

export interface BatchInsertResult {
  inserted: number
  skipped: number
  errors: string[]
}

async function batchInsert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  opts: { onConflict?: string } = {}
): Promise<BatchInsertResult> {
  const result: BatchInsertResult = { inserted: 0, skipped: 0, errors: [] }
  if (rows.length === 0) return result

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const query = supabase.from(table).insert(chunk, { count: "exact" })
    const { error, count } = opts.onConflict
      ? await supabase
          .from(table)
          .upsert(chunk, { onConflict: opts.onConflict, ignoreDuplicates: true, count: "exact" })
      : await query

    if (error) {
      // 23505 = duplicate key — count as skipped instead of error
      if (error.code === "23505") {
        result.skipped += chunk.length
        continue
      }
      result.errors.push(`${table} chunk ${i}: ${error.message}`)
      continue
    }
    result.inserted += count ?? chunk.length
  }
  return result
}

export function insertPrices(rows: PriceRow[]): Promise<BatchInsertResult> {
  return batchInsert("prices", rows as unknown as Record<string, unknown>[])
}

export function insertPositions(rows: PositionRow[]): Promise<BatchInsertResult> {
  return batchInsert("positions", rows as unknown as Record<string, unknown>[])
}

export function insertNewsItems(rows: NewsItemRow[]): Promise<BatchInsertResult> {
  return batchInsert("news_items", rows as unknown as Record<string, unknown>[], {
    onConflict: "source,source_url",
  })
}

// ---------------------------------------------------------------------------
// Dead-letter scraper_errors logging
// ---------------------------------------------------------------------------
export interface ScraperErrorPayload {
  scraper: string
  error_message: string
  attempt?: number
  context?: Record<string, unknown>
}

export async function logScraperError(payload: ScraperErrorPayload): Promise<void> {
  const { error } = await supabase.from("scraper_errors").insert({
    scraper: payload.scraper,
    error_message: payload.error_message.slice(0, 4000),
    attempt: payload.attempt ?? 1,
    context: payload.context ?? {},
  })
  if (error) {
    console.error(
      `[db] Failed to write scraper_errors row for ${payload.scraper}:`,
      error.message
    )
  }
}
