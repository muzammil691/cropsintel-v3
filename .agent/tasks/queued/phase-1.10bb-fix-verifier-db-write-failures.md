---
primary-domain: analytical
---
# Task: Phase 1.10bb — Fix Verifier DB Write Failures

model: claude-opus-4-7

**Master plan reference:** §7.3 data integrity layer; §9.1 RLS policy hardening for service-role writes
**Context:** The Verifier service is emitting `db_write_failed` errors on the `atlas_verifier_runs` table because it is authenticating with the anon key instead of the service-role key, causing RLS to block all INSERTs. A secondary issue is a payload/schema mismatch (missing or renamed columns) that causes write failures even when auth is corrected. This fix is required now because verification results are being silently dropped, corrupting the audit trail for all crop intelligence decisions.
**Estimated effort:** ~90 min Builder time
**Model:** claude-opus-4-7

---

## Goal

1. Update the Verifier client initialization to use `SUPABASE_SERVICE_ROLE_KEY` (not the anon key) for all writes targeting `atlas_verifier_runs`.
2. Add explicit RLS policies on `atlas_verifier_runs` granting `INSERT` and `SELECT` to both `service_role` and `authenticated` roles.
3. Diff the Verifier write payload against the live `atlas_verifier_runs` table schema; produce and apply all additive (non-breaking) migrations needed to resolve column mismatches.
4. Add a smoke test that inserts a synthetic row into `atlas_verifier_runs`, asserts the row is present, then deletes it; CI must fail if this test does not pass.
5. Document the correct env-var usage in the Verifier README section.

## Architecture

```
apps/
  verifier/
    src/
      client.ts          ← fix: swap anon key → service-role key
      verifier.ts        ← no change expected; verify payload shape here
      smoke.test.ts      ← NEW: insert / confirm / delete test
    README.md            ← extend: env-var documentation
supabase/
  migrations/
    20240601_fix_verifier_runs_rls.sql    ← NEW: RLS policies
    20240601_fix_verifier_runs_schema.sql ← NEW: additive column migrations
  schema/
    atlas_verifier_runs.ts  ← extend: reflect any new columns in type defs
```

## Files

- `apps/verifier/src/client.ts` (refactor) — Replace `SUPABASE_ANON_KEY` with `SUPABASE_SERVICE_ROLE_KEY` in the Supabase client factory used by the Verifier; guard with a startup assertion that the env var is present.
- `apps/verifier/src/verifier.ts` (extend) — Audit the write payload object against the target schema; align field names/types to match confirmed table columns.
- `apps/verifier/smoke.test.ts` (NEW) — Integration smoke test: create a synthetic `atlas_verifier_runs` row, SELECT it back by synthetic ID, assert existence, DELETE it; exit non-zero on any failure.
- `supabase/migrations/20240601_fix_verifier_runs_rls.sql` (NEW) — RLS policy DDL for INSERT and SELECT on `atlas_verifier_runs` for `service_role` and `authenticated`.
- `supabase/migrations/20240601_fix_verifier_runs_schema.sql` (NEW) — Additive column migrations derived from payload/schema diff; all changes must be `ADD COLUMN IF NOT EXISTS`.
- `supabase/schema/atlas_verifier_runs.ts` (extend) — Update TypeScript schema type to include any newly added columns.
- `apps/verifier/README.md` (extend) — Document required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), explain why the service-role key is required, and warn against using the anon key.

## Schema additions

```sql
-- Migration: 20240601_fix_verifier_runs_rls.sql
-- Enable RLS (idempotent)
ALTER TABLE atlas_verifier_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full INSERT access
CREATE POLICY IF NOT EXISTS "service_role_insert_verifier_runs"
  ON atlas_verifier_runs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow service role full SELECT access
CREATE POLICY IF NOT EXISTS "service_role_select_verifier_runs"
  ON atlas_verifier_runs
  FOR SELECT
  TO service_role
  USING (true);

-- Allow authenticated users SELECT access
CREATE POLICY IF NOT EXISTS "authenticated_select_verifier_runs"
  ON atlas_verifier_runs
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users INSERT access
CREATE POLICY IF NOT EXISTS "authenticated_insert_verifier_runs"
  ON atlas_verifier_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Migration: 20240601_fix_verifier_runs_schema.sql
-- Replace <column_name> and <type> with findings from payload/schema diff.
-- All additions MUST be additive only (no DROP, no ALTER TYPE narrowing).
-- Example pattern — update with actual diff results before applying:
ALTER TABLE atlas_verifier_runs
  ADD COLUMN IF NOT EXISTS run_metadata  jsonb,
  ADD COLUMN IF NOT EXISTS error_details text,
  ADD COLUMN IF NOT EXISTS duration_ms   integer;
```

## Success criteria

- `npm run build` clean with zero TypeScript errors.
- Verifier client initializes exclusively with `SUPABASE_SERVICE_ROLE_KEY`; startup throws a descriptive error if the env var is absent.
- A live Verifier run produces a row in `atlas_verifier_runs` with no `db_write_failed` errors in logs.
- RLS policies are present on `atlas_verifier_runs` and are confirmed via `psql \d+ atlas_verifier_runs` or Supabase Studio policy view.
- All payload fields emitted by `verifier.ts` have a corresponding column in `atlas_verifier_runs`; no `unknown column` or `null constraint` errors on write.
- `smoke.test.ts` passes in CI: synthetic row inserted → SELECT confirms row exists → row deleted; CI pipeline fails if any assertion fails.

## Risks + mitigations

- **Risk:** Committing `SUPABASE_SERVICE_ROLE_KEY` to source accidentally. **Mitigation:** Key is read exclusively from env vars; add `SUPABASE_SERVICE_ROLE_KEY` to `.gitignore` secret scan rules and confirm it is already in `.env.example` as a placeholder only.
- **Risk:** Additive migration introduces a non-nullable column without a default, breaking existing rows or subsequent inserts that omit the column. **Mitigation:** All new columns must declare a `DEFAULT` or be nullable; migration reviewer must reject any `ADD COLUMN … NOT NULL` without `DEFAULT`.
- **Risk:** RLS policies are too permissive (open SELECT to `anon` role unintentionally). **Mitigation:** Policies explicitly name `service_role` and `authenticated` only; `anon` is not granted any access; policy names are descriptive to prevent accidental duplication.
- **Risk:** Smoke test leaves orphaned synthetic rows if it crashes mid-test. **Mitigation:** Smoke test uses a `try/finally` block to guarantee DELETE runs; synthetic rows are identified by a reserved `run_id` prefix (`smoke-test-`).

## NEVER list

- Never use `SUPABASE_ANON_KEY` in any Verifier write path, even as a fallback.
- Never apply a destructive migration (`DROP COLUMN`, `ALTER TYPE` narrowing, `TRUNCATE`) in this phase.
- Never disable RLS on `atlas_verifier_runs` as a workaround.
- Never hardcode key values in source files or test fixtures.
- Never allow the smoke test to exit silently on failure; it must propagate a non-zero exit code to CI.