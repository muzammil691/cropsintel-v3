-- Phase 1.10b-rem 005 — v_atlas_health helper view (idempotent).
--
-- Counts rows across the Atlas conductor / brain persistence tables. The
-- spec referenced pd_plans (V1 naming) but V3 ships pd_proposals; the DO
-- block builds the view body dynamically from whichever tables exist so the
-- view always returns a row without erroring when V1-named tables are absent.

DO $$
DECLARE
  parts text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.brain_nodes') IS NOT NULL THEN
    parts := parts || '(SELECT count(*) FROM public.brain_nodes) AS total_nodes';
  ELSE
    parts := parts || '0::bigint AS total_nodes';
  END IF;

  IF to_regclass('public.brain_discussions') IS NOT NULL THEN
    parts := parts || '(SELECT count(*) FROM public.brain_discussions) AS total_discussions';
  ELSE
    parts := parts || '0::bigint AS total_discussions';
  END IF;

  IF to_regclass('public.brain_node_history') IS NOT NULL THEN
    parts := parts || '(SELECT count(*) FROM public.brain_node_history) AS total_history_events';
  ELSE
    parts := parts || '0::bigint AS total_history_events';
  END IF;

  IF to_regclass('public.pd_plans') IS NOT NULL THEN
    parts := parts || '(SELECT count(*) FROM public.pd_plans) AS total_plans';
  ELSIF to_regclass('public.pd_proposals') IS NOT NULL THEN
    parts := parts || '(SELECT count(*) FROM public.pd_proposals) AS total_plans';
  ELSE
    parts := parts || '0::bigint AS total_plans';
  END IF;

  IF to_regclass('public.pd_decisions') IS NOT NULL THEN
    parts := parts || '(SELECT count(*) FROM public.pd_decisions) AS total_decisions';
  ELSE
    parts := parts || '0::bigint AS total_decisions';
  END IF;

  parts := parts || 'now() AS checked_at';

  EXECUTE 'CREATE OR REPLACE VIEW public.v_atlas_health AS SELECT '
    || array_to_string(parts, ', ');
END $$;
