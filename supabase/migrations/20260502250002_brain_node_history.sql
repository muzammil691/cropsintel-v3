-- Phase 1.10b-rem 002 — brain_node_history table (idempotent remediation).
--
-- The richer schema from 20260501090000_brain_tables.sql is preserved when
-- this runs; the CREATE TABLE IF NOT EXISTS is a no-op there. Adds the
-- spec-named indexes and policies idempotently, using V3 has_role().

CREATE TABLE IF NOT EXISTS public.brain_node_history (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      uuid          REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
  changed_by   text          NOT NULL,
  change_type  text          NOT NULL,
  before       jsonb,
  after        jsonb,
  changed_at   timestamptz   NOT NULL DEFAULT now()
);

-- Backfill columns onto the V1-shaped row that already exists in V3 — only
-- runs when the column is missing so the production table is unaffected.
ALTER TABLE public.brain_node_history
  ADD COLUMN IF NOT EXISTS changed_by  text,
  ADD COLUMN IF NOT EXISTS change_type text,
  ADD COLUMN IF NOT EXISTS before      jsonb,
  ADD COLUMN IF NOT EXISTS after       jsonb,
  ADD COLUMN IF NOT EXISTS changed_at  timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS brain_node_history_node_id_idx
  ON public.brain_node_history (node_id);
CREATE INDEX IF NOT EXISTS brain_node_history_changed_at_idx
  ON public.brain_node_history (changed_at);

ALTER TABLE public.brain_node_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all" ON public.brain_node_history;
CREATE POLICY "admin all" ON public.brain_node_history FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "team select" ON public.brain_node_history;
CREATE POLICY "team select" ON public.brain_node_history FOR SELECT
  USING (public.has_role(auth.uid(), 'team'::public.app_role));
