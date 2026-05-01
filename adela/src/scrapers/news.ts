/**
 * News-RSS scraper
 *
 * Pulls items from one or more agricultural-news RSS/Atom feeds. Feed URLs
 * are configured externally (selectors.json or NEWS_FEEDS env var) so adding
 * a feed never requires a code change.
 *
 * Feed list resolution order:
 *   1. NEWS_FEEDS env var (comma-separated URLs) — production override
 *   2. selectors.json `news.feeds` array — checked-in defaults
 *
 * Items older than `maxAgeDays` are skipped. Idempotent via the
 * (source, source_url) unique index on news_items.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { load as cheerioLoad } from "cheerio"
import { config } from "../config.js"
import { startRun, finishRun } from "../audit.js"
import {
  insertNewsItems,
  resolveCommodityId,
  type NewsItemRow,
} from "../db.js"

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const selectorsPath = path.resolve(__dirname, "./selectors.json")

interface NewsConfig {
  feeds: string[]
  maxAgeDays: number
  selectors: {
    item: string
    title: string
    link: string
    pubDate: string
    description: string
  }
}

function loadConfig(): NewsConfig {
  const raw = readFileSync(selectorsPath, "utf-8")
  const parsed = JSON.parse(raw) as { news: NewsConfig }
  const fileFeeds = parsed.news.feeds ?? []
  const envFeeds = (process.env.NEWS_FEEDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return {
    ...parsed.news,
    feeds: envFeeds.length > 0 ? envFeeds : fileFeeds,
  }
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------
async function fetchFeed(url: string): Promise<string> {
  let lastErr: Error | null = null
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": config.abc.userAgent,
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return await res.text()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (i < 3) {
        await sleep(1500 * Math.pow(2, i - 1))
      }
    }
  }
  throw lastErr!
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface ParsedItem {
  title: string
  link: string
  pubDate: string | null
  description: string | null
}

function parseFeed(xml: string, sel: NewsConfig["selectors"]): ParsedItem[] {
  const $ = cheerioLoad(xml, { xmlMode: true })
  const items: ParsedItem[] = []

  $(sel.item).each((_, el) => {
    const title = $(el).find(sel.title).first().text().trim()
    if (!title) return

    // Atom feeds use <link href="..."/>; RSS uses <link>url</link>.
    let link = $(el).find(sel.link).first().attr("href") ?? ""
    if (!link) {
      link = $(el).find(sel.link).first().text().trim()
    }
    if (!link) return

    const pubDate = $(el).find(sel.pubDate).first().text().trim() || null
    const description = $(el).find(sel.description).first().text().trim() || null

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

// ---------------------------------------------------------------------------
// Main scraper export
// ---------------------------------------------------------------------------
export async function runNewsScraper(): Promise<void> {
  const cfg = loadConfig()

  if (cfg.feeds.length === 0) {
    console.log("[news] No feeds configured (NEWS_FEEDS env var or selectors.json) — skipping run")
    const run = await startRun("news").catch(() => null)
    if (run) {
      await finishRun(run.id, "skipped", {
        rows_skipped: 0,
        metadata: { reason: "no_feeds_configured" },
      })
    }
    return
  }

  const run = await startRun("news")
  console.log(`[news] Run ${run.id} started for ${cfg.feeds.length} feed(s)`)

  try {
    const commodityId = await resolveCommodityId("almonds")
    const cutoff = Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000

    const allRows: NewsItemRow[] = []
    const feedErrors: string[] = []

    for (const feedUrl of cfg.feeds) {
      try {
        const xml = await fetchFeed(feedUrl)
        const items = parseFeed(xml, cfg.selectors)
        const feedHost = safeHost(feedUrl)

        for (const item of items) {
          const dt = parseDateLoose(item.pubDate)
          const occurredAt = dt ?? new Date()
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
              feed_url: feedUrl,
              pub_date_raw: item.pubDate,
              description_raw: item.description,
            },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[news] Feed failed: ${feedUrl} — ${msg}`)
        feedErrors.push(`${feedUrl}: ${msg}`)
      }
    }

    if (allRows.length === 0) {
      const allFeedsFailed = feedErrors.length === cfg.feeds.length
      if (allFeedsFailed) {
        throw new Error(
          `All ${cfg.feeds.length} feed(s) failed. First error: ${feedErrors[0]}`
        )
      }
      await finishRun(run.id, "success", {
        rows_inserted: 0,
        metadata: { feeds: cfg.feeds.length, feed_errors: feedErrors },
      })
      console.log("[news] No new items in window — done")
      return
    }

    const result = await insertNewsItems(allRows)
    console.log(
      `[news] Inserted ${result.inserted}, skipped ${result.skipped}, errors ${result.errors.length}`
    )

    if (result.errors.length > 0 && result.inserted === 0) {
      throw new Error(`Insert errors: ${result.errors.slice(0, 3).join(" | ")}`)
    }

    await finishRun(run.id, "success", {
      rows_inserted: result.inserted,
      rows_skipped: result.skipped,
      metadata: {
        feeds: cfg.feeds.length,
        candidates: allRows.length,
        feed_errors: feedErrors,
      },
    })
    console.log("[news] Done.")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[news] Scraper failed:", msg)
    await finishRun(run.id, "failed", { error_message: msg.slice(0, 2000) })
    throw err
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 64)
  }
}
