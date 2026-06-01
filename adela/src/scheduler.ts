/**
 * Adela Scheduler (Phase 1.6e)
 *
 * Master cron orchestrator using node-cron. Coordinates four jobs in dependency order:
 *   - abc-scraper: Daily 06:00 UTC
 *   - strata-scraper: Daily 07:00 UTC
 *   - news-scraper: Every 4 hours
 *   - ai-analyst: Daily 08:00 UTC (runs after scrapers)
 *
 * Each job wrapped in try/catch with lifecycle logging to atlas_dispatches.
 * Individual job failures never crash the host process.
 *
 * Graceful shutdown (phase-1.00e-rem):
 *   On SIGTERM / SIGINT the scheduler stops accepting new ticks, waits for any
 *   in-flight scraper to drain (bounded by config.scheduler.shutdownTimeoutMs)
 *   and then resolves. Railway sends SIGTERM on redeploy; without graceful
 *   shutdown an in-flight scrape can leave a half-written `adela_runs` row.
 */

import cron from "node-cron"
import { config } from "./config"
import { supabase } from "./lib/supabase"
import { runAbcScraper } from "./scrapers/abc"
import { runStrataPriceScraper } from "./scrapers/strata-scraper"
import { runNewsScraper } from "./scrapers/news-scraper"
import { run as runAiAnalyst } from "./ai-analyst"
import { runPriceStalenessProbe } from "./probes/price-staleness"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobConfig {
  name: string
  schedule: string
  fn: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Last run tracking (for health endpoint)
// ---------------------------------------------------------------------------

export const lastRun: Record<string, string> = {}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const inFlight = new Map<string, boolean>()
const tasks: cron.ScheduledTask[] = []
let shuttingDown = false

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Job wrapper with lifecycle logging to atlas_dispatches
// ---------------------------------------------------------------------------

async function runJob(name: string, fn: () => Promise<void>): Promise<void> {
  const startTime = Date.now()
  console.log(`[scheduler] Starting job: ${name}`)

  // Write start event
  try {
    await supabase.from("atlas_dispatches").insert({
      trust_mode: "autonomous",
      initiated_by: "cron",
      tool: name,
      arguments: { phase: "phase-1.6e", scheduler: "adela-scheduler" },
      result: null,
      status: "pending",
      duration_ms: null,
      error_message: null,
    })
  } catch (err) {
    console.warn(`[scheduler] Failed to log start event for ${name}:`, err)
  }

  try {
    // Execute the job
    await fn()

    const duration = Date.now() - startTime
    console.log(`[scheduler] Job ${name} completed in ${duration}ms`)

    // Write complete event
    try {
      await supabase.from("atlas_dispatches").insert({
        trust_mode: "autonomous",
        initiated_by: "cron",
        tool: name,
        arguments: { phase: "phase-1.6e", scheduler: "adela-scheduler" },
        result: { status: "complete" },
        status: "success",
        duration_ms: duration,
        error_message: null,
        cost_usd: 0,
      })
    } catch (err) {
      console.warn(`[scheduler] Failed to log complete event for ${name}:`, err)
    }

    // Update lastRun timestamp
    lastRun[name] = new Date().toISOString()
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] Job ${name} failed after ${duration}ms:`, errorMessage)

    // Write error event
    try {
      await supabase.from("atlas_dispatches").insert({
        trust_mode: "autonomous",
        initiated_by: "cron",
        tool: name,
        arguments: { phase: "phase-1.6e", scheduler: "adela-scheduler" },
        result: null,
        status: "error",
        duration_ms: duration,
        error_message: errorMessage.slice(0, 2000),
        cost_usd: 0,
      })
    } catch (logErr) {
      console.error(`[scheduler] Failed to log error event for ${name}:`, logErr)
    }

    // DO NOT re-throw — individual job failures must not crash the scheduler
  }
}

// ---------------------------------------------------------------------------
// Job definitions
// ---------------------------------------------------------------------------

const jobs: JobConfig[] = [
  {
    name: "abc-scraper",
    schedule: "0 6 * * *", // Daily at 06:00 UTC
    fn: async () => {
      const result = await runAbcScraper()
      if (!result.success && !("skipped" in result)) {
        throw new Error(result.error)
      }
    },
  },
  {
    name: "strata-scraper",
    schedule: "0 7 * * *", // Daily at 07:00 UTC
    fn: runStrataPriceScraper,
  },
  {
    name: "news-scraper",
    schedule: "0 */4 * * *", // Every 4 hours
    fn: runNewsScraper,
  },
  {
    name: "ai-analyst",
    schedule: "0 8 * * *", // Daily at 08:00 UTC (after scrapers)
    fn: async () => {
      const result = await runAiAnalyst()
      if (result.status === "skipped") {
        console.log(`[scheduler] ai-analyst skipped: ${result.reason}`)
      }
    },
  },
]

// ---------------------------------------------------------------------------
// Price-staleness probe (phase-1.6g — remediation attempt 2)
//
// Deliberately scheduled OUTSIDE the `jobs` array so it bypasses `runJob` —
// the spec mandates this probe does NOT write to the DB, and `runJob`
// records start/complete/error events to `atlas_dispatches`. Hourly cron
// (`0 * * * *`), simple try/catch isolation, console logs only. No DB
// writes occur on this code path; the only Supabase call is a read-only
// `SELECT ingested_at FROM prices ORDER BY ingested_at DESC LIMIT 1`
// performed inside `runPriceStalenessProbe`.
// ---------------------------------------------------------------------------

const PRICE_STALENESS_SCHEDULE = "0 * * * *" // Hourly at the top of the hour

// ---------------------------------------------------------------------------
// Scheduler activation
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  console.log("[scheduler] Registering cron jobs...")

  for (const job of jobs) {
    // Validate cron expression
    if (!cron.validate(job.schedule)) {
      console.error(`[scheduler] Invalid cron expression for ${job.name}: ${job.schedule}`)
      continue
    }

    // Register the schedule
    const task = cron.schedule(job.schedule, async () => {
      if (shuttingDown) {
        console.log(`[scheduler] Shutdown in progress — skipping ${job.name} tick`)
        return
      }

      // Concurrency guard
      if (inFlight.get(job.name)) {
        console.log(`[scheduler] ${job.name} already in-flight — skipping this tick`)
        return
      }

      inFlight.set(job.name, true)
      try {
        await runJob(job.name, job.fn)
      } catch (err) {
        // runJob should never throw; this is the last safety net
        console.error(`[scheduler] Unhandled error in ${job.name}:`, err)
      } finally {
        inFlight.set(job.name, false)
      }
    })

    tasks.push(task)
    console.log(`[scheduler] Registered ${job.name} with schedule: ${job.schedule}`)
  }

  // Register the price-staleness probe separately so it bypasses runJob
  // (spec: probe must NOT write to atlas_dispatches or any other table).
  if (!cron.validate(PRICE_STALENESS_SCHEDULE)) {
    console.error(
      `[scheduler] Invalid cron expression for price-staleness-probe: ${PRICE_STALENESS_SCHEDULE}`
    )
  } else {
    const probeTask = cron.schedule(PRICE_STALENESS_SCHEDULE, async () => {
      if (shuttingDown) {
        console.log("[scheduler] Shutdown in progress — skipping price-staleness-probe tick")
        return
      }
      if (inFlight.get("price-staleness-probe")) {
        console.log(
          "[scheduler] price-staleness-probe already in-flight — skipping this tick"
        )
        return
      }
      inFlight.set("price-staleness-probe", true)
      const startTime = Date.now()
      console.log("[scheduler] Starting job: price-staleness-probe")
      try {
        await runPriceStalenessProbe()
        const duration = Date.now() - startTime
        console.log(`[scheduler] Job price-staleness-probe completed in ${duration}ms`)
        lastRun["price-staleness-probe"] = new Date().toISOString()
      } catch (err) {
        const duration = Date.now() - startTime
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(
          `[scheduler] Job price-staleness-probe failed after ${duration}ms:`,
          errorMessage
        )
      } finally {
        inFlight.set("price-staleness-probe", false)
      }
    })
    tasks.push(probeTask)
    console.log(
      `[scheduler] Registered price-staleness-probe with schedule: ${PRICE_STALENESS_SCHEDULE}`
    )
  }

  console.log(`[scheduler] ${jobs.length + 1} cron job(s) registered`)
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
