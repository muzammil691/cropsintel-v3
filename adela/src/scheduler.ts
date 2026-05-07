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
 *
 * Graceful shutdown (phase-1.00e-rem):
 *   On SIGTERM / SIGINT the scheduler stops accepting new ticks, waits for any
 *   in-flight scraper to drain (bounded by config.scheduler.shutdownTimeoutMs)
 *   and then resolves. Railway sends SIGTERM on redeploy; without graceful
 *   shutdown an in-flight scrape can leave a half-written `adela_runs` row.
 */

import cron from "node-cron"
import { config } from "./config"
import { runAbcScraper } from "./scrapers/abc"
import { runStrataScraper } from "./scrapers/strata"
import { runNewsScraper } from "./scrapers/news"
import { logScraperError } from "./db"
import { markFinished, markStarted, registerScraper } from "./health"

type ScraperFn = () => Promise<unknown>

interface Job {
  name: string
  schedule: string
  run: ScraperFn
}

// CRON_SCHEDULE is the umbrella override (per phase-1.00e-rem spec). When set
// it overrides the abc schedule. SCRAPER_SCHEDULE and CRON_ABC remain as
// per-job overrides for backwards compatibility with earlier deployments.
const ABC_SCHEDULE =
  process.env.CRON_SCHEDULE ?? process.env.SCRAPER_SCHEDULE ?? config.cron.abc

const jobs: Job[] = [
  { name: "abc", schedule: ABC_SCHEDULE, run: runAbcScraper },
  { name: "strata", schedule: config.cron.strata, run: runStrataScraper },
  { name: "news", schedule: config.cron.news, run: runNewsScraper },
]

const inFlight = new Map<string, boolean>()
const tasks: cron.ScheduledTask[] = []
let shuttingDown = false

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

    const task = cron.schedule(job.schedule, async () => {
      if (shuttingDown) {
        console.log(`[scheduler] Shutdown in progress — skipping ${job.name} tick`)
        return
      }
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
    tasks.push(task)
    console.log(`[scheduler] Registered: ${job.name} @ ${job.schedule}`)
  }

  installShutdownHandlers()
}

/**
 * Stop accepting new ticks, drain in-flight jobs, then resolve.
 * Bounded by config.scheduler.shutdownTimeoutMs so a stuck scraper cannot
 * block container shutdown indefinitely.
 */
export async function stopScheduler(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log("[scheduler] Stopping cron tasks…")
  for (const task of tasks) {
    try {
      task.stop()
    } catch (err) {
      console.warn("[scheduler] task.stop() warning:", err)
    }
  }

  const deadline = Date.now() + config.scheduler.shutdownTimeoutMs
  while (Date.now() < deadline) {
    const stillRunning = Array.from(inFlight.entries())
      .filter(([, running]) => running)
      .map(([name]) => name)
    if (stillRunning.length === 0) {
      console.log("[scheduler] All jobs drained — shutdown complete")
      return
    }
    console.log(`[scheduler] Waiting on in-flight jobs: ${stillRunning.join(", ")}`)
    await sleep(500)
  }
  const stragglers = Array.from(inFlight.entries())
    .filter(([, running]) => running)
    .map(([name]) => name)
  if (stragglers.length > 0) {
    console.warn(
      `[scheduler] Shutdown timeout (${config.scheduler.shutdownTimeoutMs}ms) reached — abandoning: ${stragglers.join(", ")}`
    )
  }
}

let handlersInstalled = false
function installShutdownHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true

  const handle = (signal: NodeJS.Signals) => {
    console.log(`[scheduler] Received ${signal} — initiating graceful shutdown`)
    stopScheduler()
      .catch((err) => console.error("[scheduler] stopScheduler error:", err))
      .finally(() => {
        // Exit only after stopScheduler resolves. exitCode 0 means clean exit.
        process.exit(0)
      })
  }

  process.once("SIGTERM", handle)
  process.once("SIGINT", handle)
}

// Main execution block (phase-1.6b: run scheduler as standalone cron worker)
if (require.main === module) {
  console.log("[scheduler] Starting Adela scheduler — CropsIntel V3 cron worker")
  console.log("[scheduler] Time:", new Date().toISOString())

  startScheduler()

  console.log("[scheduler] Ready. Cron jobs armed.")

  // Keep process alive
  process.on("uncaughtException", (err) => {
    console.error("[scheduler] Uncaught exception:", err)
  })

  process.on("unhandledRejection", (reason) => {
    console.error("[scheduler] Unhandled rejection:", reason)
  })
}
