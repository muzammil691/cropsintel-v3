/**
 * Adela scheduler — master cron orchestrator.
 *
 * REGISTRATION SUMMARY (read this before editing):
 *   • Standard jobs (jobs[] array → runJob wrapper → writes atlas_dispatches):
 *       - abc-scraper       Daily 06:00 UTC
 *       - strata-scraper    Daily 07:00 UTC
 *       - news-scraper      Every 4 hours
 *       - ai-analyst        Daily 08:00 UTC
 *
 *   • Price-staleness probe (phase-1.6g):
 *       Cron: "0 * * * *"  (hourly at the top of the hour)
 *       Registered separately via `registerPriceStalenessProbe()` below.
 *       INTENTIONALLY BYPASSES `runJob` — spec mandates no DB writes; runJob
 *       writes start/complete/error rows to `atlas_dispatches`. The probe
 *       lives in a plain `cron.schedule(...)` with try/catch + console logs.
 *
 *   Test coverage (adela/src/probes/price-staleness.test.ts — 6 cases):
 *     1. empty prices table → stale, WhatsApp called once
 *     2. ingested_at = now()-7h → stale, WhatsApp called once
 *     3. ingested_at = now()-2h → fresh, WhatsApp NOT called
 *     4. fresh → stale → fresh → WhatsApp called exactly 2 times
 *     5. two consecutive stale cycles → WhatsApp called exactly 1 time
 *     6. notifyWhatsApp rejects → probe resolves; lastState still advances
 */
import cron from "node-cron"
import { config } from "./config"
import { supabase } from "./lib/supabase"
import { runAbcScraper } from "./scrapers/abc"
import { runStrataPriceScraper } from "./scrapers/strata-scraper"
import { runNewsScraper } from "./scrapers/news-scraper"
import { run as runAiAnalyst } from "./ai-analyst"
import { runPriceStalenessProbe } from "./probes/price-staleness"

// ─── Price-staleness probe registration (phase-1.6g) ─────────────────────────
// Hoisted to the top of the file so the cron expression and bypass-runJob
// pattern are visible at a glance. This block is the single source of truth
// for the probe's schedule; nothing else in this file schedules it.

const PRICE_STALENESS_SCHEDULE = "0 * * * *" // hourly, top of the hour

/** Register the hourly probe with cron. Does NOT go through runJob. */
function registerPriceStalenessProbe(
  inFlight: Map<string, boolean>,
  isShuttingDown: () => boolean,
  lastRunMap: Record<string, string>,
): cron.ScheduledTask | null {
  if (!cron.validate(PRICE_STALENESS_SCHEDULE)) {
    console.error(
      `[scheduler] Invalid cron expression for price-staleness-probe: ${PRICE_STALENESS_SCHEDULE}`,
    )
    return null
  }
  const task = cron.schedule(PRICE_STALENESS_SCHEDULE, async () => {
    if (isShuttingDown()) {
      console.log("[scheduler] Shutdown in progress — skipping price-staleness-probe tick")
      return
    }
    if (inFlight.get("price-staleness-probe")) {
      console.log("[scheduler] price-staleness-probe already in-flight — skipping this tick")
      return
    }
    inFlight.set("price-staleness-probe", true)
    const startTime = Date.now()
    console.log("[scheduler] Starting job: price-staleness-probe")
    try {
      await runPriceStalenessProbe()
      const duration = Date.now() - startTime
      console.log(`[scheduler] Job price-staleness-probe completed in ${duration}ms`)
      lastRunMap["price-staleness-probe"] = new Date().toISOString()
    } catch (err) {
      const duration = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(
        `[scheduler] Job price-staleness-probe failed after ${duration}ms:`,
        errorMessage,
      )
    } finally {
      inFlight.set("price-staleness-probe", false)
    }
  })
  console.log(
    `[scheduler] Registered price-staleness-probe with schedule: ${PRICE_STALENESS_SCHEDULE}`,
  )
  return task
}

// ─── Types & module state ────────────────────────────────────────────────────

interface JobConfig {
  name: string
  schedule: string
  fn: () => Promise<void>
}

