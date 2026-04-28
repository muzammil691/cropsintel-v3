-- =============================================================================
-- Fix: enable RLS on user_roles + add policies
-- =============================================================================
-- The foundation migration (20260428000001) created the user_roles table but
-- forgot to enable RLS or add policies. This is a security gap because user_roles
-- holds the source of truth for who is admin/team — without RLS, any authenticated
-- request could read or modify roles.
--
-- This migration closes the gap.
-- =============================================================================

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role rows (so they can self-check their tier).
CREATE POLICY "users can read own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Team members can read all role rows (so the admin UI can list team).
CREATE POLICY "team can read all user_roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

-- Only admins can grant new roles.
CREATE POLICY "admins can insert user_roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can revoke roles.
CREATE POLICY "admins can delete user_roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Updates aren't typically needed for an enum-role table — block by default.
-- (No UPDATE policy = no UPDATE permission for non-service-role.)

-- Service role retains full access for edge functions / Adela.
CREATE POLICY "service_role full access user_roles"
  ON public.user_roles FOR ALL TO service_role USING (true) WITH CHECK (true);
