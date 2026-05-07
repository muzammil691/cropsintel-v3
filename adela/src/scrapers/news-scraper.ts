/**
 * News RSS scraper (Phase 1.6d)
 *
 * Pulls RSS feeds from Almond Board of California, Fresh Plaza, and ProduceReport.
 * Normalizes entries and upserts to news_items table.
 *
 * RSS field validation: title, link, pubDate must be non-null.
 * Malformed entries are logged as warnings and skipped.
 *
 * Writes audit to both:
 *   - adela_runs (existing pattern)
 *   - atlas_dispatches (new requirement)
 */

import { load as cheerioLoad } from "cheerio"
import { config } from "../config"
import { startRun, finishRun } from "../audit"
import {
  insertNewsItems,
  resolveCommodityId,
  type NewsItemRow,
} from "../db"
import { withRetry } from "../lib/retry"
import { supabase } from "../supabase"

// ---------------------------------------------------------------------------
// RSS feed configuration
// ---------------------------------------------------------------------------
const RSS_FEEDS = [
  {
    name: "Almond Board of California",
    url: "https://www.almonds.com/rss/news",
  },
  {
    name: "Fresh Plaza",
    url: "https://www.freshplaza.com/rss/news/31/Nuts",
  },
  {
    name: "ProduceReport",
    url: "https://www.theproducereport.com/category/almonds/feed",
  },
] as const

const MAX_AGE_DAYS = 30

// RSS/Atom field selectors
const RSS_SELECTORS = {
  item: "item, entry",
  title: "title",
  link: "link",
  pubDate: "pubDate, published, updated",
  description: "description, summary, content",
} as const

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------
async function fetchFeed(url: string): Promise<string> {
  return withRetry(
    async () => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": config.abc.userAgent,
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
      }
      return await res.text()
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1500,
      onRetry: (attempt, err) => {
        console.warn(`[news-scraper] Attempt ${attempt} failed:`, err.message)
      },
    }
  )
}

// ---------------------------------------------------------------------------
// Parse RSS/Atom feed
// ---------------------------------------------------------------------------
interface ParsedFeedItem {
  title: string
  link: string
  pubDate: string | null
  description: string | null
}

function parseFeed(xml: string): ParsedFeedItem[] {
  const $ = cheerioLoad(xml, { xmlMode: true })
  const items: ParsedFeedItem[] = []

  $(RSS_SELECTORS.item).each((_: number, el: any) => {
    const title = $(el).find(RSS_SELECTORS.title).first().text().trim()
    if (!title) {
      console.warn("[news-scraper] Skipping item with missing title")
      return
    }

    // Atom feeds use <link href="..."/>; RSS uses <link>url</link>
    let link = $(el).find(RSS_SELECTORS.link).first().attr("href") ?? ""
    if (!link) {
      link = $(el).find(RSS_SELECTORS.link).first().text().trim()
    }
    if (!link) {
      console.warn(`[news-scraper] Skipping item "${title}" with missing link`)
      return
    }

    const pubDate =
      $(el).find(RSS_SELECTORS.pubDate).first().text().trim() || null
    if (!pubDate) {
      console.warn(
        `[news-scraper] Skipping item "${title}" with missing pubDate`
      )
      return
    }

    const description =
      $(el).find(RSS_SELECTORS.description).first().text().trim() || null

    items.push({ title, link, pubDate, description })
  })

  return items
}

function parseDateLoose(input: string | null): Date | null {
  if (!input) return null
  const ts = Date.parse(input)
  if (Number.isNaN(ts)) return null
  return new Date(ts)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 64)
  }
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
      tool: "news-scraper",
      arguments: { phase: "phase-1.6d", scraper: "news-scraper" },
      result: {
        rows_upserted: rowsUpserted,
      },
      status,
      error_message: errorMessage ?? null,
      cost_usd: 0,
    })
  } catch (err) {
    console.error(
      "[news-scraper] Failed to write atlas_dispatches:",
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ---------------------------------------------------------------------------
// Main scraper export
// ---------------------------------------------------------------------------
export async function runNewsScraper(): Promise<void> {
  const run = await startRun("news-scraper")
  console.log(`[news-scraper] Run ${run.id} started for ${RSS_FEEDS.length} feed(s)`)

  try {
    const commodityId = await resolveCommodityId("almonds")
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000

    const allRows: NewsItemRow[] = []
    const feedErrors: string[] = []
    const validationWarnings: string[] = []

    for (const feed of RSS_FEEDS) {
      try {
        console.log(`[news-scraper] Fetching ${feed.name}: ${feed.url}`)
        const xml = await fetchFeed(feed.url)
        const items = parseFeed(xml)
        const feedHost = safeHost(feed.url)

        for (const item of items) {
          // Validate required fields
          if (!item.title || !item.link || !item.pubDate) {
            const warning = `Malformed entry from ${feed.name}: missing required field`
            validationWarnings.push(warning)
            console.warn(`[news-scraper] ${warning}`, {
              title: item.title,
              link: item.link,
              pubDate: item.pubDate,
            })
            continue
          }

          const dt = parseDateLoose(item.pubDate)
          const occurredAt = dt ?? new Date()

          // Skip items older than cutoff
          if (dt && dt.getTime() < cutoff) continue

          allRows.push({
            commodity_id: commodityId,
            source: feedHost,
            source_url: item.link,
            occurred_at: occurredAt.toISOString(),
            title: item.title.slice(0, 500),
            summary: item.description ? item.description.slice(0, 4000) : null,
            body: null,
            raw_payload: {
              feed_url: feed.url,
              feed_name: feed.name,
              pub_date_raw: item.pubDate,
              description_raw: item.description,
            },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[news-scraper] Feed failed: ${feed.name} — ${msg}`)
        feedErrors.push(`${feed.name}: ${msg}`)
      }
    }

    // If all feeds failed, this is a scraper failure
    if (allRows.length === 0 && feedErrors.length === RSS_FEEDS.length) {
      throw new Error(
        `All ${RSS_FEEDS.length} feed(s) failed. First error: ${feedErrors[0]}`
      )
    }

    // No new items is success, not failure
    if (allRows.length === 0) {
      await finishRun(run.id, "success", {
        rows_inserted: 0,
        metadata: {
          feeds: RSS_FEEDS.length,
          feed_errors: feedErrors,
          validation_warnings: validationWarnings.slice(0, 10),
        },
      })
      await writeAtlasDispatch("success", 0)
      console.log("[news-scraper] No new items in window — done")
      return
    }

    // Batch insert
    const result = await insertNewsItems(allRows)
    console.log(
      `[news-scraper] Inserted ${result.inserted}, skipped ${result.skipped}, errors ${result.errors.length}`
    )

    // Partial success is still success
    if (result.errors.length > 0 && result.inserted === 0) {
      throw new Error(`Insert errors: ${result.errors.slice(0, 3).join(" | ")}`)
    }

    await finishRun(run.id, "success", {
      rows_inserted: result.inserted,
      rows_skipped: result.skipped,
      metadata: {
        feeds: RSS_FEEDS.length,
        candidates: allRows.length,
        feed_errors: feedErrors,
        validation_warnings: validationWarnings.slice(0, 10),
      },
    })
    await writeAtlasDispatch("success", result.inserted)
    console.log("[news-scraper] Done.")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[news-scraper] Scraper failed:", msg)
    await finishRun(run.id, "failed", { error_message: msg.slice(0, 2000) })
    await writeAtlasDispatch("failed", 0, msg)
    throw err
  }
}
