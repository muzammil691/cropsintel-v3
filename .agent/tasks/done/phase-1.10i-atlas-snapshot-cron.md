# Task: Phase 1.10i — Atlas status snapshot cron

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §10 (status snapshot writer)
**Context:** Atlas writes a snapshot of project state every 5 minutes. Dashboard subscribes via Supabase realtime. WhatsApp pings fire on notable changes (new fork, budget warning, big failure).
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Implement a 5-minute interval timer in Atlas that:
1. Computes current project state
2. Writes a row to `atlas_snapshots`
3. Compares to previous snapshot — if anything notable changed, fires a WhatsApp ping (rate-limited)

## Implementation

### atlas/src/cron/snapshot.ts

```ts
import { getSupabaseClient } from '../lib/supabase'
import { statusSnapshot as computeSnapshot } from '../lib/tools'
import { getBurnRate } from '../lib/cost-gate'
import { sendWhatsAppReply } from '../lib/twilio'

const INTERVAL_MS = parseInt(process.env.ATLAS_SNAPSHOT_INTERVAL_MS ?? '300000', 10)  // 5 min
const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'
const PING_RATE_LIMIT_PER_HOUR = 6
const recentPings: number[] = []  // timestamps

export function startSnapshotCron(): void {
  console.log(`[atlas-cron] starting snapshot cron, interval=${INTERVAL_MS}ms`)
  // Run once on boot, then every interval
  void runSnapshot()
  setInterval(() => void runSnapshot(), INTERVAL_MS)
}

async function runSnapshot(): Promise<void> {
  const sb = getSupabaseClient()
  try {
    // Compute fresh state via tool fn
    const stateResult = await computeSnapshot()
    const burn = await getBurnRate()
    const state = stateResult as Record<string, unknown>

    // Get pending forks (atlas_decisions with chosen_option IS NULL)
    const { data: openForks } = await sb
      .from('atlas_decisions')
      .select('id, fork_question, decided_at')
      .is('chosen_option', null)
      .order('decided_at', { ascending: false })
      .limit(10)

    // Verifier pass rate (last 24h)
    const { data: recentRuns } = await sb
      .from('verifier_runs')
      .select('verdict')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    const passes = (recentRuns ?? []).filter(r => r.verdict === 'pass').length
    const total = (recentRuns ?? []).length
    const passRate = total > 0 ? (passes / total) * 100 : null

    // Insert snapshot
    const { data: prev } = await sb.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(1).maybeSingle()

    const { data: snapshot } = await sb.from('atlas_snapshots').insert({
      current_phase: deriveCurrentPhase(state),
      queued_specs: state.queuedSpecs,
      in_flight_specs: state.inFlightSpecs,
      done_specs_24h: 0,  // refine: count done within last 24h
      failed_specs_24h: 0,  // refine
      verifier_pass_rate: passRate,
      memory_chunk_count: state.memoryChunkCount,
      cost_today_usd: burn.today,
      cost_month_to_date_usd: burn.monthToDate,
      open_forks: openForks ?? [],
      raw_state: { ...state, burn },
    }).select('*').single()

    console.log(`[atlas-cron] snapshot written: queued=${state.queuedSpecs}, inFlight=${state.inFlightSpecs}, cost_today=$${burn.today.toFixed(4)}`)

    // Detect notable changes worth pinging
    if (prev) {
      await detectAndPing(prev, snapshot)
    }
  } catch (err) {
    console.error('[atlas-cron] snapshot failed:', err)
  }
}

function deriveCurrentPhase(state: Record<string, unknown>): string | null {
  // Look at queue + in-flight specs, find the most-active phase prefix
  // For v0.1, return null and let the dashboard derive it from raw_state
  return null
}

async function detectAndPing(prev: Record<string, unknown>, current: Record<string, unknown>): Promise<void> {
  const messages: string[] = []

  // New failed spec
  if ((current.failed_specs_24h as number) > (prev.failed_specs_24h as number)) {
    messages.push(`⚠️ New failed spec. Total failed in 24h: ${current.failed_specs_24h}`)
  }

  // New open fork
  const prevForks = (prev.open_forks as Array<{ id: string }> ?? []).map(f => f.id)
  const newForks = ((current.open_forks as Array<{ id: string; fork_question: string }>) ?? []).filter(f => !prevForks.includes(f.id))
  for (const fork of newForks) {
    messages.push(`🤔 New fork needs your decision: ${fork.fork_question}`)
  }

  // Budget warning crossed
  const monthly = (current.cost_month_to_date_usd as number) ?? 0
  const monthlyPrev = (prev.cost_month_to_date_usd as number) ?? 0
  const cap = parseFloat(process.env.ATLAS_BUDGET_MONTHLY ?? '400')
  if (monthly > cap * 0.8 && monthlyPrev <= cap * 0.8) {
    messages.push(`💸 Budget warning: ${Math.round(100 * monthly / cap)}% of monthly cap consumed ($${monthly.toFixed(2)} of $${cap})`)
  }

  // Daily burn alert
  const dailyToday = (current.cost_today_usd as number) ?? 0
  const dailyPrev = (prev.cost_today_usd as number) ?? 0
  const dailyThresh = parseFloat(process.env.ATLAS_BUDGET_DAILY_PAUSE ?? '40')
  if (dailyToday > dailyThresh && dailyPrev <= dailyThresh) {
    messages.push(`🔥 Daily soft cap exceeded: $${dailyToday.toFixed(2)} today (threshold $${dailyThresh}). Auto-dispatch paused.`)
  }

  // Send pings (rate-limited)
  for (const msg of messages) {
    if (canSendPing()) {
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `[Atlas] ${msg}`)
      recentPings.push(Date.now())
    }
  }
}

function canSendPing(): boolean {
  const oneHourAgo = Date.now() - 3600 * 1000
  while (recentPings.length > 0 && recentPings[0] < oneHourAgo) {
    recentPings.shift()
  }
  return recentPings.length < PING_RATE_LIMIT_PER_HOUR
}
```

