-- =============================================================================
-- Phase 1.10aj — Plan tab build cockpit: concepts + phase_approvals
-- =============================================================================
-- Two new tables backing the cockpit:
--
--   1. concepts — ideas come in (paste/upload/voice/past-chat) and get tagged
--      with a theme. The wizard reads concepts when proposing questions.
--   2. cockpit_phase_approvals — single source of truth for phase approvals
--      from any of three channels (panel / chat / WhatsApp). Replaces ad-hoc
--      approval state previously scattered across agent_audit_log payloads.
--
-- Idempotent — safe to re-run.

-- ─── concepts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concepts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text        NOT NULL,
  content         text        NOT NULL DEFAULT '',
  source_type     text        NOT NULL CHECK (
    source_type IN ('paste', 'upload', 'voice', 'past-chat')
  ),
  source_ref      text,                                -- file path / chat thread id / etc.
  theme           text,                                -- 'auth' | 'data spine' | 'ui polish' | etc.
  used_in_phases  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid                                  -- profiles(id), nullable to allow service-role inserts
);

CREATE INDEX IF NOT EXISTS idx_concepts_created_at
  ON public.concepts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concepts_theme
  ON public.concepts (theme);

ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "concepts_service" ON public.concepts;
CREATE POLICY "concepts_service" ON public.concepts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.concepts IS
  'Phase 1.10aj: concepts panel inputs (paste/upload/voice/past-chat). Wizard reads these when generating phase questions.';

-- ─── cockpit_phase_approvals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cockpit_phase_approvals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        text        NOT NULL,
  approved_via    text        NOT NULL CHECK (
    approved_via IN ('panel', 'chat', 'whatsapp')
  ),
  approved_at     timestamptz NOT NULL DEFAULT now(),
  approved_by     text,                                 -- phone or member id
  decision        text        NOT NULL DEFAULT 'approve' CHECK (
    decision IN ('approve', 'skip', 'pause', 'modify')
  ),
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cockpit_phase_approvals_phase
  ON public.cockpit_phase_approvals (phase_id, approved_at DESC);
CREATE INDEX IF NOT EXISTS idx_cockpit_phase_approvals_recent
  ON public.cockpit_phase_approvals (approved_at DESC);

ALTER TABLE public.cockpit_phase_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cockpit_phase_approvals_service" ON public.cockpit_phase_approvals;
CREATE POLICY "cockpit_phase_approvals_service" ON public.cockpit_phase_approvals
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.cockpit_phase_approvals IS
  'Phase 1.10aj: per-phase approvals from panel / chat / WhatsApp. Single source of truth — agent_audit_log mirrors this table for audit queries.';

NOTIFY pgrst, 'reload schema';
