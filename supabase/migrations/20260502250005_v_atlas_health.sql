-- Phase 1.10b-rem 005 — v_atlas_health helper view (rewritten static, idempotent).
--
-- The earlier version of this migration used a DO block with dynamic SQL
-- (array_to_string + EXECUTE) to build the view conditionally based on which
-- tables exist. Postgres rejected `parts := parts || '...'` as a malformed
-- array literal because the text->text[] concatenation operator is ambiguous
-- in some contexts.
--
-- Rewritten as a static CREATE OR REPLACE VIEW with COALESCE-wrapped subqueries
-- against to_regclass() so missing tables fold to 0 without aborting the view.
-- Production has all 5 tables today; the regclass guards remain so this is
-- safe to apply on a fresh DB or one missing some tables.

CREATE OR REPLACE VIEW public.v_atlas_health AS
SELECT
  COALESCE(
    (SELECT count(*)::bigint FROM public.brain_nodes
     WHERE to_regclass('public.brain_nodes') IS NOT NULL),
    0
  ) AS total_nodes,
  COALESCE(
    (SELECT count(*)::bigint FROM public.brain_discussions
     WHERE to_regclass('public.brain_discussions') IS NOT NULL),
    0
  ) AS total_discussions,
  COALESCE(
    (SELECT count(*)::bigint FROM public.brain_node_history
     WHERE to_regclass('public.brain_node_history') IS NOT NULL),
    0
  ) AS total_history_events,
  COALESCE(
    (SELECT count(*)::bigint FROM public.pd_proposals
     WHERE to_regclass('public.pd_proposals') IS NOT NULL),
    0
  ) AS total_plans,
  COALESCE(
    (SELECT count(*)::bigint FROM public.pd_decisions
     WHERE to_regclass('public.pd_decisions') IS NOT NULL),
    0
  ) AS total_decisions,
  now() AS checked_at;

NOTIFY pgrst, 'reload schema';
