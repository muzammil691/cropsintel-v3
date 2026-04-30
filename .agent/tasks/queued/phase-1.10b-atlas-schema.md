# Task: Phase 1.10b — Atlas Supabase schema migration

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §4 (schema additions)
**Context:** Atlas needs five tables to function: conversations, snapshots, dispatches, decisions, cost_log. This task creates the Supabase migration and applies it. Subsequent Atlas tasks (1.10c onward) read/write these tables.
**Estimated effort:** ~15 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Create one migration file at `supabase/migrations/<timestamp>_atlas.sql` that creates all five Atlas tables exactly as specified in `.agent/specs/atlas-master-spec.md` §4. Add appropriate indexes, RLS policies, and grants.

## Migration file requirements

### File path

`supabase/migrations/20260430000000_atlas.sql` — pick the actual current UTC timestamp at file creation time, but use this template format (`YYYYMMDDHHMMSS`).

### Tables to create

Copy-paste the schema from `.agent/specs/atlas-master-spec.md` §4 verbatim with these adjustments:

1. **All tables** — add `ENABLE ROW LEVEL SECURITY` after creation, then add policies:
   - `atlas_conversations`: SELECT/INSERT for authenticated users with their own thread_id (use `(select auth.uid())::text` matching some user_id field — for v0.1 just `USING (true)` for SELECT, INSERT for service_role only)
   - `atlas_snapshots`: SELECT for `true` (anyone can read; written by Atlas only)
   - `atlas_dispatches`: SELECT for `true`, INSERT/UPDATE for service_role only
   - `atlas_decisions`: SELECT for `true`, INSERT/UPDATE for authenticated users
   - `atlas_cost_log`: SELECT for `true`, INSERT for service_role only

   Note: For v0.1 simplicity, all SELECT policies can be `USING (true)` since Atlas is single-user (Muzammil). Tighten in a later migration when multi-user lands.

2. **Indexes** — add indexes for common query patterns:
   - `atlas_conversations`: `(thread_id, created_at DESC)` and `(channel, created_at DESC)`
   - `atlas_snapshots`: `(taken_at DESC)`
   - `atlas_dispatches`: `(status, initiated_at DESC)` and `(tool, initiated_at DESC)`
   - `atlas_decisions`: `(decided_at DESC)` and `(related_phase)` (for phase-scoped queries)
   - `atlas_cost_log`: `(occurred_at DESC)` (already in spec) and add `(provider, occurred_at DESC)`, `(service, occurred_at DESC)`

3. **No FK references** to tables that don't exist yet. If `atlas_decisions.related_specs text[]` references task IDs, leave it as a plain `text[]` — don't FK to anything.

4. **Helper views** (optional but useful):
   - `atlas_cost_today` — sum of cost_usd from atlas_cost_log where occurred_at >= today midnight UTC
   - `atlas_cost_month_to_date` — sum of cost_usd from atlas_cost_log where occurred_at >= first of current month UTC, grouped by provider

   ```sql
   CREATE OR REPLACE VIEW atlas_cost_today AS
   SELECT
     provider,
     service,
     SUM(cost_usd) AS cost_usd,
     SUM(input_tokens) AS input_tokens,
     SUM(output_tokens) AS output_tokens,
     COUNT(*) AS call_count
   FROM atlas_cost_log
   WHERE occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
   GROUP BY provider, service;

   CREATE OR REPLACE VIEW atlas_cost_month_to_date AS
   SELECT
     provider,
     SUM(cost_usd) AS cost_usd,
     COUNT(*) AS call_count
   FROM atlas_cost_log
   WHERE occurred_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
   GROUP BY provider;
   ```

## Apply migration

After writing the SQL file, the agent must:

1. Run `cd /workspace/cropsintel-v3 && npx supabase db push --include-all --debug` to apply against the live V3 Supabase project.
2. If the push fails for any reason (auth, network, schema conflict), document the error in `.agent/questions/phase-1.10b-q.md` and ask the user to apply manually via Supabase SQL editor.
3. Verify by running a quick query (the agent does this in its own session): `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'atlas_%'` — should return all 5 tables.

## Acceptance criteria

After this task ships:

1. File `supabase/migrations/20260430xxxxxx_atlas.sql` exists in repo.
2. All 5 tables (`atlas_conversations`, `atlas_snapshots`, `atlas_dispatches`, `atlas_decisions`, `atlas_cost_log`) exist in V3 Supabase.
3. All 5 tables have `row_security` set to `true` (RLS enabled).
4. Indexes from §2 above are created.
5. The two helper views (`atlas_cost_today`, `atlas_cost_month_to_date`) exist and return zero rows (since no data yet).
6. `INSERT INTO atlas_snapshots (current_phase, queued_specs) VALUES ('test', 0)` succeeds when run as service_role (proves Atlas can write).

## Out of scope

- Seeding data (Atlas's snapshot cron will write the first row in 1.10i)
- Realtime publication (add later if dashboard needs live subscriptions)
- Cross-table joins or constraints (each table is independent for v0.1)
- Auth integration beyond `USING (true)` policies (tighten later)

## Notes

- Use `TIMESTAMPTZ NOT NULL DEFAULT now()` for all timestamp columns (matches V3 conventions in other migrations).
- All `text` columns referencing IDs should NOT be foreign keys to internal tables yet — keep loose so we can iterate without migration churn.
- `metadata jsonb DEFAULT '{}'` should be `NOT NULL` — null jsonb causes downstream edge cases.
