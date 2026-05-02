# Phase 1.10b Follow-up: Complete Atlas Schema Migration

## Context

The previous run of `phase-1.10b-atlas-schema` produced a truncated migration file. The verifier flagged the following hard failures:

- **tables-created**: Only the first three tables (`atlas_conversations`, `atlas_snapshots`, `atlas_dispatches`) were defined. The file was cut off before `atlas_decisions` and `atlas_cost_log`.
- **helper-views**: Neither `atlas_cost_today` nor `atlas_cost_month_to_date` views were defined.
- **indexes-complete**: The dispatches index section was cut mid-statement; remaining indexes are absent.
- **rls-policies**: Only SELECT policies were added; INSERT/UPDATE policies are missing for `atlas_decisions` and other tables.

(A `gemini-judgment` warning also occurred due to a transient 503 from Gemini — ignore; re-running will retry.)

## Goal

Produce a **complete, single, idempotent** Supabase migration file that defines the full Atlas persistence schema per the original §2 spec, with all tables, indexes, RLS, helper views, and policies.

## Required Output

Create (or overwrite) the migration file at:

```
supabase/migrations/<timestamp>_atlas_schema.sql
```

The file MUST contain, in order:

### 1. Tables (all five)

Each with `CREATE TABLE IF NOT EXISTS`, primary keys, foreign keys, sensible defaults, and `created_at timestamptz default now()` where appropriate:

1. `atlas_conversations` — id (uuid pk), user_id (uuid), title (text), created_at, updated_at
2. `atlas_snapshots` — id (uuid pk), conversation_id (fk), payload (jsonb), created_at
3. `atlas_dispatches` — id (uuid pk), conversation_id (fk), tool (text), status (text), input (jsonb), output (jsonb), created_at, completed_at
4. `atlas_decisions` — id (uuid pk), artifact_kind (text), artifact_ref (text), bucket (text), reason (text), payload (jsonb), created_at
5. `atlas_cost_log` — id (uuid pk), provider (text), service (text), model (text), tokens_in (int), tokens_out (int), usd_cost (numeric), created_at

### 2. Indexes (complete set)

- `atlas_snapshots(conversation_id, created_at desc)`
- `atlas_dispatches(status)` and `atlas_dispatches(tool)`
- `atlas_decisions(artifact_kind, artifact_ref)`
- `atlas_cost_log(provider, created_at desc)` and `atlas_cost_log(service, created_at desc)`

### 3. RLS

Enable `row level security` on every table, then create per-table policies:

- **SELECT** policy: authenticated users can read their own rows (or all rows for service role).
- **INSERT** policy: authenticated users can insert rows scoped to their user_id (or service role unrestricted).
- **UPDATE** policy: authenticated users can update their own rows.

Apply to all five tables. For tables without a direct `user_id` column (`atlas_snapshots`, `atlas_dispatches`), scope via the parent `atlas_conversations.user_id`.

### 4. Helper Views

```sql
create or replace view atlas_cost_today as
  select provider, service, sum(usd_cost) as usd_cost, sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out
  from atlas_cost_log
  where created_at >= date_trunc('day', now())
  group by provider, service;

create or replace view atlas_cost_month_to_date as
  select provider, service, sum(usd_cost) as usd_cost, sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out
  from atlas_cost_log
  where created_at >= date_trunc('month', now())
  group by provider, service;
```

## Acceptance Criteria

- Single migration file contains ALL five `CREATE TABLE` statements end-to-end (no truncation).
- All indexes from §2 above are present.
- Every table has SELECT, INSERT, and UPDATE RLS policies.
- Both helper views are defined.
- File ends with a trailing newline and parses cleanly (no mid-statement cuts).
- Re-running the verifier `phase-1.10b-atlas-schema` produces `verdict: pass` on the `tables-created`, `helper-views`, `indexes-complete`, and `rls-policies` checks.

## Notes for Builder

Write the entire SQL in one shot — do not stream in chunks that risk truncation. Verify the file size and that the final statement terminates with `;` before reporting success.
