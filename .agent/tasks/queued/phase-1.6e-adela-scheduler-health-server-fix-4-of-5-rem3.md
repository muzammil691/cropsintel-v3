---
priority: 1
primary-domain: research
remediation: true
remediation-attempt: 3
---
```markdown
---
model: claude-sonnet-4-5
phase: phase-1.6e
component: adela
---

# Task: Phase 1.6e — Adela Scheduler & Health Server (Fix 4 of 5)

**Master plan reference:** `docs/master-plan.md` § Adela Orchestration Layer (Phase 1.6 Adela hardening sweep, part 4 of 5)
**Estimated effort:** 1.5–2 days
**Model:** claude-sonnet-4-5

---

## Goal

Create `adela/src/scheduler.ts` as a master cron orchestrator using `node-cron`, and `adela/src/index.ts` as the entry point that starts both the scheduler and a lightweight health-check HTTP server.

The scheduler must coordinate four existing jobs in dependency order:

| Job | Schedule | Notes |
|---|---|---|
| `abc-scraper` | Daily 06:00 UTC | Independent |
| `strata-scraper` | Daily 07:00 UTC | Independent |
| `news-scraper` | Every 4 hours | Independent |
| `ai-analyst` | Daily 08:00 UTC | Runs after scrapers |

Each job must be wrapped in `try/catch`, must write `start` / `complete` / `error` lifecycle events to the `atlas_dispatches` table, must log `duration_ms`, and must **never** crash the host process on individual job failure.

The health-check HTTP server listens on `PORT` (default `3001`) and responds to `GET /health` with:

```json
{ "status": "ok", "lastRun": { "<jobName>": "<ISO timestamp>" }, "uptime": <seconds> }
```

This task is part 4 of the 5-part Adela hardening sweep and directly addresses the "black box" observability gap and brittle crash behaviour identified in the V2 audit (`docs/v3-step3-v2-audit.md`).

---

## Architecture

### Prerequisites (must be verified before Builder starts)

- `atlas_dispatches` table exists in Supabase with the column schema shown below and RLS configured so that the service-role key bypasses row-level security. If the table is absent, raise a hard blocker and create a prerequisite migration (Phase 1.6d or earlier) before proceeding.
- `adela/src/lib/supabase.ts` exports an initialised Supabase service-role client.
- Each of `abc-scraper.ts`, `strata-scraper.ts`, `news-scraper.ts`, and `ai-analyst.ts` exports a callable `async () => void` function (not only a CLI entry point).

### Module layout

```
adela/
  src/
    scheduler.ts        ← master cron orchestrator (NEW)
    index.ts            ← entry point: starts scheduler + health server (NEW)
    jobs/
      abc-scraper.ts    ← existing (must export async function)
      strata-scraper.ts ← existing (must export async function)
      news-scraper.ts   ← existing (must export async function)
      ai-analyst.ts     ← existing (must export async function)
    lib/
      supabase.ts       ← existing service-role client
  package.json          ← must declare node-cron dependency
