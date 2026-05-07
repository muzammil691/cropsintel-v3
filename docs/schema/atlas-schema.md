# Atlas Schema Reference

**Migration:** `20260507085227_atlas_schema_complete.sql`  
**Phase:** 1.10b2  
**Created:** 2026-05-07 08:52:27 UTC

This document describes the complete Atlas database schema for the CropsIntel V3 autonomous agent system.

---

## Overview

The Atlas schema provides the database substrate for:
- **Conversational layer** — LLM chat threads with cost tracking
- **Snapshot queue** — Atlas run state and queue metrics
- **Tool dispatch ledger** — Audit log of every tool invocation
- **Decision log** — Council decisions and rationale
- **Cost telemetry** — Fine-grained cost and token tracking

All tables have Row-Level Security (RLS) enabled with admin-only policies.

---

## Tables

### `atlas_conversations`

Stores every message turn in an Atlas LLM conversation thread.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key |
| `thread_id` | `uuid` | NOT NULL | — | Conversation thread identifier |
| `role` | `text` | NOT NULL | — | Message role: `system`, `user`, `assistant`, or `tool` |
| `content` | `text` | NULL | — | Message content |
| `tool_calls` | `jsonb` | NULL | — | Tool invocation data (for assistant messages) |
| `cost_usd` | `numeric(12,6)` | NOT NULL | `0` | Cost of this message in USD |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Timestamp |

**Indexes:**
- `atlas_conversations_thread_id_idx` on `(thread_id, created_at)`

**Constraints:**
- `CHECK (role IN ('system','user','assistant','tool'))`

---

### `atlas_snapshots`

One row per Atlas snapshot run; tracks queue state and cost.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key |
| `queued` | `int` | NOT NULL | `0` | Number of tasks queued |
| `done` | `int` | NOT NULL | `0` | Number of tasks completed |
| `failed` | `int` | NOT NULL | `0` | Number of tasks failed |
| `cost_today_usd` | `numeric(12,6)` | NOT NULL | `0` | Total cost today at snapshot time |
| `trust_mode` | `text` | NOT NULL | `'standard'` | Trust mode: `standard`, `strict`, or `permissive` |
| `payload` | `jsonb` | NULL | — | Additional snapshot metadata |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Timestamp |

**Constraints:**
- `CHECK (trust_mode IN ('standard','strict','permissive'))`

---

### `atlas_dispatches`

Ledger of every tool invocation Atlas makes.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key |
| `tool_name` | `text` | NOT NULL | — | Name of the tool invoked |
| `args` | `jsonb` | NULL | — | Tool arguments |
| `result` | `jsonb` | NULL | — | Tool result |
| `status` | `text` | NOT NULL | `'pending'` | Dispatch status: `pending`, `success`, or `error` |
| `cost_usd` | `numeric(12,6)` | NOT NULL | `0` | Cost of this dispatch in USD |
| `duration_ms` | `int` | NULL | — | Execution time in milliseconds |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Timestamp |

**Constraints:**
- `CHECK (status IN ('pending','success','error'))`

---

### `atlas_decisions`

Audit log of decisions made by the Atlas council.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key |
| `phase` | `text` | NOT NULL | — | Phase identifier (e.g., `phase-1.10b2`) |
| `decision` | `text` | NOT NULL | — | The decision made |
| `rationale` | `text` | NULL | — | Reasoning behind the decision |
| `made_by` | `text` | NOT NULL | — | Agent or person who made the decision |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Timestamp |

---

### `atlas_cost_log`

Fine-grained per-call cost telemetry; references `atlas_dispatches`.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key |
| `tool_name` | `text` | NOT NULL | — | Name of the tool invoked |
| `model` | `text` | NOT NULL | — | AI model used (e.g., `claude-sonnet-4-5`) |
| `cost_usd` | `numeric(12,6)` | NOT NULL | `0` | Cost of this call in USD |
| `tokens_in` | `int` | NOT NULL | `0` | Input tokens |
| `tokens_out` | `int` | NOT NULL | `0` | Output tokens |
| `dispatch_id` | `uuid` | NULL | — | Foreign key to `atlas_dispatches.id` |
| `created_at` | `timestamptz` | NOT NULL | `now()` | Timestamp |

**Indexes:**
- `atlas_cost_log_dispatch_id_idx` on `(dispatch_id)`
- `atlas_cost_log_created_at_idx` on `(created_at)`

**Foreign Keys:**
- `dispatch_id → atlas_dispatches(id) ON DELETE SET NULL`

---

## Views

### `atlas_cost_today`

Aggregate cost and token usage for the current day (UTC).

**Columns:**
- `tool_name` (text)
- `model` (text)
- `total_cost_usd` (numeric)
- `total_tokens_in` (bigint)
- `total_tokens_out` (bigint)
- `call_count` (bigint)

**Source:**  
Aggregates `atlas_cost_log` rows where `created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`.

---

### `atlas_cost_month_to_date`

Aggregate cost and token usage for the current month (UTC).

**Columns:**
- `tool_name` (text)
- `model` (text)
- `total_cost_usd` (numeric)
- `total_tokens_in` (bigint)
- `total_tokens_out` (bigint)
- `call_count` (bigint)

**Source:**  
Aggregates `atlas_cost_log` rows where `created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')`.

---

## Security

All 5 tables have Row-Level Security (RLS) enabled with the `admin_only` policy:

```sql
POLICY admin_only
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin')
```

Only users with the `admin` role in their JWT can read or write Atlas data.

Views inherit RLS from their source tables automatically.

---

## Usage Notes

1. **atlas_conversations** — Each LLM message is one row. Group by `thread_id` to reconstruct conversations.
2. **atlas_snapshots** — Written once per Atlas loop iteration. Tracks overall system state.
3. **atlas_dispatches** — One row per tool call. Join with `atlas_cost_log` via `dispatch_id` for detailed cost breakdown.
4. **atlas_decisions** — Audit trail for council-mode decisions. Phase-scoped for traceability.
5. **atlas_cost_log** — Most granular cost tracking. Aggregated by the two cost views for reporting.

---

## Migration Idempotency

The migration uses:
- `CREATE TABLE IF NOT EXISTS` for all tables
- `CREATE INDEX IF NOT EXISTS` for all indexes
- `CREATE OR REPLACE VIEW` for all views
- `DROP POLICY IF EXISTS` / `CREATE POLICY` for RLS policies

Safe to run multiple times against the same database.

---

## See Also

- **Master plan:** `docs/master-plan/atlas-orchestrator-track.md`
- **Migration:** `supabase/migrations/20260507085227_atlas_schema_complete.sql`
- **Tests:** `supabase/migrations/20260507085227_atlas_schema_complete.sql.test.sql`
