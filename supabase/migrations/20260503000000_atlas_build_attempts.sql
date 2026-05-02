-- =============================================================================
-- Migration: atlas_build_attempts — pre-build memory record + completion trace
-- =============================================================================
-- Phase 2 of the agent-loop redesign. Adds a per-attempt record that bookends
-- the build: a row is created when spec-draft finishes (status='planned'),
-- transitions to 'queued' when builderQueueSpec writes to .agent/tasks/queued,
-- 'shipped' when Builder pushes the commit, 'verified' when verifierAuditAfterShips
-- writes a passing row, and 'failed' or 'escalated' on the unhappy paths.
--
-- The agent-history Memory ingest source (memory/src/ingest/agent-history.ts)
-- is extended in Phase 6 to read from this table too, so completed attempts
-- become positive memory traces — not just failures, which is all today's
-- agent-history tracks.
--
-- Why a separate table from verifier_runs:
--   verifier_runs records WHAT VERIFIER FOUND. atlas_build_attempts records
--   WHAT ATLAS PLANNED + how the plan moved through the pipeline. The two
--   correlate via task_id but answer different questions:
--     "did this build pass?" → verifier_runs
--     "what specs did Atlas write for this task and what happened to them?"
--       → atlas_build_attempts
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.atlas_build_attempts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             text        NOT NULL,
  spec_filename       text        NOT NULL,
  spec_sha            text        NOT NULL,        -- sha256 of spec_markdown for dedup
  primary_domain      text        NOT NULL CHECK (
    primary_domain IN ('frontend', 'analytical', 'research', 'mixed')
  ),
  status              text        NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'queued', 'shipped', 'verified', 'failed', 'escalated')
  ),
  multi_brain_run_id  uuid,                        -- correlates with brain debate; nullable for fallback drafts
  prior_warnings      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  attempt_number      int         NOT NULL DEFAULT 1,
  cost_usd            numeric(10, 4) DEFAULT 0,
  planned_at          timestamptz NOT NULL DEFAULT now(),
  queued_at           timestamptz,
  shipped_at          timestamptz,
  verified_at         timestamptz,
  completed_at        timestamptz,
  failure_gaps        jsonb,
  UNIQUE (task_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_atlas_build_attempts_task
  ON public.atlas_build_attempts (task_id, attempt_number DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_build_attempts_spec_sha
  ON public.atlas_build_attempts (spec_sha);

CREATE INDEX IF NOT EXISTS idx_atlas_build_attempts_status_recent
  ON public.atlas_build_attempts (status, planned_at DESC);

ALTER TABLE public.atlas_build_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_build_attempts_service" ON public.atlas_build_attempts;
CREATE POLICY "atlas_build_attempts_service" ON public.atlas_build_attempts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.atlas_build_attempts IS
  'Phase 1.10b/2: per-attempt build record bookending the agent loop. status transitions planned → queued → shipped → verified (or failed/escalated).';

NOTIFY pgrst, 'reload schema';
