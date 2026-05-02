-- =============================================================================
-- Migration: dedupe designer_runs and prevent future duplicates
-- =============================================================================
-- Audit H1: designer_runs has no UNIQUE constraint on
-- (task_id, operation, head_after). Conductor's auditedCommits in-memory
-- set resets on container restart, and on next heartbeat it re-audits the
-- same SHAs already in the DB. Result: AtlasAuditTab inflates "X failures"
-- counts with phantom duplicates, and batch-diagnose pipelines waste tokens
-- re-classifying the same gap.
--
-- Step 1 (one-shot): delete pre-existing duplicates, keeping the most
--                    recent row per (task_id, operation, head_after).
-- Step 2 (durable):  enforce UNIQUE going forward via a partial index that
--                    treats head_after IS NULL as a single bucket. Use
--                    COALESCE in the index expression so review-spec runs
--                    (no commit yet) still dedupe by (task_id, operation).
-- =============================================================================

-- Step 1: dedupe — keep the row with the most recent created_at per group.
DELETE FROM public.designer_runs a
USING public.designer_runs b
WHERE a.task_id = b.task_id
  AND a.operation = b.operation
  AND COALESCE(a.head_after, '') = COALESCE(b.head_after, '')
  AND a.created_at < b.created_at
  AND a.id <> b.id;

-- Step 2: prevent future duplicates. UNIQUE on (task_id, operation, head_after')
-- where '' standsin for NULL so review-spec rows (head_after IS NULL) still
-- collapse to one row per task+operation.
CREATE UNIQUE INDEX IF NOT EXISTS designer_runs_task_op_head_key
  ON public.designer_runs (task_id, operation, COALESCE(head_after, ''));

COMMENT ON INDEX public.designer_runs_task_op_head_key IS
  'Audit H1: dedupe re-audits of the same task+operation+commit. Conductor uses ON CONFLICT DO UPDATE going forward.';

NOTIFY pgrst, 'reload schema';
