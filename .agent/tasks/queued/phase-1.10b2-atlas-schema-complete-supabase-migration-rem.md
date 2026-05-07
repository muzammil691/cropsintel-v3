---
priority: 1
primary-domain: analytical
remediation: true
remediation-attempt: 1
---
```markdown
---
model: claude-sonnet-4-5
phase: phase-1.10b2
type: infrastructure
estimated_effort: 45min
---

# Task: Phase 1.10b2 — Atlas Schema Complete (Supabase Migration)

**Master plan reference:** CropsIntel V3 master plan, Atlas Orchestrator track — Phase 1.10 (DB substrate for Atlas conversational layer, snapshot queue, tool dispatch ledger, decision log, and cost telemetry). See `docs/master-plan/atlas-orchestrator-track.md`.

**Estimated effort:** 45 min

**Model:** claude-sonnet-4-5

---

## Goal

Create all missing Atlas DB tables in Supabase via a single idempotent migration so that downstream Atlas components have a stable, fully-typed schema to write against.

The migration must:

1. Create 5 tables with all required columns, types, and constraints (see Architecture).
2. Create 2 aggregate views: `atlas_cost_today` and `atlas_cost_month_to_date`.
3. Enable RLS on all 5 tables with an admin-only policy (`auth.jwt() ->> 'role' = 'admin'`).
4. Be fully idempotent — use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, and `DROP POLICY IF EXISTS` / `CREATE POLICY` guards.
5. Run cleanly against both a fresh Supabase project and the current dev DB.

**Out of scope for this phase:** application-layer code that reads/writes these tables; that belongs to Phase 1.11+.

---

## Files

| Path | Action | Description |
|---|---|---|
| `supabase/migrations/<timestamp>_atlas_schema_complete.sql` | **CREATE** | Single idempotent migration — tables, views, RLS |
| `supabase/migrations/<timestamp>_atlas_schema_complete.sql.test.sql` | **CREATE** | Smoke-test assertions (row insert + select + policy check) |
| `docs/schema/atlas-schema.md` | **CREATE** | Human-readable schema reference auto-generated from migration comments |

`<timestamp>` = `YYYYMMDDHHMMSS` UTC at time of authoring.

---

## Architecture

### Table Definitions

#### `atlas_conversations`
Stores every message turn in an Atlas LLM conversation thread.

```sql
CREATE TABLE IF NOT EXISTS atlas_conversations (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id     uuid          NOT NULL,
    role          text          NOT NULL CHECK (role IN ('system','user','assistant','tool')),
    content       text,
    tool_calls    jsonb,
    cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
    created_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS atlas_conversations_thread_id_idx
    ON atlas_conversations (thread_id, created_at);
```

#### `atlas_snapshots`
One row per Atlas snapshot run; tracks queue state and cost.

```sql
CREATE TABLE IF NOT EXISTS atlas_snapshots (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    queued           int           NOT NULL DEFAULT 0,
    done             int           NOT NULL DEFAULT 0,
    failed           int           NOT NULL DEFAULT 0,
    cost_today_usd   numeric(12,6) NOT NULL DEFAULT 0,
    trust_mode       text          NOT NULL DEFAULT 'standard'
                                   CHECK (trust_mode IN ('standard','strict','permissive')),
    payload          jsonb,
    created_at       timestamptz   NOT NULL DEFAULT now()
);
```

#### `atlas_dispatches`
Ledger of every tool invocation Atlas makes.

```sql
CREATE TABLE IF NOT EXISTS atlas_dispatches (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name     text          NOT NULL,
    args          jsonb,
    result        jsonb,
    status        text          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','success','error')),
    cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
    duration_ms   int,
    created_at    timestamptz   NOT NULL DEFAULT now()
);
```

#### `atlas_decisions`
Audit log of decisions made by the Atlas council.

```sql
CREATE TABLE IF NOT EXISTS atlas_decisions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phase         text        NOT NULL,
    decision      text        NOT NULL,
    rationale     text,
    made_by       text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
```

#### `atlas_cost_log`
Fine-grained per-call cost telemetry; FK to `atlas_dispatches`.

```sql
CREATE TABLE IF NOT EXISTS atlas_cost_log (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name     text          NOT NULL,
    model         text          NOT NULL,
    cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
    tokens_in     int           NOT NULL DEFAULT 0,
    tokens_out    int           NOT NULL DEFAULT 0,
    dispatch_id   uuid          REFERENCES atlas_dispatches (id) ON DELETE SET NULL,
    created_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS atlas_cost_log_dispatch_id_idx
    ON atlas_cost_log (dispatch_id);
CREATE INDEX IF NOT EXISTS atlas_cost_log_created_at_idx
    ON atlas_cost_log (created_at);
```

> **Dependency note:** `atlas_cost_log.dispatch_id` FK references `atlas_dispatches`. Both tables are created in this same migration — no prior phase is required. `atlas_dispatches` **must appear before** `atlas_cost_log` in the migration file.

### View Definitions

```sql
CREATE OR REPLACE VIEW atlas_cost_today AS
SELECT
    tool_name,
    model,
    SUM(cost_usd)     AS total_cost_usd,
    SUM(tokens_in)    AS total_tokens_in,
    SUM(tokens_out)   AS total_tokens_out,
    COUNT(*)          AS call_count
FROM atlas_cost_log
WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
GROUP BY tool_name, model;

CREATE OR REPLACE VIEW atlas_cost_month_to_date AS
SELECT
    tool_name,
    model,
    SUM(cost_usd)     AS total_cost_usd,
    SUM(tokens_in)    AS total_tokens_in,
    SUM(tokens_out)   AS total_tokens_out,
    COUNT(*)          AS call_count
FROM atlas_cost_log
WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
GROUP BY tool_name, model;
```

### RLS Policies

Applied to all 5 tables. Pattern repeated for each table (`atlas_conversations`, `atlas_snapshots`, `atlas_dispatches`, `atlas_decisions`, `atlas_cost_log`):

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_only ON <table>;
CREATE POLICY admin_only ON <table>
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin');
```

Views inherit table RLS automatically; no view-level policy needed.

---

## Success Criteria

Each criterion must pass before the Verifier marks this phase done.

| # | Check | How to verify |
|---|---|---|
| SC-1 | All 5 tables exist with correct columns, types, and constraints exactly matching the DDL above | `\d atlas_conversations` (and each table) in psql — every column name, type, nullability, default, and CHECK constraint matches the DDL in this spec |
| SC-2 | FK `atlas_cost_log.dispatch_id → atlas_dispatches.id ON DELETE SET NULL` is present | `SELECT conname, confdeltype FROM pg_constraint WHERE conname LIKE '%dispatch%'` returns 1 row with `confdeltype = 'n'` |
| SC-3 | Both views return rows or empty set (no error) after a test insert into `atlas_cost_log`

## Risks + mitigations

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- **Risk:** Council was unavailable, so draft may have gaps. **Mitigation:** review the spec carefully before queueing; refine ambiguous items.

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.

## Prior failure — gaps to address (attempt 1)

The previous run of `phase-1.10b2-atlas-schema-complete-supabase-migration` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: verifier-unhandled-exception
- Severity: `fail`
- Expected: Verifier completes without throwing
- Actual: Unhandled exception: ENOENT: no such file or directory, open '/workspace/cropsintel-v3/.agent/tasks/queued/phase-1.10b2-atlas-schema-complete-supabase-migration.md'
- Remediation: Check verifier logs for stack trace. Manual review required.