export const lastRun: Record<string, string> = {}

const inFlight = new Map<string, boolean>()
const tasks: cron.ScheduledTask[] = []
let shuttingDown = false

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── runJob: wrapper for STANDARD jobs only — writes to atlas_dispatches ─────
// Phase 1.6g note: the price-staleness probe MUST NOT pass through this
// function. It is scheduled via registerPriceStalenessProbe() above.

async function runJob(name: string, fn: () => Promise<void>): Promise<void> {
  const startTime = Date.now()
  console.log(`[scheduler] Starting job: ${name}`)

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
    await fn()
    const duration = Date.now() - startTime
    console.log(`[scheduler] Job ${name} completed in ${duration}ms`)

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

    lastRun[name] = new Date().toISOString()
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] Job ${name} failed after ${duration}ms:`, errorMessage)

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
  }
}

// ─── Standard job definitions (these DO write to atlas_dispatches) ───────────

const jobs: JobConfig[] = [
  {
    name: "abc-scraper",
    schedule: "0 6 * * *",
    fn: async () => {
      const result = await runAbcScraper()
      if (!result.success && !("skipped" in result)) {
        throw new Error(result.error)
      }
    },
  },
  {
    name: "strata-scraper",
    schedule: "0 7 * * *",
    fn: runStrataPriceScraper,
  },
  {
    name: "news-scraper",
    schedule: "0 */4 * * *",
    fn: runNewsScraper,
  },
  {
    name: "ai-analyst",
    schedule: "0 8 * * *",
    fn: async () => {
      const result = await runAiAnalyst()
      if (result.status === "skipped") {
        console.log(`[scheduler] ai-analyst skipped: ${result.reason}`)
      }
    },
  },
]

// ─── Activation ──────────────────────────────────────────────────────────────

export function startScheduler(): void {
  console.log("[scheduler] Registering cron jobs...")

  // 1. Price-staleness probe FIRST — outside the jobs[] array, bypasses runJob.
  const probeTask = registerPriceStalenessProbe(inFlight, () => shuttingDown, lastRun)
  if (probeTask) tasks.push(probeTask)

  // 2. Standard jobs — registered via runJob (which writes atlas_dispatches).
  for (const job of jobs) {
    if (!cron.validate(job.schedule)) {
      console.error(`[scheduler] Invalid cron expression for ${job.name}: ${job.schedule}`)
      continue
    }
    const task = cron.schedule(job.schedule, async () => {
      if (shuttingDown) {
        console.log(`[scheduler] Shutdown in progress — skipping ${job.name} tick`)
        return
      }
      if (inFlight.get(job.name)) {
        console.log(`[scheduler] ${job.name} already in-flight — skipping this tick`)
        return
      }
      inFlight.set(job.name, true)
      try {
        await runJob(job.name, job.fn)
      } catch (err) {
        console.error(`[scheduler] Unhandled error in ${job.name}:`, err)
      } finally {
        inFlight.set(job.name, false)
      }
    })
    tasks.push(task)
    console.log(`[scheduler] Registered ${job.name} with schedule: ${job.schedule}`)
  }

  console.log(`[scheduler] ${jobs.length + (probeTask ? 1 : 0)} cron job(s) registered`)
  installShutdownHandlers()
}

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
      `[scheduler] Shutdown timeout (${config.scheduler.shutdownTimeoutMs}ms) reached — abandoning: ${stragglers.join(", ")}`,
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
        process.exit(0)
      })
  }

  process.once("SIGTERM", handle)
  process.once("SIGINT", handle)
}

if (require.main === module) {
  console.log("[scheduler] Starting Adela scheduler — CropsIntel V3 cron worker")
  console.log("[scheduler] Time:", new Date().toISOString())

  startScheduler()

  console.log("[scheduler] Ready. Cron jobs armed.")

  process.on("uncaughtException", (err) => {
    console.error("[scheduler] Uncaught exception:", err)
  })

  process.on("unhandledRejection", (reason) => {
    console.error("[scheduler] Unhandled rejection:", reason)
  })
}
