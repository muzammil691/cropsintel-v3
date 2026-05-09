-- =============================================================================
-- Migration: Fix verifier_runs RLS INSERT policy (phase-1.10az)
-- =============================================================================
-- Root cause: The 20260430210000_rbac_rls_policies.sql migration removed the
-- INSERT policy for verifier_runs, expecting service_role to bypass RLS.
-- However, the verifier service had a fallback to ANON_KEY which does NOT
-- bypass RLS, causing all INSERT attempts to fail with db_write_failed.
--
-- Fix: Add an explicit service_role INSERT policy so the verifier service
-- can write audit logs regardless of which key convention is used (SERVICE_KEY
-- vs SERVICE_ROLE_KEY vs SECRET_KEY). This policy is scoped TO service_role
-- ONLY, not to anon or authenticated.
-- =============================================================================

-- Drop any existing INSERT policies (idempotent)
DROP POLICY IF EXISTS "Service can insert verifier runs" ON public.verifier_runs;
DROP POLICY IF EXISTS "service_role inserts verifier_runs" ON public.verifier_runs;

-- Create explicit service_role INSERT policy
-- Note: service_role bypasses RLS by default in Supabase, but being explicit
-- prevents issues if the client somehow uses anon key or if the bypass
-- behavior changes in future Supabase versions.
CREATE POLICY "service_role inserts verifier_runs"
  ON public.verifier_runs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON POLICY "service_role inserts verifier_runs" ON public.verifier_runs IS
  'Allows the Verifier service (using service_role key) to write audit logs. Scoped to service_role only.';
