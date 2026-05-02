-- Phase 1.10au — Team portal mirror.
--
-- Adds two tables that power the team-facing portal at /team:
--
--   atlas_team_assignments — items the owner has routed to a team member
--     (or broadcast to all admins). Each row links an artifact (verifier
--     run, designer audit, open fork, manual report) to a member, with a
--     resolution lifecycle (open → fixed | escalated | dismissed).
--
--   atlas_team_reports — observations / errors a team member has reported
--     back to Atlas without the owner being online. Each row carries a
--     subject, free-text description, severity, and optional attachments
--     (Supabase Storage signed URLs only, never raw blobs). Triage moves
--     them through new → triaged → resolved | dismissed.
--
-- Both tables are service-role only at the RLS layer — every read/write
-- routes through the Atlas server which enforces role checks per request.

CREATE TABLE IF NOT EXISTS public.atlas_team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text NOT NULL,
  artifact_ref text NOT NULL,
  assigned_to_member_id uuid REFERENCES public.atlas_members(id),
  assigned_by uuid REFERENCES public.atlas_members(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','escalated','dismissed')),
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_team_assignments_open
  ON public.atlas_team_assignments (assigned_to_member_id, status, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_atlas_team_assignments_artifact
  ON public.atlas_team_assignments (artifact_kind, artifact_ref);

CREATE TABLE IF NOT EXISTS public.atlas_team_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_member_id uuid NOT NULL REFERENCES public.atlas_members(id),
  subject text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz,
  triaged_by uuid REFERENCES public.atlas_members(id),
  triage_notes text
);
CREATE INDEX IF NOT EXISTS idx_atlas_team_reports_new
  ON public.atlas_team_reports (status, created_at DESC) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_atlas_team_reports_reporter
  ON public.atlas_team_reports (reporter_member_id, created_at DESC);

ALTER TABLE public.atlas_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_team_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_team_assignments_service" ON public.atlas_team_assignments;
CREATE POLICY "atlas_team_assignments_service" ON public.atlas_team_assignments
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_team_reports_service" ON public.atlas_team_reports;
CREATE POLICY "atlas_team_reports_service" ON public.atlas_team_reports
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
