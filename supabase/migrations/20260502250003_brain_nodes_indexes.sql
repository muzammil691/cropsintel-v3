-- Phase 1.10b-rem 003 — brain_nodes indexes on (node_key, score).
--
-- node_key already has a UNIQUE constraint (and therefore an implicit index),
-- but the audit asked for an explicit named index alongside score. Both are
-- created idempotently. If brain_nodes is missing for any reason, the DO
-- block skips quietly so the migration stays safe to re-run in any env.

DO $$
BEGIN
  IF to_regclass('public.brain_nodes') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS brain_nodes_node_key_idx ON public.brain_nodes (node_key)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS brain_nodes_score_idx    ON public.brain_nodes (score)';
  END IF;
END $$;
