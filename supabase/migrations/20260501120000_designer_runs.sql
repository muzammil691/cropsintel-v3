-- Migration: phase-1.10ag — Designer audit log table fixes
--
-- Purpose:
--   1. Ensure public.designer_runs exists in V3 Supabase (the 1.10n migration
--      defined it but logs from 2026-05-01 show "Could not find the table
--      'public.designer_runs' in the schema cache" — re-applying idempotently
--      is the safest fix and adds the columns introduced in this phase.
--   2. Add head_before / head_after / screenshot_url columns so audit-commit
--      runs persist the commit range and rendered preview pointer.
--   3. Tighten RLS policies to service-role-only writes (the prior policy
--      allowed any role to insert, which was overly permissive).

CREATE TABLE IF NOT EXISTS public.designer_runs (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        text          NOT NULL,
  operation      text          NOT NULL,
  verdict        text          NOT NULL,
  confidence     numeric(3,2),
  gaps           jsonb         DEFAULT '[]'::jsonb,
  ai_judgment    jsonb         DEFAULT '{}'::jsonb,
  cost_usd       numeric(10,4) DEFAULT 0,
  duration_ms    int,
  head_before    text,
  head_after     text,
  screenshot_url text,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

-- Add columns if the table was created by the older 20260430000002_designer.sql
-- migration without these fields.
ALTER TABLE public.designer_runs
  ADD COLUMN IF NOT EXISTS head_before    text,
  ADD COLUMN IF NOT EXISTS head_after     text,
  ADD COLUMN IF NOT EXISTS screenshot_url text;

ALTER TABLE public.designer_runs ENABLE ROW LEVEL SECURITY;

-- Replace the permissive policies from 1.10n with service-role-scoped ones.
DROP POLICY IF EXISTS "Anyone can read designer runs"     ON public.designer_runs;
DROP POLICY IF EXISTS "Service can insert designer runs"  ON public.designer_runs;
DROP POLICY IF EXISTS "designer_runs_service_role_write"  ON public.designer_runs;
DROP POLICY IF EXISTS "designer_runs_admin_team_read"     ON public.designer_runs;

CREATE POLICY "designer_runs_service_role_write"
  ON public.designer_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "designer_runs_admin_team_read"
  ON public.designer_runs
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'team')
    OR auth.role() = 'service_role'
  );

CREATE INDEX IF NOT EXISTS idx_designer_runs_task
  ON public.designer_runs (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_designer_runs_verdict
  ON public.designer_runs (verdict, created_at DESC);

COMMENT ON TABLE public.designer_runs IS
  'Audit log of every Designer Agent run (review-spec | audit-commit). Service-role writes only.';
