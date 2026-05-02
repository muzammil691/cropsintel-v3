/**
 * Adela cron scheduler
 *
 * Wraps each scraper with:
 *   1. Concurrency lock — never run two ticks of the same job in parallel
 *   2. Health-state updates (markStarted / markFinished) so /health is fresh
 *   3. Outer retry up to config.scheduler.maxAttempts on thrown errors
 *   4. Dead-letter to scraper_errors when all attempts fail
 *
 * Each scraper's *internal* fetch retries (fetchWithRetry) handle transient
 * HTTP issues. The outer retry here is for whole-run failures (parse errors,
 * DB issues, etc.).
 */

import cron from "node-cron"
import { config } from "./config.js"
import { runAbcScraper } from "./scrapers/abc.js"
import { runStrataScraper } from "./scrapers/strata.js"
import { runNewsScraper } from "./scrapers/news.js"
import { logScraperError } from "./db.js"
import { markFinished, markStarted, registerScraper } from "./health.js"

type ScraperFn = () => Promise<unknown>

interface Job {
  name: string
  schedule: string
  run: ScraperFn
}

// SCRAPER_SCHEDULE is the umbrella override (per phase-1.00e-rem spec). When
// set it overrides the abc schedule; CRON_ABC remains as a per-job override
// for backwards compatibility with earlier deployments.
const ABC_SCHEDULE = process.env.SCRAPER_SCHEDULE ?? config.cron.abc

const jobs: Job[] = [
  { name: "abc", schedule: ABC_SCHEDULE, run: runAbcScraper },
  { name: "strata", schedule: config.cron.strata, run: runStrataScraper },
  { name: "news", schedule: config.cron.news, run: runNewsScraper },
]

const inFlight = new Map<string, boolean>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runWithRetries(job: Job): Promise<void> {
  if (inFlight.get(job.name)) {
    console.log(`[scheduler] ${job.name} already in-flight — skipping this tick`)
    return
  }
  inFlight.set(job.name, true)
  markStarted(job.name)

  let attempt = 0
  let lastErr: Error | null = null

  while (attempt < config.scheduler.maxAttempts) {
    attempt++
    try {
      await job.run()
      markFinished(job.name, "success")
      inFlight.set(job.name, false)
      return
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      console.warn(
        `[scheduler] ${job.name} attempt ${attempt}/${config.scheduler.maxAttempts} failed: ${lastErr.message}`
      )
      if (attempt < config.scheduler.maxAttempts) {
        await sleep(config.scheduler.retryDelayMs * attempt)
      }
    }
  }

  // All attempts exhausted — dead-letter to scraper_errors
  const message = lastErr ? lastErr.message : "unknown error"
  markFinished(job.name, "failed", message)
  await logScraperError({
    scraper: job.name,
    error_message: message,
    attempt,
    context: { schedule: job.schedule, max_attempts: config.scheduler.maxAttempts },
  }).catch((err) => {
    console.error(`[scheduler] Failed to dead-letter ${job.name}:`, err)
  })
  inFlight.set(job.name, false)
}

export function startScheduler(): void {
  for (const job of jobs) {
    registerScraper(job.name, job.schedule)

    cron.schedule(job.schedule, async () => {
      console.log(`[scheduler] Tick: ${job.name}`)
      try {
        await runWithRetries(job)
      } catch (err) {
        // runWithRetries should never throw; this is the last safety net
        console.error(`[scheduler] Unhandled error in ${job.name}:`, err)
        markFinished(job.name, "failed", String(err))
        inFlight.set(job.name, false)
      }
      console.log(`[scheduler] Done: ${job.name}`)
    })
    console.log(`[scheduler] Registered: ${job.name} @ ${job.schedule}`)
  }
}
