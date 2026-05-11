-- =============================================================================
-- Migration: Explicit RLS policies on verifier_runs (phase-1.10bb)
-- =============================================================================
-- Builds on 20260509085134_fix_verifier_runs_rls.sql by adding explicit,
-- descriptively-named policies for both service_role (INSERT + SELECT) and
-- authenticated (INSERT + SELECT) so the Verifier's audit-log write path is
-- safe even if service_role's default RLS bypass is ever revoked.
--
-- The pre-existing "anyone reads verifier_runs" SELECT policy is permissive
-- enough today, but a future hardening pass may scope reads tighter; the
-- explicit per-role policies below let us do that without losing the
-- service-role write path mid-deploy. anon is NOT granted any access.
-- =============================================================================

-- Idempotent enable (no-op if already on).
ALTER TABLE public.verifier_runs ENABLE ROW LEVEL SECURITY;

-- ── service_role: full INSERT + SELECT ───────────────────────────────────────
-- service_role bypasses RLS by default in Supabase, but being explicit
-- prevents silent breakage if that default ever changes or if the client
-- somehow lands on a non-bypassing role.

DROP POLICY IF EXISTS "service_role_insert_verifier_runs" ON public.verifier_runs;
CREATE POLICY "service_role_insert_verifier_runs"
  ON public.verifier_runs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_select_verifier_runs" ON public.verifier_runs;
CREATE POLICY "service_role_select_verifier_runs"
  ON public.verifier_runs
  FOR SELECT
  TO service_role
  USING (true);

-- ── authenticated: INSERT + SELECT ──────────────────────────────────────────
-- Permits the admin UI (and future internal tooling running under an
-- end-user's JWT) to read audit history and post manual audit entries.
-- anon is intentionally NOT granted access.

DROP POLICY IF EXISTS "authenticated_select_verifier_runs" ON public.verifier_runs;
CREATE POLICY "authenticated_select_verifier_runs"
  ON public.verifier_runs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_insert_verifier_runs" ON public.verifier_runs;
CREATE POLICY "authenticated_insert_verifier_runs"
  ON public.verifier_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMENT ON POLICY "service_role_insert_verifier_runs" ON public.verifier_runs IS
  'phase-1.10bb — explicit service_role INSERT so Verifier audit writes survive a future bypass-default change.';
COMMENT ON POLICY "service_role_select_verifier_runs" ON public.verifier_runs IS
  'phase-1.10bb — explicit service_role SELECT, paired with INSERT for symmetry.';
COMMENT ON POLICY "authenticated_insert_verifier_runs" ON public.verifier_runs IS
  'phase-1.10bb — admin UI and internal tooling can post audit entries while logged in.';
COMMENT ON POLICY "authenticated_select_verifier_runs" ON public.verifier_runs IS
  'phase-1.10bb — authenticated users (incl. admin UI) can read audit history.';
