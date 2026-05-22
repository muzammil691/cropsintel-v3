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

## Adding a follow-up

Append a new `## X — Title` section in chronological order. Keep the
**Logged / What / Why / Suggested fix** structure so future-you can scan
priorities without re-deriving context.
