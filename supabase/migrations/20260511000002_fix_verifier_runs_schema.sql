-- =============================================================================
-- Migration: Verifier payload / verifier_runs schema reconciliation (phase-1.10bb)
-- =============================================================================
-- Payload columns currently emitted by verifier/src/lib/audit.ts:
--   task_id, task_spec_path, commit_sha, mode, passed, gaps,
--   remediation_task_id, duration_ms, subject_matter_hits, unknown_reason
--
-- Reconciliation against the live schema (after every prior migration in
-- supabase/migrations/) shows ALL columns above already exist:
--   - 20260429000001_verifier.sql:                base columns
--   - 20260502170000_verifier_unknown_reason.sql: passed nullable + unknown_reason
--   - 20260507120000_verifier_subject_matter_hits.sql: subject_matter_hits
--
-- Therefore this migration is a no-op safety net: every ALTER below is
-- ADD COLUMN IF NOT EXISTS, so re-running on a database that already has
-- the columns is harmless, but a database missing any of these (e.g. a
-- fresh local clone that skipped one of the historical migrations) will
-- gain them and resolve the db_write_failed payload mismatch immediately.
--
-- HARD rules enforced here (per phase-1.10bb risks):
--   * Additive only — no DROP COLUMN, no ALTER TYPE narrowing, no TRUNCATE.
--   * Every new column is nullable OR carries a DEFAULT so existing rows
--     don't break.
-- =============================================================================

-- Safety-net additions for the existing payload columns. All idempotent.
ALTER TABLE public.verifier_runs
  ADD COLUMN IF NOT EXISTS task_id             text,
  ADD COLUMN IF NOT EXISTS task_spec_path      text,
  ADD COLUMN IF NOT EXISTS commit_sha          text,
  ADD COLUMN IF NOT EXISTS mode                text,
  ADD COLUMN IF NOT EXISTS passed              boolean,
  ADD COLUMN IF NOT EXISTS gaps                jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS remediation_task_id text,
  ADD COLUMN IF NOT EXISTS duration_ms         integer,
  ADD COLUMN IF NOT EXISTS subject_matter_hits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unknown_reason      text;

COMMENT ON TABLE public.verifier_runs IS
  'Audit log of every Verification Agent run. Each row = one task verification attempt. '
  'Payload schema reconciled in phase-1.10bb.';
