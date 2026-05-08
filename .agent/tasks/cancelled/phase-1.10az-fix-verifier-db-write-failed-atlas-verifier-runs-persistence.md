---
primary-domain: analytical
---
```markdown
---
phase: phase-1.10az
model: claude-sonnet-4-5
status: draft
owner: atlas-architect
---

# Task: Phase 1.10az — Fix Verifier db_write_failed (atlas_verifier_runs Persistence)

**Master plan reference:** CropsIntel V3 Master Plan §4.2 (Verifier loop) and §6.1 (Atlas observability tables)

**Estimated effort:** 2–3 developer days

**Model:** claude-sonnet-4-5

---

## Goal

Every verifier run currently returns `passed: null` with `unknown_reason: db_write_failed`. The verification logic itself is passing (returning `gaps: []`), but the result cannot be persisted to the `atlas_verifier_runs` table. This phase investigates and resolves all root causes, then adds a smoke test to confirm end-to-end write integrity.

Root causes to investigate and fix (in order):

1. **RLS policy** — The Row-Level Security policy on `atlas_verifier_runs` may be blocking service-role inserts. Audit and patch the policy so the service role can unconditionally insert rows.
2. **Schema mismatch** — Columns the verifier attempts to write may be missing from or mismatched in `atlas_verifier_runs`. Diff the verifier payload against the live schema and apply any required migrations.
3. **Wrong Supabase client key** — The verifier may be initialised with the anon key rather than the service-role key, causing RLS to apply even if the policy is nominally correct. Ensure the verifier module uses the service-role client.

The fix is complete when `passed: true` or `passed: false` is reliably written to the database on every verifier run and the smoke test passes in CI.

---

## Files

| File | Action | Notes |
|---|---|---|
| `supabase/migrations/YYYYMMDD_fix_verifier_rls.sql` | Create | Patch RLS policy; grant service-role unconditional INSERT on `atlas_verifier_runs` |
| `supabase/migrations/YYYYMMDD_fix_verifier_schema.sql` | Create (if needed) | Add or rename columns to match verifier write payload |
| `lib/supabase/verifierClient.ts` | Audit / Edit | Confirm client is initialised with `SUPABASE_SERVICE_ROLE_KEY`, not `SUPABASE_ANON_KEY` |
| `lib/verifier/runVerifier.ts` | Audit / Edit | Confirm write payload keys match `atlas_verifier_runs` column names exactly |
| `lib/verifier/smokeTest.ts` | Create | Insert a synthetic row, assert it lands, delete it; callable from CI |
| `tests/verifier/smokeTest.test.ts` | Create | Jest/Vitest test that invokes `smokeTest.ts` and fails the build on any error |
| `scripts/verifier-smoke.sh` | Create | Shell wrapper so CI pipeline can invoke the smoke test without the full test suite |

> **Dependency assumption:** The `atlas_verifier_runs` table already exists in the database. If it does not, its creation is a hard prerequisite — see Risks + mitigations.

---

## Success criteria

All of the following must be true before this phase is closed:

1. **Every live verifier run writes a result.** Running the verifier against any active phase produces a row in `atlas_verifier_runs` with `passed` equal to `true` or `false` (never `null`) and `unknown_reason` absent or `null`.
2. **RLS audit passes.** The RLS policy on `atlas_verifier_runs` explicitly permits `INSERT` for the service role; no other role gains elevated permissions as a side-effect.
3. **Schema matches payload.** All keys in the verifier write payload map 1-to-1 to columns in `atlas_verifier_runs`; no extra keys are silently dropped and no required columns are missing.
4. **Service-role client confirmed.** `verifierClient.ts` is initialised exclusively with `SUPABASE_SERVICE_ROLE_KEY`; usage of `SUPABASE_ANON_KEY` in that module is removed or absent.
5. **Smoke test passes in CI.** `tests/verifier/smokeTest.test.ts` completes without error in the CI pipeline; the synthetic row is confirmed present then deleted within the same test run.
6. **No regression in existing verifier logic.** All pre-existing verifier unit tests continue to pass; `gaps` detection behaviour is unchanged.

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `atlas_verifier_runs` table does not exist in production | Low | Critical | Before any code change, run `SELECT to_regclass('public.atlas_verifier_runs')` in prod. If null, create the table in a prerequisite migration and treat that migration as Phase 1.10ay, shipping it first. |
| Service-role key not present in environment | Medium | High | Verify `SUPABASE_SERVICE_ROLE_KEY` is set in all environments (local `.env`, CI secrets, prod). Add a startup assertion that throws a clear error if the key is missing rather than falling back to anon. |
| RLS patch grants excessive privileges | Medium | High | Scope the new RLS policy to `INSERT` only for the service role; do not use `USING (true)` on SELECT/UPDATE/DELETE unless already established policy. Peer-review the migration SQL before applying to prod. |
| Schema migration causes downtime | Low | Medium | Use additive migrations only (add columns, not rename/drop). Mark new columns nullable with defaults so existing inserts are not broken mid-deploy. |
| Smoke test leaves orphan rows in prod | Medium | Low | The smoke test must `DELETE` its synthetic row inside a `finally` block. Tag synthetic rows with a reserved `run_id` prefix (e.g. `smoke-test-*`) so they can be bulk-deleted if cleanup fails. |
| Multiple simultaneous root causes compound each other | Medium | High | Fix and verify each root cause independently in the order listed in Goal. Commit a passing smoke test after each fix before moving to the next. |

---

## NEVER list

Builders MUST NOT do any of the following:

- **NEVER** use `SUPABASE_ANON_KEY` to initialise the verifier's Supabase client.
- **NEVER** disable RLS entirely on `atlas_verifier_runs` as a shortcut — patch the policy narrowly.
- **NEVER** rename or drop existing columns in `atlas_verifier_runs` without a separate, reviewed migration; use additive changes only.
- **NEVER** hard-code Supabase credentials (URL or keys) in source files; all credentials must come from environment variables.
- **NEVER** leave the smoke test's synthetic row in the database — cleanup is mandatory and must run in a `finally` block.
- **NEVER** alter the `gaps` detection logic or any other verifier business logic as part of this fix — this phase touches persistence only.
- **NEVER** widen RLS policies beyond what is explicitly required (i.e. do not grant INSERT/SELECT/UPDATE/DELETE to roles other than the service role unless a separate ADR approves it).
- **NEVER** mark this phase complete while any live verifier run still produces `passed: null`.
```