-- Phase 1.10z — atlas_events instrumentation table
--
-- Append-only event stream from anywhere in the V3 product (frontend + edge
-- functions + Railway services). Drives Atlas's project-wide observability.
-- V1 accumulated 41,123 rows in this pattern; V3 starts fresh with the same
-- shape so admin tooling can be rebuilt cleanly.
--
-- Insert is open to authenticated users (own user_id only) so any client can
-- emit. Read is restricted to team/admin via has_role().

CREATE TABLE IF NOT EXISTS public.atlas_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_category text NOT NULL,
  source text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'info',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid REFERENCES auth.users(id),
  session_id text,
  page_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atlas_events_severity_chk
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT atlas_events_category_chk
    CHECK (event_category IN ('atlas', 'ai', 'ui', 'data', 'auth'))
);

ALTER TABLE public.atlas_events ENABLE ROW LEVEL SECURITY;

-- Insert open to authenticated users — instrumentation must always work
DROP POLICY IF EXISTS "atlas_events_insert_authed" ON public.atlas_events;
CREATE POLICY "atlas_events_insert_authed"
  ON public.atlas_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Read restricted to team / admin tier
DROP POLICY IF EXISTS "atlas_events_read_admin" ON public.atlas_events;
CREATE POLICY "atlas_events_read_admin"
  ON public.atlas_events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'team'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE INDEX IF NOT EXISTS idx_atlas_events_created
  ON public.atlas_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_events_type_category
  ON public.atlas_events (event_type, event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_events_user
  ON public.atlas_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_events_severity
  ON public.atlas_events (severity, created_at DESC)
  WHERE severity IN ('error', 'critical');

COMMENT ON TABLE public.atlas_events IS
  'Phase 1.10z — append-only event stream feeding Atlas observability. See drAtlas client SDK at src/lib/drAtlas.ts.';
