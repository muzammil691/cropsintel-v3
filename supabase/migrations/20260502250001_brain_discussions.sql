-- Phase 1.10b-rem 001 — brain_discussions table (idempotent remediation).
--
-- The richer schema from 20260501090000_brain_tables.sql is preserved when
-- this runs; the CREATE TABLE IF NOT EXISTS is a no-op there. The block also
-- adds the policies named in the remediation spec (admin all + team select),
-- using the V3 has_role() pattern so they actually work in production.

CREATE TABLE IF NOT EXISTS public.brain_discussions (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     uuid          REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
  thread_id   text          NOT NULL,
  author      text          NOT NULL,
  content     text          NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_discussions_node_id_idx
  ON public.brain_discussions (node_id);
CREATE INDEX IF NOT EXISTS brain_discussions_thread_id_idx
  ON public.brain_discussions (thread_id);

ALTER TABLE public.brain_discussions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all" ON public.brain_discussions;
CREATE POLICY "admin all" ON public.brain_discussions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "team select" ON public.brain_discussions;
CREATE POLICY "team select" ON public.brain_discussions FOR SELECT
  USING (public.has_role(auth.uid(), 'team'::public.app_role));
