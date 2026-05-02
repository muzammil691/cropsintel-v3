# Phase 1.10b — Atlas Schema Migration (Follow-up)

## Context
The previous attempt at `phase-1.10b-atlas-schema` produced no migration file. This follow-up re-issues the work with explicit deliverables. All output must be a single SQL migration file under `supabase/migrations/` (no TypeScript/React changes).

## Deliverable
Create one new migration file:

`supabase/migrations/<timestamp>_atlas_schema.sql`

The file MUST contain, in order:

### 1. Five CREATE TABLE statements
Create the following tables with appropriate primary keys, foreign keys, NOT NULL constraints, and sensible defaults (`id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()` where applicable):

1. `atlas_decisions` — stores Atlas classification decisions (artifact_kind, artifact_ref, bucket, reason, payload jsonb, created_at).
2. `atlas_actions` — stores in-app actions taken (decision_id fk, action_id, action_payload jsonb, status, executed_at, created_at).
3. `atlas_chat_sessions` — chat sessions (user_id, title, created_at, updated_at).
4. `atlas_chat_messages` — chat messages (session_id fk, role, content, tokens_in int, tokens_out int, model text, created_at).
5. `atlas_cost_events` — token/cost ledger (provider text, model text, tokens_in int, tokens_out int, cost_usd numeric(10,6), task_id text, created_at).

### 2. Indexes
Add CREATE INDEX statements for:
- `atlas_decisions(artifact_kind, artifact_ref)`
- `atlas_decisions(created_at desc)`
- `atlas_actions(decision_id)`
- `atlas_chat_messages(session_id, created_at)`
- `atlas_cost_events(created_at desc)`
- `atlas_cost_events(provider, model)`

### 3. Helper views
Create two views:
- `atlas_cost_today` — sum of `cost_usd`, `tokens_in`, `tokens_out` grouped by `provider, model` for events where `created_at::date = current_date`.
- `atlas_cost_month_to_date` — same aggregation for events where `date_trunc('month', created_at) = date_trunc('month', now())`.

### 4. Row Level Security
For every one of the five tables:
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- Add SELECT, INSERT, and UPDATE policies. Use `auth.role() = 'service_role'` as the permissive condition (server-side only access) unless the table has a `user_id` column, in which case also allow `auth.uid() = user_id` for SELECT.

## Acceptance criteria (verifier checks)
- `tables-created`: all five CREATE TABLE statements present with correct columns.
- `indexes-complete`: every index listed above present.
- `helper-views`: both views defined.
- `rls-policies`: RLS enabled and SELECT/INSERT/UPDATE policies exist for each table.

## Out of scope
- No changes to `src/`.
- No TypeScript types — that is a separate phase.

Note: the previous run's `gemini-judgment` warning was a transient 503; ignore it for this follow-up.