### atlas/src/server.ts — start cron at boot

```ts
import { startSnapshotCron } from './cron/snapshot'

export function startServer(): void {
  // ... existing code ...
  startSnapshotCron()  // start the cron when server starts
  // ... existing listen() ...
}
```

### Add /atlas/status endpoint

```ts
if (url === '/atlas/status' && method === 'GET') {
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
  const sb = getSupabaseClient()
  const { data } = await sb.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(1).maybeSingle()
  json(res, 200, data ?? { error: 'No snapshot yet — try again in 5 minutes' })
  return
}
```

## Acceptance criteria

After this task ships:

1. `atlas/src/cron/snapshot.ts` exists with `startSnapshotCron`.
2. `startServer()` in `atlas/src/server.ts` calls `startSnapshotCron()` on boot.
3. Within 1 minute of Atlas service restart, a row appears in `atlas_snapshots`.
4. Subsequent rows appear every ~5 minutes.
5. `GET /atlas/status` returns the latest snapshot.
6. WhatsApp ping fires when a synthetic fork is inserted into atlas_decisions (test by manually inserting a row).

## Required env vars

- `MUZAMMIL_WHATSAPP` (default `+971562556592` per existing memory)
- `ATLAS_SNAPSHOT_INTERVAL_MS` (default 300000 = 5 min)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (already from 1.10f)

## Out of scope

- Backfilling historical snapshots
- More granular state (per-task state machine) — current snapshot is summary-level
- Realtime publication setup for `atlas_snapshots` — frontend can poll for v0.1; realtime is a polish task
- Scheduled batch reports (daily / weekly summary) — separate task

## Notes

- Cron is in-process (setInterval), not a separate worker. If Atlas crashes and restarts, the cron resumes automatically.
- WhatsApp ping rate limit (6/hr) protects against runaway alerts; tune if too restrictive.
- The `deriveCurrentPhase` function is stubbed for v0.1 — improve in a polish task by reading the most-active phase prefix from queued/in-progress specs.
- Snapshot cron is the heartbeat of the dashboard. If snapshots stop landing, Atlas is wedged.
