-- Phase 1.10aq — Auto-fix lifecycle on atlas_diagnosis_cache.
--
-- The Diagnose flow gains a self-fix loop: user clicks [Auto-fix now], Atlas
-- queues a builder spec, watches Builder ship + Designer re-audit, and reports
-- back ✅ resolved or ❌ failed. We persist the lifecycle on the existing
-- diagnosis-cache row so a redeploy doesn't lose state.
--
-- Lifecycle states:
--   pending-user        — diagnosis exists, waiting for user click
--   auto-fix-queued     — user clicked [Auto-fix now]; spec written + pushed
--   auto-fix-shipped    — Builder commit detected; awaiting verifier/designer audit
--   auto-fix-resolved   — original gap cleared in latest audit
--   auto-fix-failed     — original gap still present after audit; user must escalate
--   escalated-cc        — user escalated to claude-code prompt
--   dismissed           — user dismissed the row

ALTER TABLE public.atlas_diagnosis_cache
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'pending-user'
    CHECK (lifecycle_state IN (
      'pending-user',
      'auto-fix-queued',
      'auto-fix-shipped',
      'auto-fix-resolved',
      'auto-fix-failed',
      'escalated-cc',
      'dismissed'
    )),
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS auto_fix_spec_filename text,
  ADD COLUMN IF NOT EXISTS auto_fix_commit_sha text,
  ADD COLUMN IF NOT EXISTS auto_fix_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_fix_shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_fix_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_fix_failure_reason text,
  ADD COLUMN IF NOT EXISTS task_id text,
  ADD COLUMN IF NOT EXISTS commit_sha text;

CREATE INDEX IF NOT EXISTS idx_diagnosis_lifecycle
  ON public.atlas_diagnosis_cache (lifecycle_state, lifecycle_updated_at);

CREATE INDEX IF NOT EXISTS idx_diagnosis_task
  ON public.atlas_diagnosis_cache (task_id, lifecycle_state)
  WHERE task_id IS NOT NULL;

COMMENT ON COLUMN public.atlas_diagnosis_cache.lifecycle_state IS
  'Phase 1.10aq: tracks the auto-fix loop state machine for this diagnosis.';
COMMENT ON COLUMN public.atlas_diagnosis_cache.auto_fix_spec_filename IS
  'Phase 1.10aq: the .agent/tasks/queued/<file>.md filename Atlas wrote when user clicked [Auto-fix now].';
COMMENT ON COLUMN public.atlas_diagnosis_cache.auto_fix_commit_sha IS
  'Phase 1.10aq: the Builder ship-commit SHA detected by the conductor lifecycle pass.';

-- Per the spec: "Never delete diagnosis cache rows automatically — keep them
-- for ≥7 days as audit history." Bump expires_at default to a 7-day floor for
-- new rows; existing rows retain their original expiry.
ALTER TABLE public.atlas_diagnosis_cache
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
