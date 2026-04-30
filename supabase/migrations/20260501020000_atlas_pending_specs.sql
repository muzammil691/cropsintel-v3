-- Phase 1.10r — Atlas as primary spec author
-- Persists drafted-but-not-yet-queued specs across chat sessions, so a user who replies
-- "YES" minutes after the draft can still resolve it even after context rotates.

CREATE TABLE IF NOT EXISTS public.atlas_pending_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  spec_markdown text NOT NULL,
  filename text NOT NULL,
  drafted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  resolved_at timestamptz,
  resolution text -- 'queued' | 'cancelled' | 'expired'
);

CREATE INDEX IF NOT EXISTS idx_atlas_pending_specs_thread_drafted
  ON public.atlas_pending_specs (thread_id, drafted_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_pending_specs_unresolved
  ON public.atlas_pending_specs (expires_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.atlas_pending_specs ENABLE ROW LEVEL SECURITY;

-- Service-role only (Atlas is the only writer; admin dashboards read via service key)
CREATE POLICY "Service role full access on atlas_pending_specs"
  ON public.atlas_pending_specs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
