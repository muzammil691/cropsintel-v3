-- Phase 1.10b-rem 004 — complete RLS on pd_decisions (admin all + team select).
--
-- Existing 20260501100000_pd_tables.sql added insert+select policies but no
-- explicit "admin all" / "team select" pair. Multiple permissive policies are
-- OR'd in PostgreSQL, so this remediation does not loosen anything that was
-- previously locked down — admin/team retain access, others stay denied.

DO $$
BEGIN
  IF to_regclass('public.pd_decisions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pd_decisions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DROP POLICY IF EXISTS "admin all"   ON public.pd_decisions;
DROP POLICY IF EXISTS "team select" ON public.pd_decisions;

CREATE POLICY "admin all" ON public.pd_decisions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "team select" ON public.pd_decisions FOR SELECT
  USING (public.has_role(auth.uid(), 'team'::public.app_role));
