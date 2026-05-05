-- =============================================================================
-- Migration: atlas_plan_node_state — mutable per-node state for the Plan tab
-- =============================================================================
-- Phase A.2 of the Plan-tab interactive build. The master plan markdown is
-- the source of truth for tree shape (titles, hierarchy) but it can't carry
-- mutable state like "this node is voided" or "Multi-Brain suggested it" —
-- writing those flags into markdown would mean Atlas rewrites the master
-- plan on every action, which is too noisy for git history.
--
-- This table separates STRUCTURE (markdown) from STATE (rows). The Plan tab
-- joins them at render-time: tree from markdown, status overlays from here.
--
-- States today (the CHECK enum):
--   voided                       — user marked this node as not-to-build.
--                                  Tree hides it by default; visible under
--                                  the "Voided" filter.
--   queued-no-build              — user clicked "Add to queue" without
--                                  triggering a build. Spec sits in the
--                                  builder queue waiting on user "Deploy".
--   suggested-by-multi-brain     — Multi-Brain debate produced a "you
--                                  should ship X next" recommendation. ⭐
--                                  badge in the Plan tab.
--   suggested-by-verifier        — same, from verifier's gap-research
--                                  debate when it flags a follow-up phase.
--   optional                     — explicitly marked as nice-to-have.
--                                  Different visual treatment than planned.
--
-- A node can carry multiple non-cleared states (e.g. queued-no-build +
-- suggested-by-multi-brain), but only one of each kind at a time — partial
-- UNIQUE on (plan_node_id, state) WHERE cleared_at IS NULL.
--
-- cleared_at lets us preserve audit history when a state is reverted (e.g.
-- "voided" then "recover") rather than hard-deleting rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.atlas_plan_node_state (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_node_id    text        NOT NULL,            -- matches PlanNode.id
  state           text        NOT NULL CHECK (
    state IN (
      'voided',
      'queued-no-build',
      'suggested-by-multi-brain',
      'suggested-by-verifier',
      'optional'
    )
  ),
  reason          text,
  set_by          text,                            -- 'user' / 'multi-brain' / 'verifier' / 'atlas-auto'
  set_at          timestamptz NOT NULL DEFAULT now(),
  cleared_at      timestamptz,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS atlas_plan_node_state_active_key
  ON public.atlas_plan_node_state (plan_node_id, state)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_atlas_plan_node_state_lookup
  ON public.atlas_plan_node_state (plan_node_id)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_atlas_plan_node_state_recent
  ON public.atlas_plan_node_state (set_at DESC);

ALTER TABLE public.atlas_plan_node_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atlas_plan_node_state_service" ON public.atlas_plan_node_state;
CREATE POLICY "atlas_plan_node_state_service" ON public.atlas_plan_node_state
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.atlas_plan_node_state IS
  'Phase A.2: mutable per-node state for Plan tab actions (void / queue-no-build / suggestions). Master plan markdown carries structure; this carries overlay state.';

NOTIFY pgrst, 'reload schema';