```

### scheduler.ts responsibilities

1. Import each job as an `async () => void` function.
2. Define a `runJob(name: string, fn: () => Promise<void>): Promise<void>` helper that:
   - Writes `{ event: 'start', job: name, ts: Date.now() }` to `atlas_dispatches`.
   - Calls `fn()` inside `try/catch`.
   - On success: writes `{ event: 'complete', job: name, duration_ms }` to `atlas_dispatches`.
   - On failure: writes `{ event: 'error', job: name, error: err.message, duration_ms }` to `atlas_dispatches` and logs to `console.error`; does **not** re-throw.
3. Register four `node-cron` schedules using `cron.schedule(...)`:
   - `0 6 * * *` → `abc-scraper`
   - `0 7 * * *` → `strata-scraper`
   - `0 */4 * * *` → `news-scraper`
   - `0 8 * * *` → `ai-analyst`
4. Export a `lastRun` map (`Record<string, string>`) updated on each `complete` event.
5. Export a `startScheduler(): void` function that activates all schedules.

### index.ts responsibilities

1. Call `startScheduler()`.
2. Create a `http.createServer` that handles `GET /health`:
   - Returns `200` with `Content-Type: application/json`.
   - Body: `{ status: 'ok', lastRun, uptime: process.uptime() }`.
   - All other paths return `404`.
3. Listen on `process.env.PORT ?? 3001`.
4. Log `Adela scheduler started. Health server on port <PORT>` to `console.info`.

### atlas_dispatches table contract

Writes use the Supabase service-role client (already initialised in `adela/src/lib/supabase.ts`). Minimum insert shape:

```ts
{
  job:         string,   // job name
  event:       'start' | 'complete' | 'error',
  duration_ms: number | null,
  error:       string | null,
  created_at:  string,   // ISO-8601, set by DB default
}
```

---

## Files

| Path | Action | Description |
|---|---|---|
| `adela/src/scheduler.ts` | **CREATE** | Master cron orchestrator |
| `adela/src/index.ts` | **CREATE** | Entry point: starts scheduler and health server |
| `adela/package.json` | **MODIFY** | Add `node-cron` + `@types/node-cron` if absent; add `"main": "dist/index.js"` and start script |

No other files should be created or deleted.

---

## Success criteria

1. **All four cron expressions parse without error** — `node-cron` `validate()` returns `true` for each schedule string.
2. **`runJob` isolates failures** — when a job function throws, the process does not exit; subsequent scheduled invocations still fire.
3. **`atlas_dispatches` receives all three event types** — integration test (or manual smoke test) confirms `start`, `complete`, and `error` rows are inserted with correct `job` name and non-null `duration_ms`.
4. **`GET /health` returns 200 + valid JSON** — response body contains `status: "ok"`, a `lastRun` object, and a numeric `uptime`.
5. **`GET /nonexistent` returns 404** — health server does not leak unhandled routes.
6. **TypeScript compiles without errors** — `tsc --noEmit` exits 0.
7. **`lastRun` is populated after a job completes** — the timestamp stored is a valid ISO-8601 string produced after the job finished.
8. **No hard-coded credentials** — Supabase URL and service-role key are read exclusively from environment variables.

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`atlas_dispatches` table does not exist or lacks required columns** | Medium | High | Before merging this task, verify the table schema in Supabase. If absent, create a prerequisite migration (Phase 1.6d or earlier) that adds the table with RLS disabled for service-role inserts. Name this a hard blocker in PR checklist. |
| **`atlas_dispatches` RLS blocks service-role writes** | Low | High | Confirm service-role key bypasses RLS by policy (`USING (true)` for service role). Add an integration smoke test that inserts a row before starting the scheduler. |
| **Job modules are not importable as plain async functions** | Medium | Medium | Audit `abc-scraper.ts`, `strata-scraper.ts`, `news-scraper.ts`, `ai-analyst.ts` to confirm each exports a default or named `async () => void`. If a job only has

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.

## Prior failure — gaps to address (attempt 3)

The previous run of `phase-1.6e-adela-scheduler-health-server-fix-4-of-5` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: o3-judgment
- Severity: `fail`
- Expected: Create adela/src/scheduler.ts implementing cron orchestrator per spec.
- Actual: File adela/src/scheduler.ts is missing.
- Remediation: Add scheduler.ts with runJob helper, cron schedules, lastRun map, and startScheduler export.

### Gap 2: o3-judgment
- Severity: `fail`
- Expected: Create adela/src/index.ts that starts scheduler and health server.
- Actual: File adela/src/index.ts is missing.
- Remediation: Implement index.ts per spec.

### Gap 3: o3-judgment
- Severity: `fail`
- Expected: Modify adela/package.json to add node-cron dependencies, main field, and start script.
- Actual: package.json unchanged; dependencies and scripts missing.
- Remediation: Add node-cron and @types/node-cron dependencies, set main to dist/index.js, and add npm start script.

### Gap 4: files-exist
- Severity: `fail`
- Expected: adela/src/scheduler.ts created with cron orchestration per spec
- Actual: File is missing
- Remediation: Implement scheduler.ts with runJob helper, cron schedules, lastRun map, and startScheduler export.

### Gap 5: package-json-deps
- Severity: `fail`
- Expected: adela/package.json updated to include node-cron dependency and main/start scripts
- Actual: No modification detected
- Remediation: Add node-cron and @types/node-cron to dependencies and configure main field and npm start script.

