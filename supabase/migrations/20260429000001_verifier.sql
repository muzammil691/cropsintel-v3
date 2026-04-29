-- Migration: Verification Agent audit table (phase-1.00b)
-- Records every verifier run so the agent loop can track which tasks have been verified.

CREATE TABLE IF NOT EXISTS public.verifier_runs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id              text        NOT NULL,          -- 'phase-1.04-rbac' etc.
  task_spec_path       text        NOT NULL,          -- path to the task .md file
  commit_sha           text        NOT NULL,          -- the commit being verified
  mode                 text        NOT NULL CHECK (mode IN ('audit-only','gate')),
  passed               boolean     NOT NULL,
  gaps                 jsonb       DEFAULT '[]'::jsonb, -- [{check, expected, actual, severity}]
  remediation_task_id  text,                          -- set if a remediation task was created
  duration_ms          int,
  ran_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verifier_runs ENABLE ROW LEVEL SECURITY;

-- Team members can read all verifier runs (for the Phase 2 admin UI)
CREATE POLICY "Team can read verifier runs"
  ON public.verifier_runs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'team'));

-- The verifier service uses the service-role key which bypasses RLS.
-- This policy allows insert via the anon key as a fallback (rate-limited by service design).
CREATE POLICY "Service can insert verifier runs"
  ON public.verifier_runs
  FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE public.verifier_runs IS
  'Audit log of every Verification Agent run. Each row = one task verification attempt.';
