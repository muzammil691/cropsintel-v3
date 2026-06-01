# Post-ship follow-ups

Items deferred from a shipped phase. Each entry: what, why deferred, suggested
next step. Don't action without an explicit user nod — these are reminders,
not a queue.

---

## A — Observability gap: /health ignores Conductor activity

**Logged:** 2026-05-22 (during 1.10bd-queue-pivot Step 5 smoke-test prep)

**What:** `/health` surfaces /queue state (`git_state`, `queue_frozen`,
`queue_freeze_reason`) but says nothing about the Conductor heartbeat loop
in [atlas/src/cron/conductor.ts](../atlas/src/cron/conductor.ts) that runs
every 5 minutes and can dispatch design-remediation specs autonomously.

**Why this matters:** during Step 5 prep the user saw the Builder spin up
on a remediation spec they didn't queue. The Conductor was doing its job
(auto-fixing Designer-flagged UI gaps from commit `47bc090`), but `/health`
gave no signal that any of that was in flight. Looked like a bypass of the
new Step 3b /queue handler — it wasn't, but the surprise was real.

**Suggested fix:** extend `/health` with a `conductor_state` block:

```ts
conductor_state: {
  last_heartbeat_at: string | null,   // ISO timestamp of last runHeartbeat()
  last_spec_drafted: { filename: string, at: string } | null,
  last_commit_produced: { sha: string, subject: string, at: string } | null,
  inflight_builder_tasks: number,     // count of .agent/tasks/in-progress/*.md
}
```

Source data: heartbeat timestamp lives in `atlas_config` (already mirrored
via `builder_heartbeat` key — same pattern). Last drafted spec + last commit
can read from `atlas_dispatches` filtered to `initiated_by='cron' AND
tool='builder.queue_spec' ORDER BY initiated_at DESC LIMIT 1`. Inflight
count is just a filesystem `readdir(.agent/tasks/in-progress/)`.

**Cost:** ~30 LOC + one health endpoint change. No new tables.

---

## B — Orphan legacy 4ce5a3a workshop_diff_spec rows

**Logged:** 2026-05-22 (same investigation as A)

