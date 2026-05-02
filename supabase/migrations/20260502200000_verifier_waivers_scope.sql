-- =============================================================================
-- Migration: scope verifier_waivers so they cannot mask future regressions
-- =============================================================================
-- Audit C4 finding: verifier_waivers has UNIQUE (task_id, check_name) and a
-- nullable verifier_run_id. A waiver written once for a task+check applies
-- forever — even after a regression re-introduces the same gap on a later
-- commit. Defense-in-depth before the "Mark stub as intentional" insert
-- handler is built.
--
-- Changes:
--  - Add commit_sha (text, nullable for legacy rows). New waivers must record
--    the commit they were authorized against; the verifier-side waiver lookup
--    will then only honor a waiver if commit_sha matches the run's HEAD or
--    is NULL (legacy "task-wide" semantics, kept for migration compat).
--  - Add expires_at (timestamptz, default now()+7d). Waivers expire so a
--    stale acknowledgement doesn't shadow a new failure mode forever.
--  - Replace UNIQUE (task_id, check_name) with UNIQUE on
--    (task_id, check_name, COALESCE(commit_sha,'')) so two distinct commits
--    can carry independent waivers for the same check.
-- =============================================================================

ALTER TABLE public.verifier_waivers
  ADD COLUMN IF NOT EXISTS commit_sha text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days');

-- Drop the constraint that lets one waiver shadow every future run. The
-- IF EXISTS guard makes this idempotent across retries; supabase autonames
-- the implicit-UNIQUE constraint <table>_<col>_<col>_key.
ALTER TABLE public.verifier_waivers
  DROP CONSTRAINT IF EXISTS verifier_waivers_task_id_check_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS verifier_waivers_task_check_commit_key
  ON public.verifier_waivers (task_id, check_name, COALESCE(commit_sha, ''));

CREATE INDEX IF NOT EXISTS idx_verifier_waivers_expiry
  ON public.verifier_waivers (expires_at);

COMMENT ON COLUMN public.verifier_waivers.commit_sha IS
  'Commit the waiver was authorized against. NULL = legacy task-wide waiver. New waivers must populate this.';
COMMENT ON COLUMN public.verifier_waivers.expires_at IS
  'Auto-expiry. Default 7d. Verifier lookup must filter expires_at > now().';

NOTIFY pgrst, 'reload schema';
