-- =============================================================================
-- Phase 1.10am — Cockpit v1.3: deep multi-turn wizard sessions
-- =============================================================================
-- The cockpit wizard is now a multi-turn interview: Atlas asks one question,
-- the human answers, the answer feeds the next prompt, repeating until Atlas
-- signals 100% clarity OR the 12-turn cap is hit.
--
-- This table persists in-progress sessions so a human can close the modal and
-- resume later (a long interview shouldn't be lost on a tab refresh).
--
-- The `state` column carries the full WizardState shape from
-- atlas/src/lib/wizard-engine.ts (history, current_turn, clarity_score, etc).
-- We keep it as jsonb rather than splitting columns — the structure evolves
-- together with the engine and a single round-trip is cheaper.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.wizard_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        text        NOT NULL,
  state           jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  created_by      text                                  -- admin id, phone, or session label
);

CREATE INDEX IF NOT EXISTS idx_wizard_sessions_phase
  ON public.wizard_sessions (phase_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wizard_sessions_recent
  ON public.wizard_sessions (updated_at DESC);

ALTER TABLE public.wizard_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wizard_sessions_service" ON public.wizard_sessions;
CREATE POLICY "wizard_sessions_service" ON public.wizard_sessions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.wizard_sessions IS
  'Phase 1.10am: persistent multi-turn cockpit-wizard sessions. Each row holds the full WizardState (history, clarity_score, current_turn) so a user can close the modal and resume later.';

NOTIFY pgrst, 'reload schema';
