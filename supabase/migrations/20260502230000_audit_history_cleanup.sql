-- =============================================================================
-- Migration: prune historic verifier_runs / designer_runs that have been superseded
-- =============================================================================
-- Context: the audit feed used to return the most-recent 50 rows by time
-- with no per-task dedup, so a passed task that had failed 6 months ago
-- still surfaced in AtlasAuditTab and kept generating fix-prompts. The
-- audit-feed query was fixed in 365a1b5 (collapse to latest run per task,
-- drop tasks whose latest verdict is pass) — this migration deletes the
-- now-redundant historic fail rows so the underlying data matches what
-- the UI shows.
--
-- Definition of "superseded":
--   verifier_runs row R is superseded if there exists a later row S for
--   the same task_id with passed=true. R is then deleted.
--   designer_runs row R is superseded if there exists a later row S for
--   the same task_id with verdict='pass'. R is then deleted.
--
-- Rows with passed IS NULL (verifier 'unknown' rows from db_write_failed,
-- sync_failed, spec_not_found, verify_crashed) are KEPT because the
-- task's status is genuinely indeterminate and operators should still see
-- them.
--
-- This is a one-shot cleanup; the dedup constraint added in
-- 20260502220000_designer_runs_dedup.sql + the audit-feed filter prevent
-- the situation from recurring.
-- =============================================================================

-- verifier_runs: drop fails that have a later pass for the same task.
DELETE FROM public.verifier_runs r
WHERE r.passed = false
  AND EXISTS (
    SELECT 1 FROM public.verifier_runs s
    WHERE s.task_id = r.task_id
      AND s.passed = true
      AND s.ran_at > r.ran_at
  );

-- designer_runs: drop fails that have a later pass for the same task.
DELETE FROM public.designer_runs r
WHERE r.verdict = 'fail'
  AND EXISTS (
    SELECT 1 FROM public.designer_runs s
    WHERE s.task_id = r.task_id
      AND s.verdict = 'pass'
      AND s.created_at > r.created_at
  );

NOTIFY pgrst, 'reload schema';
