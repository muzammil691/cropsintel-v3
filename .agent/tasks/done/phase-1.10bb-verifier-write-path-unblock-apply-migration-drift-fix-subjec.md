# 1.10bb: Verifier write-path unblock — apply migration drift fix (subject_matter_hits)

_launch tier: v1.0-alpha_

## Context

Verifier writes to `verifier_runs` (correct table) have been failing since 2026-05-07 with silent fallback to `writeUnknownVerifierRun()` stamping `unknown_reason='db_write_failed'`. 44 such rows accumulated; most recent 2026-05-22 13:39 UTC. Failing audit_run_id cited in workshop intake: `d2514552-9fe5-47f4-8354-95bf4b4efdd1`.

**Root cause (confirmed by live evidence):** This is Phase 1.3c migration drift manifesting again. Phase 1.10v (2026-05-07) added `subject_matter_hits` to the Verifier insert payload (`verifier/src/lib/audit.ts:11-48`) and produced migration file `supabase/migrations/20260507120000_verifier_subject_matter_hits.sql`. That migration was never applied to prod Supabase project `hzrnohsxigrqlmzegwlb`. Last applied verifier migration: `20260509085134_fix_verifier_runs_rls`. Every Verifier insert since has thrown on unknown column and fallen through to the unknown-row write path.

**This phase is the surgical fix only:** apply the existing migration. No code changes.

## In scope

- Apply migration `20260507120000_verifier_subject_matter_hits.sql` to prod Supabase project `hzrnohsxigrqlmzegwlb`.
- Pre-flight health check: confirm 7/7 Railway services healthy (Atlas conductor, Builder, Verifier, Designer, Adela, Council, Memory) per runtime-state.md §Atlas+agents, plus frontend deploy.
- Post-apply smoke test: trigger one real Verifier audit run and assert a row lands in `verifier_runs` with all NOT NULL fields populated (`task_id`, `task_spec_path`, `commit_sha`, `mode`, `ran_at`) AND `subject_matter_hits` column present and writable (NULL or integer, not erroring).
- Update `.agent/runtime-state.md` to reflect migration applied + Verifier write path restored.
- Mark `supabase_migrations.schema_migrations` row for `20260507120000` as applied (Supabase Studio applies this automatically when the SQL Editor records the migration; verify after run).

## Out of scope (deferred to follow-up phases)

- **Bug 2 (snapshot.ts silent corruption):** `atlas/src/cron/snapshot.ts:41-47` reads non-existent `.verdict` column and queries non-existent `created_at` (should be `ran_at`). Pass rate has been 0%/null since shipped. → defer to a follow-up phase (rename: `1.10bc` or equivalent).
- **Bug 3 (memory ingest silent corruption):** `memory/src/ingest/agent-history.ts:43,122,211` stamps every chunk as `verdict='unknown'` because field resolves to undefined. → defer to a separate follow-up phase.
- **Cleanup of 44 db_write_failed rows in `verifier_runs`:** decide delete vs archive vs leave. → defer to a separate follow-up phase.
- Any change to `verifier/src/lib/audit.ts` write payload (it is already correct).
- Any change to readers using `.passed` (they will work correctly post-migration).
- Any change to `audit_run_id` / `confidence` persistence (working as designed; HTTP-only fields, not DB columns).

## EXECUTION METHOD (non-negotiable)

1. Open Supabase Studio SQL Editor for project `hzrnohsxigrqlmzegwlb`.
2. Copy the SQL contents of `supabase/migrations/20260507120000_verifier_subject_matter_hits.sql` into the SQL Editor.
3. Run.
4. **DO NOT execute `supabase db push`** — that would attempt to apply all unapplied local migrations, including any further drift not scoped into this phase. Per runtime-state.md Open Issues #2, additional drift exists; running db push risks unintended side effects.
5. After successful run, manually insert a row into `supabase_migrations.schema_migrations` for version `20260507120000` if Studio did not record it automatically (verify via `SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260507120000'`).

## PRE-FLIGHT

- Confirm 7/7 Railway services healthy (Atlas conductor, Builder, Verifier, Designer, Adela, Council, Memory) plus frontend.
- If any service unhealthy, **defer the smoke test step until healthy** (the migration apply itself is independent and can proceed; only the post-apply Verifier smoke test depends on Verifier service health).

## Acceptance criteria

1. `SELECT column_name FROM information_schema.columns WHERE table_name='verifier_runs' AND column_name='subject_matter_hits'` returns exactly 1 row.
2. `SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260507120000'` returns exactly 1 row.
3. Next real Verifier audit run after apply produces a row in `verifier_runs` with `unknown_reason IS NULL` and `passed IN (true, false)` — i.e., no longer falling through to `writeUnknownVerifierRun()`.
4. No new `unknown_reason='db_write_failed'` rows appear in `verifier_runs` after the apply timestamp.
5. `.agent/runtime-state.md` updated with apply timestamp + restored-status note.

## Owner

Muzammil (manual SQL apply via Supabase Studio — Builder/Atlas cannot apply DB migrations from CI per runtime-state.md Open Issues; CI lacks SUPABASE_ACCESS_TOKEN + direct DB access).

## Estimated effort

~15 minutes: 2 min SQL apply, 5 min smoke test, 5 min runtime-state.md update, 3 min buffer.
