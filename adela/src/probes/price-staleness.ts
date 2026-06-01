/**
 * Price-staleness probe (Phase 1.6g — remediation attempt 2)
 *
 * Hourly self-probe that detects whether Adela's ingestion path into the
 * `prices` table is silently stalled. Reads the latest `ingested_at` value;
 * classifies the table as fresh or stale against a 6h threshold; pings
 * WhatsApp ONLY on state transitions to avoid notification spam.
 *
 * Spec constraints (do not regress):
 *   - NO database writes (read-only `SELECT` on `prices.ingested_at`).
 *   - NO new tables, migrations, edge functions, or notify modules.
 *   - Uses existing `notifyWhatsApp` from `../notify`.
 *   - `.catch` around the notify call so a Twilio failure never crashes the
 *     cron tick; pattern mirrors `adela/src/scrapers/abc.ts:324`.
 *
 * State is held module-level. A process restart resets state to 'unknown';
 * if the table is still stale post-restart, the next cycle fires one
 * (duplicate-but-acceptable) WhatsApp alert. This is documented behavior.
 */

import { supabase } from "../lib/supabase"
import { notifyWhatsApp } from "../notify"

const STALENESS_THRESHOLD_MS = 6 * 60 * 60 * 1000 // 6 hours

type State = "fresh" | "stale" | "unknown"

let lastState: State = "unknown"

/**
 * Test-only helper. Resets module-level state so each test starts from the
 * same baseline. Not exported from the package surface — internal use only.
 */
export function __resetForTests(): void {
  lastState = "unknown"
}

interface ProbeReading {
  state: "fresh" | "stale"
  latestIngestedAt: string | null
  ageHours: number | null
  rowCount: number
}

async function readLatestIngestedAt(): Promise<ProbeReading> {
  const { data, error } = await supabase
    .from("prices")
    .select("ingested_at")
    .order("ingested_at", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`[price-staleness] supabase query failed: ${error.message}`)
  }

  const rows = (data ?? []) as Array<{ ingested_at: string | null }>
  if (rows.length === 0 || !rows[0].ingested_at) {
    return { state: "stale", latestIngestedAt: null, ageHours: null, rowCount: 0 }
  }

  const latest = rows[0].ingested_at
  const ageMs = Date.now() - new Date(latest).getTime()
  const ageHours = ageMs / (60 * 60 * 1000)
  const state: "fresh" | "stale" = ageMs > STALENESS_THRESHOLD_MS ? "stale" : "fresh"

  return { state, latestIngestedAt: latest, ageHours, rowCount: 1 }
}

function formatStaleMessage(r: ProbeReading): string {
  const ts = r.latestIngestedAt ?? "none — table empty"
  const age = r.ageHours == null ? "∞" : r.ageHours.toFixed(1)
  return `⚠️ CropsIntel: prices stale. Latest ingested_at: ${ts}. Age: ${age}h. Threshold: 6h.`
}

function formatRecoveryMessage(r: ProbeReading): string {
  const ts = r.latestIngestedAt ?? "unknown"
  const age = r.ageHours == null ? "?" : r.ageHours.toFixed(1)
  return `✅ CropsIntel: prices fresh again. Latest ingested_at: ${ts}. Age: ${age}h.`
}

export async function runPriceStalenessProbe(): Promise<void> {
  const reading = await readLatestIngestedAt()
  const from = lastState
  const to = reading.state

  const transitionPayload = {
    event: "price_staleness.transition",
    from,
    to,
    latest_ingested_at: reading.latestIngestedAt,
    age_hours: reading.ageHours,
    row_count: reading.rowCount,
  }

  // Transitions that fire WhatsApp
  if ((from === "fresh" || from === "unknown") && to === "stale") {
    console.log("[price-staleness]", JSON.stringify(transitionPayload))
    await notifyWhatsApp(formatStaleMessage(reading)).catch((err) =>
      console.error("[price-staleness] notify failed", err)
    )
    lastState = to
    return
  }

  if (from === "stale" && to === "fresh") {
    console.log("[price-staleness]", JSON.stringify(transitionPayload))
    await notifyWhatsApp(formatRecoveryMessage(reading)).catch((err) =>
      console.error("[price-staleness] notify failed", err)
    )
    lastState = to
    return
  }

  // Healthy startup: unknown → fresh. Info log, no alert.
  if (from === "unknown" && to === "fresh") {
    console.log(
      "[price-staleness]",
      JSON.stringify({
        event: "price_staleness.initial",
        state: to,
        latest_ingested_at: reading.latestIngestedAt,
        age_hours: reading.ageHours,
        row_count: reading.rowCount,
      })
    )
    lastState = to
    return
  }

  // Same-state cycles — debug-level log only, no notification.
  console.debug(
    "[price-staleness]",
    JSON.stringify({
      event: "price_staleness.cycle",
      state: to,
      latest_ingested_at: reading.latestIngestedAt,
      age_hours: reading.ageHours,
      row_count: reading.rowCount,
    })
  )
  lastState = to
}
