-- Migration: Designer agent audit table (phase-1.10n)
-- Records every Designer run (review-spec or audit-commit) so the agent loop
-- can track which UI tasks have been reviewed and what gaps were found.

CREATE TABLE IF NOT EXISTS public.designer_runs (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       text          NOT NULL,
  operation     text          NOT NULL CHECK (operation IN ('review-spec','audit-commit')),
  verdict       text          NOT NULL CHECK (verdict IN ('pass','fail','unknown')),
  confidence    numeric(3,2),
  gaps          jsonb         DEFAULT '[]'::jsonb,        -- [{check, severity, description, fix, file, line}]
  ai_judgment   jsonb         DEFAULT '{}'::jsonb,        -- {claude: {verdict, reasoning, costUsd}, gptVision: {...}}
  cost_usd      numeric(10,4) DEFAULT 0,
  duration_ms   int,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.designer_runs ENABLE ROW LEVEL SECURITY;

-- Read access: anyone can read designer runs (per spec)
CREATE POLICY "Anyone can read designer runs"
  ON public.designer_runs
  FOR SELECT
  USING (true);

-- The designer service uses the service-role key which bypasses RLS.
-- This policy allows insert via the anon key as a fallback.
CREATE POLICY "Service can insert designer runs"
  ON public.designer_runs
  FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_designer_runs_task
  ON public.designer_runs (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_designer_runs_verdict
  ON public.designer_runs (verdict, created_at DESC);

COMMENT ON TABLE public.designer_runs IS
  'Audit log of every Designer Agent run. Each row = one UI design review (spec or commit).';
