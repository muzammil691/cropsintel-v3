-- Phase 1.10ao — Atlas team management.
--
-- Replaces the env-var ATLAS_ALLOWED_PHONES allowlist with a DB-backed
-- members table + invitation flow + scoped roles. Multiple collaborators
-- can use Atlas without sharing one login; the owner can invite, revoke,
-- and modify member roles via the team UI.

CREATE TABLE IF NOT EXISTS public.atlas_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  invited_by uuid REFERENCES public.atlas_members(id),
  invited_at timestamptz NOT NULL DEFAULT now(),
  first_login_at timestamptz,
  last_seen_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_members_phone_active
  ON public.atlas_members (phone) WHERE status = 'active';

-- Seed the owner so the system isn't empty on first deploy. The upsert
-- pattern means a manual prior insert won't conflict.
INSERT INTO public.atlas_members (phone, display_name, role, status, invited_at, first_login_at)
VALUES ('+971562556592', 'Muzammil', 'owner', 'active', now(), now())
ON CONFLICT (phone) DO UPDATE SET role = 'owner', status = 'active';

ALTER TABLE public.atlas_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_members_service" ON public.atlas_members;
CREATE POLICY "atlas_members_service" ON public.atlas_members
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Pending invites: a separate row scheme so a phone can be invited before
-- it has ever logged in (no atlas_members row yet). On first login the
-- invite is consumed atomically with the member row creation.
CREATE TABLE IF NOT EXISTS public.atlas_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','operator','viewer')),
  display_name text,
  invited_by uuid NOT NULL REFERENCES public.atlas_members(id),
  invite_token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_invites_phone
  ON public.atlas_invites (phone) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_invites_token
  ON public.atlas_invites (invite_token) WHERE consumed_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.atlas_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_invites_service" ON public.atlas_invites;
CREATE POLICY "atlas_invites_service" ON public.atlas_invites
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Audit log for every team-management action (invite, revoke, role-change,
-- suspension, session revoke). Owner-only readable, written by the routes
-- in atlas/src/server.ts.
CREATE TABLE IF NOT EXISTS public.atlas_team_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.atlas_members(id),
  actor_phone text,
  action text NOT NULL,
  target_member_id uuid REFERENCES public.atlas_members(id),
  target_invite_id uuid REFERENCES public.atlas_invites(id),
  target_phone text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_team_audit_created_at
  ON public.atlas_team_audit (created_at DESC);
ALTER TABLE public.atlas_team_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_team_audit_service" ON public.atlas_team_audit;
CREATE POLICY "atlas_team_audit_service" ON public.atlas_team_audit
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Add role + member_id columns to atlas_sessions so a session token carries
-- the role at issue-time. On role change or revoke, all sessions for the
-- member are revoked, forcing re-auth (and re-issuance with the new role).
ALTER TABLE public.atlas_sessions
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.atlas_members(id);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_member_active
  ON public.atlas_sessions (member_id) WHERE revoked_at IS NULL;