**What:** five rows in `atlas_dispatches` with
`tool='builder.workshop_diff_spec'` and
`source_diff_id='5fc7646f-796f-41c4-944a-65eeab2ebcee'` (a9434ba7's diff),
all `status='queued'`, all inserted on 2026-05-21 19:27 by the legacy
4ce5a3a auto-dispatch path. The Builder reads from filesystem
(`.agent/tasks/queued/`), not from these rows, so they cannot dispatch a
build — but they're still counted by whatever query feeds the cockpit's
Queue tab badge, inflating the active count by 5.

**Phase IDs:** 1.3d, 1.4, 1.4-PRE, 1.13, 1.13a.

**Two paths:**
1. **Filter at the badge query** — exclude rows where
   `tool='builder.workshop_diff_spec' AND status='queued' AND
   initiated_at < '2026-05-22'`. Pro: rows stay as raw audit evidence of
   the 4ce5a3a bug. Con: every future query of atlas_dispatches has to
   remember this filter.
2. **Archive with a one-shot SQL update** — set `status='legacy_inert'`
   on those 5 rows. Pro: removes them from any `status='queued'` filter
   automatically. Con: introduces a status value that nothing else uses;
   anyone reading the table will wonder what `legacy_inert` means.

**Operator preference noted (2026-05-22):** lean archive — keeps them
visible as audit evidence without polluting active counts.

**Suggested one-shot:**

```sql
UPDATE atlas_dispatches
SET status = 'legacy_inert',
    error_message = 'Orphan from 4ce5a3a auto-dispatch path; never consumed by builder. Step 3b /queue handler replaces this flow. Preserved as audit evidence.'
WHERE tool = 'builder.workshop_diff_spec'
  AND source_diff_id = '5fc7646f-796f-41c4-944a-65eeab2ebcee'
  AND status = 'queued';
-- expected: 5 rows updated
```

Optional: add `'legacy_inert'` to the dispatch status CHECK constraint if
one exists (would need a migration). Quick path: no CHECK constraint exists
on `atlas_dispatches.status` (confirm before running), so the UPDATE lands
without DDL.

---

## C — news-scraper RSS feed 404

**Status:** Active failure (5x/day per cron schedule)

**Symptom:** `almonds.com/rss/news` returns 404 on every fetch

**Impact:** News intelligence pipeline silently empty since at least 2026-05-10

**Suggested fix:** (a) replace feed URL with an alternative ABC news source, OR
(b) scrape `almondboard.com/news/` directly via HTML parser, OR (c) deprecate
the scraper entirely if news isn't core to V1.0-alpha

**Owner:** Muzammil to decide path forward

**Detected:** Step 1 verification (2026-05-22 morning)

---

## D — abc-scraper using deprecated Gemini model

**Status:** Active failure (2x/day per cron schedule)

**Symptom:** Calls to `gemini-2.0-flash` return 404 — Google deprecated the model

**Impact:** ABC position report ingestion pipeline failing silently

**Suggested fix:** Update model ID in the scraper config to `gemini-2.5-flash`
or newer. Verify the prompt template still works with the newer model (output
shape may have shifted).

**Owner:** Muzammil to decide model + verify

**Detected:** Step 1 verification (2026-05-22 morning)

---

## E — Verifier public URL 404 (Railway domain detached or redeploy URL change)

**Logged:** 2026-05-22 (during Phase 1.10bb verification)

**What:** `https://rare-happiness-production.up.railway.app/` returns Railway-level
404 (`{"status":"error","code":404,"message":"Application not found"}`) from
external probes. Both `/health` and `/audit` 404. The Verifier service itself
is operational — at 2026-05-22 14:31:10 UTC `agent-loop.sh` running inside the
Builder Railway service successfully POSTed `/audit` and got `passed=true` back
(verified via a `mode='gate'` row in `verifier_runs`). So service-to-service
routing inside Railway still works; only the public domain is broken.

**Why this matters:** the cockpit's "test verifier" buttons + any external curl
probe + monitoring tools that hit the public URL all fail. The autonomous loop
is unaffected. But anyone diagnosing the system from outside (including future-
you with `curl /health`) will incorrectly conclude the service is down.

**Suggested fix:** open Railway dashboard → `rare-happiness` service (ID
`bfa035e9-7e8d-46da-9a61-dc636fd225d9`) → Settings → Networking → Public
Networking. Likely outcomes:
1. Public domain detached (most common after a redeploy without re-attaching)
   — click "Generate Domain" or attach the old one. Done.
2. New domain shown with different subdomain — update `VERIFIER_URL` env on
   Atlas (`courteous-simplicity`) and Builder (`cropsintel-agent`), plus
   `.env.example` and runtime-state.md.
3. Service is fine but on a private-only deployment — decide whether external
   access is wanted (probably yes for observability) and attach a public domain.

**Owner:** Muzammil (needs Railway dashboard access)

**Detected:** Phase 1.10bb verification (2026-05-22 14:45 UTC)

---

## F — snapshot.ts reads non-existent verifier_runs.verdict column

**Logged:** 2026-05-22 (during Phase 1.10bb workshop investigation)

**What:** [atlas/src/cron/snapshot.ts:41-47](../atlas/src/cron/snapshot.ts#L41-L47):

```ts
const { data: recentRuns } = await sb
  .from('verifier_runs')
  .select('verdict')                              // ← column doesn't exist
  .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
const passes = (recentRuns ?? []).filter(r => r.verdict === 'pass').length
```

Two bugs in 6 lines:
1. `verifier_runs` has no `verdict` column — only `passed boolean` (Phase 1.10v
   added `verdict` to the in-memory `VerificationResult` type for HTTP responses
   but never wrote a migration to add it to the table).
2. Column is `ran_at`, not `created_at`. `.gte('created_at', ...)` always
   filters by NULL → returns the empty set (or every row, depending on PostgREST
   behavior; either way, not what's intended).

**Why this matters:** every Atlas snapshot since this code shipped has logged
`passRate = 0% / null`. Silent corruption of a monitoring metric.

**Suggested fix:** replace `verdict` → `passed`, replace `created_at` → `ran_at`,
update the filter to `.eq('passed', true)`. ~6 LOC.

```ts
.select('passed')
.gte('ran_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
.eq('passed', true)
```

**Owner:** Atlas (queueable as a small spec — Builder-fixable)

**Detected:** Phase 1.10bb evidence-gathering grep (2026-05-22)

---

## G — memory/agent-history.ts reads non-existent verifier_runs.verdict column

**Logged:** 2026-05-22 (during Phase 1.10bb workshop investigation)

**What:** [memory/src/ingest/agent-history.ts:43,122,211](../memory/src/ingest/agent-history.ts#L43)
declares a `VerifierRow` interface with `verdict: string | null` and `created_at:
string | null`. Same bugs as follow-up F:

```ts
interface VerifierRow {
  ...
  verdict: string | null            // ← column doesn't exist
  ...
  created_at: string | null         // ← actual column is ran_at
}
...
lines.push(`verdict: ${r.verdict ?? 'unknown'}`)
```

**Why this matters:** every verifier-failure memory chunk emitted by the memory
service has stamped `verdict: unknown` regardless of the actual outcome. The
chunks have been useless as searchable evidence since the ingest landed.

**Suggested fix:** update `VerifierRow` interface to match the actual schema
(`passed boolean | null`, `ran_at timestamptz`). Render `passed=true → 'pass'`,
`passed=false → 'fail'`, `passed=null → unknown_reason`. ~15 LOC.

**Owner:** Atlas (queueable as a small spec)

**Detected:** Phase 1.10bb evidence-gathering grep (2026-05-22)

---

## H — 44 historical db_write_failed verifier_runs rows from 2026-05-07 to 2026-05-22

**Logged:** 2026-05-22 (post-Phase 1.10bb verification)

**What:** between 2026-05-07 15:14:00 UTC and 2026-05-22 13:39:15 UTC the
Verifier silently fell through to `writeUnknownVerifierRun(..., 'db_write_failed')`
on every audit because of the migration drift fixed in Phase 1.10bb. The
resulting 44 rows have `passed=NULL`, `unknown_reason='db_write_failed'`, and
no real verdict signal. They're harmless (Phase 1.10bb code reads `.passed`
filtered to `true|false`, so these rows don't poison aggregates) but they
add noise to any time-series queries on verifier_runs.

**Why this matters:** purely cosmetic. The rows are accurate audit evidence
that the system was broken for 15 days. Keeping them as a paper trail has
value; deleting them lies about history.

**Suggested fix (three options, archive preferred):**

1. **Archive** — add a column like `lifecycle_status text NOT NULL DEFAULT 'live'`
   and flip these 44 rows to `'historical_db_write_failed'`. Aggregation queries
   filter `lifecycle_status = 'live'`. Pattern matches 1.10be's `legacy_inert`
   on `atlas_dispatches`.
2. **Delete** — single SQL DELETE. Loses the audit trail.
3. **Leave** — accept the noise; teach readers to filter `unknown_reason IS NULL`.

Archive is consistent with the 1.10be precedent. Small spec (~15 min Builder).

**Owner:** Muzammil decision (archive vs delete vs leave)

**Detected:** Phase 1.10bb verification (2026-05-22)

---

## I — stray atlas_verifier_runs table possibly created by phase-1.10bb-fix-verifier-db-write-failures (f95bccb)

**Logged:** 2026-05-22 (during Phase 1.10bb workshop investigation)

**What:** the earlier autonomous attempt `phase-1.10bb-fix-verifier-db-write-failures.md`
(shipped 2026-05-21 via commit `f95bccb`, 7 files, 407s) was authored against
the WRONG TABLE NAME — it referred to `atlas_verifier_runs` (with the `atlas_`
prefix). The real table is `verifier_runs`. That spec's RLS/migration changes
either:
1. Created a new empty `atlas_verifier_runs` table that's never written to, OR
2. No-op'd because the target table didn't exist, OR
3. Targeted a different actual table

We never verified which.

**Why this matters:** if a stray `atlas_verifier_runs` table exists, it's
confusing dead weight in the schema. Future investigators (and Atlas itself
reading from `information_schema`) might assume it's authoritative.

**Suggested fix:** quick check via Supabase MCP:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'atlas_verifier_runs';
-- If exists:
SELECT count(*) FROM public.atlas_verifier_runs;
-- If 0 rows: DROP TABLE public.atlas_verifier_runs;
-- If nonzero rows: investigate before dropping
```

Single migration if cleanup is warranted.

**Owner:** Atlas (queueable as ~10-LOC investigative spec)

**Detected:** Phase 1.10bb evidence-gathering grep (2026-05-22)

---

## J — Workshop `audit-only: true` escape hatch is out-of-scope by design — CLOSED

**Logged:** 2026-05-31 (during P2 guard wiring into `queueWorkshopDiff`)

**Closed:** 2026-06-01 (after reframing — see below)

**Original concern:** the P2 guard (`validateQueueCandidateBody`)
honors an `audit-only: true` flag in spec frontmatter, but
`synthSpecBody` in
[atlas/src/lib/queue-orchestrator.ts](../atlas/src/lib/queue-orchestrator.ts)
emits no frontmatter at all — so a Workshop user couldn't engage the
escape hatch even if they wanted to.

**Why we're closing this as out-of-scope rather than fixing it:**

1. **Workshop's product purpose is plan-tree phase add/edit operations,
   which are code work by definition.** The Workshop UI walks a user
   through "I want to add Phase X to the master plan" → Claude drafts
   a `PlanDiffOp` with `op: 'add' | 'edit'` → the user approves → the
   atomic /queue handler synthesizes a spec from that op. Every step
   assumes the resulting phase will produce code, a migration, or
   schema work. There is no flow where Workshop drafts an
   investigation ADR.

2. **Missing frontmatter dispatches fine.** Confirmed empirically when
   `phase-1.2d-foundation-audit-rerun.md` shipped 2026-06-01 with
   zero YAML frontmatter — Builder treats absent frontmatter as
   priority=5 default, paused=false, deps=[]. Per
   [agent-loop.sh:236-280](../agent/agent-loop.sh#L236) and the
   downstream readers at
   [tools.ts:484-487](../atlas/src/lib/tools.ts#L484),
   [verify-side-effects.ts:233](../atlas/src/lib/verify-side-effects.ts#L233),
   none of them require frontmatter to be present.

3. **A Workshop spec with a normal body containing back-ticked paths
   passes P2 and dispatches normally — the common case.** This is the
   only Workshop output shape that needs to work, and it does.

4. **Audit-only / investigation specs go through the
   `builder.queue_spec` chat tool**, not Workshop. The chat tool
   accepts a raw spec body (frontmatter and all) authored by the
   operator or Atlas chat — that path correctly honors `audit-only:
   true`. Cluster ADRs, post-mortems, retro investigations: chat-tool
   queue. Plan-tree phase additions: Workshop.

**Caveat (the one thing that could reopen this):** empirically
unconfirmed until the first real Workshop-drafted product spec
ships. If that spec fails to dispatch or fails P2 in an unexpected
way, reopen J and re-evaluate. The `phase-1.4-PRE-SMOKE-queue-pipeline-smoke-test`
that shipped 2026-05-22 only exercised the queue plumbing with a
synthetic no-op spec; the first **substantive product** Workshop
spec is still pending (Proof 1, in flight).

**Followup contract:** when reopened, options remain unchanged from
the original entry — extend `synthSpecBody` to propagate
frontmatter from `op.metadata.audit_only` (cleanest, ~25 LOC across
3 files: Atlas type, LLM prompt, synthSpecBody emitter), or require
a Files-required block in the Workshop UI (higher UX friction).
The P2 wiring test
[atlas/src/lib/p2-wiring.test.ts](../atlas/src/lib/p2-wiring.test.ts)
"audit-only: true synth spec passes" case documents the current
divergent behavior; that assertion would flip if the fix lands.

**Status:** CLOSED-BY-DESIGN. No code change.

---

## K — Recurring Verifier-strict-read pattern (mitigated by product-first-failure pause guard, 7a1bb21)

**Logged:** 2026-06-02 (after shipping the pause guard in `atlas/src/lib/remediation-policy.ts`)

**Pattern:** Verifier strict-reads spec language and finds wrapper/conditional contradictions, triggering remediation cycles (observed in 1.2d files-exist gate and 1.6g "does NOT write to DB" gate). The product-first-failure pause guard now surfaces these to the operator on first failure instead of auto-grinding. Spec authors should pre-empt by acknowledging wrapper effects in spec language.

---

## Adding a follow-up

Append a new `## X — Title` section in chronological order. Keep the
**Logged / What / Why / Suggested fix** structure so future-you can scan
priorities without re-deriving context.
