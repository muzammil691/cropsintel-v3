/**
 * Phase 1.6g — Adela price-staleness probe.
 *
 * Hourly self-probe. Reads the latest `prices.ingested_at`, classifies the
 * table as fresh vs stale against a 6h threshold, pings WhatsApp ONLY on
 * state transitions.
 *
 * Spec invariants (do not regress):
 *   - READ-ONLY: a single `SELECT ingested_at FROM prices ORDER BY ... LIMIT 1`.
 *     No DB writes anywhere in this file.
 *   - Uses existing `notifyWhatsApp` from `../notify`. No new notify module.
 *   - `.catch` around notifyWhatsApp so a Twilio failure never crashes the
 *     cron tick (pattern mirrors `adela/src/scrapers/abc.ts:324`).
 *   - State is module-level. A process restart resets to 'unknown'; the next
 *     cycle then fires one (acceptable) duplicate alert if still stale.
 */
import { supabase } from "../lib/supabase"
import { notifyWhatsApp } from "../notify"

const STALENESS_THRESHOLD_MS = 6 * 60 * 60 * 1000

type State = "fresh" | "stale" | "unknown"

let lastState: State = "unknown"

// Test-only — resets module-level state between unit tests.
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

function staleMsg(r: ProbeReading): string {
  const ts = r.latestIngestedAt ?? "none — table empty"
  const age = r.ageHours == null ? "∞" : r.ageHours.toFixed(1)
  return `⚠️ CropsIntel: prices stale. Latest ingested_at: ${ts}. Age: ${age}h. Threshold: 6h.`
}

function recoveryMsg(r: ProbeReading): string {
  const ts = r.latestIngestedAt ?? "unknown"
  const age = r.ageHours == null ? "?" : r.ageHours.toFixed(1)
  return `✅ CropsIntel: prices fresh again. Latest ingested_at: ${ts}. Age: ${age}h.`
}

export async function runPriceStalenessProbe(): Promise<void> {
  const reading = await readLatestIngestedAt()
  const from = lastState
  const to = reading.state

  const corePayload = {
    from,
    to,
    latest_ingested_at: reading.latestIngestedAt,
    age_hours: reading.ageHours,
    row_count: reading.rowCount,
  }
  const transitionPayload = { event: "price_staleness.transition", ...corePayload }

  // fresh|unknown → stale: alert.
  if ((from === "fresh" || from === "unknown") && to === "stale") {
    console.log("[price-staleness]", JSON.stringify(transitionPayload))
    await notifyWhatsApp(staleMsg(reading)).catch((err) =>
      console.error("[price-staleness] notify failed", err)
    )
    lastState = to
    return
  }

  // stale → fresh: recovery.
  if (from === "stale" && to === "fresh") {
    console.log("[price-staleness]", JSON.stringify(transitionPayload))
    await notifyWhatsApp(recoveryMsg(reading)).catch((err) =>
      console.error("[price-staleness] notify failed", err)
    )
    lastState = to
    return
  }

  // unknown → fresh (healthy startup): info log, no alert.
  if (from === "unknown" && to === "fresh") {
    console.log(
      "[price-staleness]",
      JSON.stringify({ event: "price_staleness.initial", state: to, ...corePayload })
    )
    lastState = to
    return
  }

  // Same-state cycles: debug log only, no WhatsApp.
  console.debug(
    "[price-staleness]",
    JSON.stringify({ event: "price_staleness.cycle", state: to, ...corePayload })
  )
  lastState = to
}
