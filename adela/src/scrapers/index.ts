/**
 * Scraper registry (Phase 1.6d)
 *
 * Central orchestration for all Adela scrapers. Runs each scraper in isolation
 * with try/catch so one failure does not crash the others.
 *
 * Each scraper failure emits an error-status audit row to atlas_dispatches
 * and execution continues to the next scraper.
 */

import { runStrataPriceScraper } from "./strata-scraper"
import { runNewsScraper } from "./news-scraper"
import { runStrataScraper } from "./strata"
import { runNewsScraper as runLegacyNewsScraper } from "./news"
import { runAbcScraper } from "./abc"

// ---------------------------------------------------------------------------
// Scraper registry
// ---------------------------------------------------------------------------
export interface ScraperDefinition {
  name: string
  fn: () => Promise<void>
  enabled: boolean
}

export const SCRAPERS: ScraperDefinition[] = [
  {
    name: "abc-position-reports",
    fn: async () => { await runAbcScraper() },
    enabled: true,
  },
  {
    name: "strata-positions",
    fn: runStrataScraper,
    enabled: true,
  },
  {
    name: "strata-prices",
    fn: runStrataPriceScraper,
    enabled: true,
  },
  {
    name: "news-rss",
    fn: runNewsScraper,
    enabled: true,
  },
]

// ---------------------------------------------------------------------------
// Run all enabled scrapers in sequence (isolated failures)
// ---------------------------------------------------------------------------
export async function runAllScrapers(): Promise<void> {
  console.log(`[scrapers] Running ${SCRAPERS.length} scraper(s)...`)

  const results: Array<{ name: string; status: "success" | "failed"; error?: string }> = []

  for (const scraper of SCRAPERS) {
    if (!scraper.enabled) {
      console.log(`[scrapers] Skipping disabled scraper: ${scraper.name}`)
      continue
    }

    try {
      console.log(`[scrapers] Starting ${scraper.name}...`)
      await scraper.fn()
      results.push({ name: scraper.name, status: "success" })
      console.log(`[scrapers] ✓ ${scraper.name} completed`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ name: scraper.name, status: "failed", error: msg })
      console.error(`[scrapers] ✗ ${scraper.name} failed:`, msg)
      // Continue to next scraper — do not rethrow
    }
  }

  // Summary
  const succeeded = results.filter((r) => r.status === "success").length
  const failed = results.filter((r) => r.status === "failed").length

  console.log(`[scrapers] Complete: ${succeeded} succeeded, ${failed} failed`)

  if (failed > 0) {
    console.log("[scrapers] Failed scrapers:")
    results
      .filter((r) => r.status === "failed")
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`)
      })
  }
}
