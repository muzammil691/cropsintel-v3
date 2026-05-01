-- Phase 1.10ak — Atlas discussion queue.
--
-- The artifact-pane "Move to Discussion Queue" action parks a design audit,
-- open fork, pending spec, or plan node here so a human can think it over
-- without the artifact disappearing from the active list. Resolutions
-- ('queued' | 'dismissed' | 'forked') close out a row when the human acts.

CREATE TABLE IF NOT EXISTS public.atlas_discussion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text NOT NULL CHECK (
    artifact_kind IN ('design_audit', 'open_fork', 'pending_spec', 'plan_node')
  ),
  artifact_ref text NOT NULL,
  context jsonb NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text CHECK (
    resolution IS NULL OR resolution IN ('queued', 'dismissed', 'forked')
  )
);

CREATE INDEX IF NOT EXISTS idx_atlas_discussion_queue_unresolved
  ON public.atlas_discussion_queue (created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.atlas_discussion_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discussion_queue_service" ON public.atlas_discussion_queue;
CREATE POLICY "discussion_queue_service" ON public.atlas_discussion_queue
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Plan revisions audit table — stamped each time a user uploads or amends
-- the master plan via Atlas. Stores the diff summary the council writes
-- so the user can scan their plan-edit history in the UI.
CREATE TABLE IF NOT EXISTS public.atlas_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('upload', 'amend', 'reorder')),
  message text,
  diff_summary text,
  commit_sha text,
  before_size_bytes integer,
  after_size_bytes integer,
  actor_phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atlas_plan_revisions_created
  ON public.atlas_plan_revisions (created_at DESC);

ALTER TABLE public.atlas_plan_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_revisions_service" ON public.atlas_plan_revisions;
CREATE POLICY "plan_revisions_service" ON public.atlas_plan_revisions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
