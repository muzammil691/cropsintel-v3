---
priority: 1
remediation: true
remediation-attempt: 1
---
# 1.6g: Adela price-staleness probe — hourly cron, WhatsApp on transition, log-only otherwise

_launch tier: v1.0-alpha_

## Context

Adela ingests almond pricing data into the `prices` table (column `ingested_at timestamptz` confirmed present in live Supabase, user confirmed 2026-06-XX in plan-workshop session). If the ingestion path silently stalls — scraper failure, upstream source change, Adela process wedged — the live dashboard happily serves data that is hours or days old. There is no current signal that catches a stalled ingestion before a human notices stale numbers.

This phase adds a lightweight active probe inside Adela's existing cron scheduler. It does NOT extend foundation, does NOT write to the DB, does NOT call Atlas over HTTP, does NOT introduce a new notify module. It is a self-contained probe that reads `prices`, decides fresh-vs-stale, and pings WhatsApp on state transitions.

## In scope

1. **New file: `adela/src/probes/price-staleness.ts`**
   - Exports `async function runPriceStalenessProbe(): Promise<void>`.
   - Queries Supabase: `SELECT ingested_at FROM prices ORDER BY ingested_at DESC LIMIT 1`.
   - Classifies result:
     - Empty result OR `now() - ingested_at > 6 hours` → state = `'stale'`.
     - Otherwise → state = `'fresh'`.
   - Holds a **module-level** state variable: `let lastState: 'fresh' | 'stale' | 'unknown' = 'unknown'` (initialized at module load).
   - Transition logic:
     - `fresh|unknown → stale`: log to console with structured payload (`{ event: 'price_staleness.transition', from, to, latest_ingested_at, age_hours, row_count }`), then `notifyWhatsApp(...)` wrapped in `.catch(err => console.error('[price-staleness] notify failed', err))` so a notify failure never crashes the cron tick. Message format: `⚠️ CropsIntel: prices stale. Latest ingested_at: <ISO timestamp or 'none — table empty'>. Age: <N>h. Threshold: 6h.`
     - `stale → fresh`: log + notifyWhatsApp recovery message: `✅ CropsIntel: prices fresh again. Latest ingested_at: <ISO>. Age: <N>h.`
     - Same-state cycles (`fresh → fresh`, `stale → stale`): log at debug level only, NO WhatsApp.
     - `unknown → fresh` on first run: log at info level, NO WhatsApp (no alert on healthy startup).
   - Update `lastState` only AFTER the WhatsApp call has been dispatched (so a thrown WhatsApp error before .catch landed wouldn't desync state — but with .catch in place this is moot; still, set lastState last as defensive ordering).

2. **Edit: `adela/src/scheduler.ts`**
   - Add one import: `import { runPriceStalenessProbe } from './probes/price-staleness'`.
   - Add one new scheduled job entry at hourly cadence (cron `0 * * * *` or the equivalent in Adela's existing scheduler API — match the existing job-registration pattern in this file; do not invent a new scheduler).
   - Wrap the call in the same error-isolation pattern used by sibling jobs in this file so one probe failure does not take down the scheduler.

3. **New file: `adela/src/probes/price-staleness.test.ts`**
   - Pure unit tests. Mock the Supabase client and mock `notifyWhatsApp` from `../notify`.
   - Test cases (minimum):
     1. Empty `prices` table → state classified as stale, WhatsApp called exactly once with stale message.
     2. Latest `ingested_at = now() - 7h` → stale, WhatsApp called once.
     3. Latest `ingested_at = now() - 2h` → fresh on first run, WhatsApp NOT called (unknown→fresh is silent).
     4. Transition sequence fresh → stale → fresh across three probe invocations → WhatsApp called exactly 2 times (one stale alert, one recovery).
     5. Two consecutive stale cycles → WhatsApp called exactly 1 time (transition only, not every cycle).
     6. `notifyWhatsApp` rejects → probe still resolves without throwing (the .catch swallows it); `lastState` is still advanced.
   - Reset module-level `lastState` between tests (either via Vitest/Jest `vi.resetModules()` / `jest.resetModules()` or expose a test-only `__resetForTests()` helper — pick whichever matches the project's existing test conventions for module-level state).

## Out of scope (explicitly)

- No new database tables. `observations` / `exceptions` remain deferred per Phase 1.2d audit; this probe deliberately does NOT pull them forward.
- No migration files.
- No changes to RLS, no new edge functions.
- No new notify module — uses existing `notifyWhatsApp` from `adela/src/notify.ts`.
- No HTTP call to Atlas conductor.
- No changes to `prices` table shape or any other table.
- No cockpit widget, no health-grid integration — those are separate phases if desired later.
- No persistence of `lastState` across Adela process restarts. A restart resets state to `'unknown'`; if the table is still stale post-restart, the next cycle fires one (duplicate-but-acceptable) WhatsApp. Documented as known behavior.
- No threshold configurability — 6h is a hard constant in this phase. Revisit if scrape cadence changes.
- No per-source thresholds (USDA monthly vs StrataMarkets daily). Single threshold for the `prices` table as a whole.

## Foundation check (rule #1 — foundation-first)

- ✅ `prices.ingested_at` exists in live Supabase (user confirmed in plan-workshop, option A).
- ✅ Adela service is live on Railway (`believable-warmth`, service ID `30aea385-50c4-400a-8abb-5dbf771aa182` per runtime-state.md).
- ✅ `adela/src/notify.ts` exports `notifyWhatsApp(message: string): Promise<void>` (user confirmed in plan-workshop turn 6).
- ✅ Existing `.catch` notify-isolation pattern lives at `adela/src/scrapers/abc.ts:324` (user-cited reference pattern to mirror).

## Rule audit (the five immutable rules)

1. **Foundation-first**: no new tables; only depends on `prices.ingested_at` which is confirmed present. ✅
2. **Anti-restart**: extends Adela in place via its existing scheduler; no parallel probe framework. ✅
3. **Multi-commodity**: probe queries `prices` table-wide, no almonds-specific filter; works for any commodity rows present. ✅
4. **AI keys server-side only**: no AI calls in this phase. ✅
5. **Information walls**: no user-data egress; WhatsApp ping goes only to Muzammil's admin number per existing notifyWhatsApp routing. ✅

## Acceptance criteria

1. `adela/src/probes/price-staleness.ts` exists and exports `runPriceStalenessProbe`.
2. `adela/src/scheduler.ts` registers the probe at hourly cadence using the file's existing job-registration pattern.
3. `adela/src/probes/price-staleness.test.ts` exists with all 6 test cases above and passes under the project's test runner.
4. Manual verification on next Adela deploy: tail Railway logs for `[price-staleness]` entries on the top of each hour; confirm at least one `state=fresh` log line appears within the first cycle if `prices` has recent rows.
5. No new files created outside the three listed. No edits to any file outside `adela/src/scheduler.ts`.
6. No new dependencies added to `adela/package.json`.

## Estimated effort

~45 minutes: 15 min probe code, 5 min scheduler wiring, 20 min tests, 5 min lint/typecheck.

## Owner

Builder (autonomous). No manual SQL, no Muzammil-side ops required. Ships via standard Builder loop + Verifier gate.

## Prior failure — gaps to address (attempt 1)

The previous run of `phase-1.6g-adela-price-staleness-probe-hourly-cron-whatsapp-on-transiti` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: acceptance-criterion-3
- Severity: `fail`
- Expected: `adela/src/probes/price-staleness.test.ts` with 6 specified cases that pass
- Actual: No test file was included in the shipped code listing
- Remediation: Add the test suite with all six scenarios, ensure it passes under the existing test runner

### Gap 2: acceptance-criterion-2
- Severity: `fail`
- Expected: Scheduler registers runPriceStalenessProbe at hourly cadence (0 * * * *)
- Actual: Only an import is shown; full file not provided so registration cannot be verified [judge-severity=uncertain]
- Remediation: Confirm and, if missing, add a cron entry in scheduler.ts following existing job-registration pattern

### Gap 3: gemini-judgment
- Severity: `fail`
- Expected: The probe must not write to the database, as per the spec: 'It ... does NOT write to the DB'.
- Actual: The probe is registered in `adela/src/scheduler.ts` using the standard `jobs` array, which causes it to be executed by the `runJob` wrapper. This wrapper function writes start, completion, and error records to the `atlas_dispatches` table.

From `adela/src/scheduler.ts`:
typescript
const jobs: JobConfig[] = [
  // ...
  {
    name: "price-staleness-probe",
    schedule: "0 * * * *", // Hourly at the top of the hour
    fn: runPriceStalenessProbe,
  },
]

This job is then run via `runJob`, which contains:
typescript
async function runJob(name: string, fn: () => Promise<void>): Promise<void> {
  // ...
  // Write start event
  try {
    await supabase.from("atlas_dispatches").insert({
      // ...
    })
  } catch (err) {
    console.warn(`[scheduler] Failed to log start event for ${name}:`, err)
  }
  // ... and also writes complete/error events
}

- Remediation: The probe should be scheduled separately from the main `jobs` array to bypass the `runJob` wrapper. A new `cron.schedule('0 * * * *', ...)` block should be added in `startScheduler` that calls `runPriceStalenessProbe` directly within a simple `try/catch` for console logging, ensuring no database writes occur.

