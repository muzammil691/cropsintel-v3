-- Phase 1.10bb-a — Plan Workshop foundation tables
--
-- Per CLAUDE-CODE-BUILD-PROMPT-plan-workshop.md (2026-05-11), the new
-- Plan Workshop replaces the per-phase wizard. This migration ships the
-- foundation tables that Sessions 2-6 build on.
--
-- Three tables:
--   1. plan_workshop_sessions — standing planning intelligence's memory
--      (decision log, open questions, concepts referenced, status)
--   2. plan_diffs             — proposed plan changes from a session,
--      awaiting Verifier audit + user approval
--   3. plan_change_history    — applied mutation audit trail for rollback
--
-- Wizard tables (wizard_sessions) are NOT dropped here — Session 3 ships
-- a follow-on migration after the new engine replaces wizard-engine.ts.

-- ─── plan_workshop_sessions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_workshop_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.profiles(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned', 'awaiting_approval')),
  decision_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  concepts_referenced uuid[] DEFAULT '{}',
  master_plan_version text,
  plan_diff_id uuid,
  total_turns int NOT NULL DEFAULT 0,
  total_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workshop_sessions_status
  ON public.plan_workshop_sessions(status, started_at DESC);

ALTER TABLE public.plan_workshop_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads workshop sessions"
  ON public.plan_workshop_sessions FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "admin writes workshop sessions"
  ON public.plan_workshop_sessions FOR ALL TO authenticated
  USING (public.is_team_or_admin(auth.uid()))
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access workshop sessions"
  ON public.plan_workshop_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_workshop_sessions_updated_at
  BEFORE UPDATE ON public.plan_workshop_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── plan_diffs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.plan_workshop_sessions(id) ON DELETE CASCADE,
  diff_jsonb jsonb NOT NULL,
  verifier_audit_jsonb jsonb,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid REFERENCES public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_diffs_session
  ON public.plan_diffs(session_id);

CREATE INDEX IF NOT EXISTS idx_plan_diffs_pending
  ON public.plan_diffs(created_at DESC)
  WHERE approved_at IS NULL AND rejected_at IS NULL;

ALTER TABLE public.plan_diffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads plan diffs"
  ON public.plan_diffs FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access plan diffs"
  ON public.plan_diffs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── plan_change_history ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diff_id uuid NOT NULL REFERENCES public.plan_diffs(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  mutations jsonb NOT NULL,
  rolled_back_at timestamptz,
  rolled_back_reason text
);

CREATE INDEX IF NOT EXISTS idx_plan_change_history_diff
  ON public.plan_change_history(diff_id);

ALTER TABLE public.plan_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads plan change history"
  ON public.plan_change_history FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access plan change history"
  ON public.plan_change_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);
