-- Phase 1.10aa — brain tables (Multi-Brain backend storage).
--
-- Three tables backing the /atlas-brain UI and brain-ai edge function:
--   brain_nodes        — durable nodes scored 0..100 representing facets
--                        of the V3 system (agents, processes, infra, etc.)
--   brain_discussions  — every message in a debate thread (human prompt,
--                        per-model opinions, consensus verdict)
--   brain_node_history — every score change, with reason + actor
--
-- All three are admin/team-only via has_role() RLS. Service role bypasses
-- RLS so the brain-ai edge function can write freely.

CREATE TABLE IF NOT EXISTS public.brain_nodes (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key    text          UNIQUE NOT NULL,
  label       text          NOT NULL,
  description text,
  category    text,                                  -- 'agent' | 'product' | 'infra' | 'process'
  status      text          NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'archived'
  score       numeric(5,2)  DEFAULT 0,
  metadata    jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brain_discussions (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      uuid          NOT NULL REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
  thread_id    uuid          NOT NULL,
  author       text          NOT NULL,                    -- 'human' | 'claude' | 'gpt' | 'gemini' | 'consensus'
  message_type text          NOT NULL DEFAULT 'comment',  -- 'prompt' | 'comment' | 'ai_analysis' | 'consensus' | 'decision'
  content      text          NOT NULL,
  cost_usd     numeric(10,4) DEFAULT 0,
  metadata     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brain_node_history (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id           uuid          NOT NULL REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
  score_before      numeric(5,2),
  score_after       numeric(5,2),
  reason            text          NOT NULL,
  changed_by        text          NOT NULL,  -- 'human:<user_id>' | 'consensus' | 'auto'
  related_thread_id uuid,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.brain_nodes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_discussions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_node_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brain_nodes_admin_team" ON public.brain_nodes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE POLICY "brain_discussions_admin_team" ON public.brain_discussions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE POLICY "brain_node_history_admin_team" ON public.brain_node_history FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'team'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_brain_discussions_node_thread
  ON public.brain_discussions (node_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_brain_node_history_node
  ON public.brain_node_history (node_id, created_at DESC);

-- Auto-bump updated_at on brain_nodes
CREATE OR REPLACE FUNCTION public.brain_nodes_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brain_nodes_touch_updated_at ON public.brain_nodes;
CREATE TRIGGER trg_brain_nodes_touch_updated_at
  BEFORE UPDATE ON public.brain_nodes
  FOR EACH ROW EXECUTE FUNCTION public.brain_nodes_touch_updated_at();

-- Seed starter brain nodes — one row per V3 facet worth scoring.
INSERT INTO public.brain_nodes (node_key, label, description, category, score) VALUES
  ('atlas-conductor-quality',     'Atlas conductor quality',      'How well does Atlas decide what to build next?',                   'agent',   70),
  ('verifier-strict-gate',        'Verifier strict gate',         'Tightness of Verifier audits + remediation accuracy',              'agent',   80),
  ('designer-tokens-enforcement', 'Designer tokens enforcement',  'Adherence to design system tokens across UI',                       'agent',   50),
  ('memory-recall-accuracy',      'Memory recall accuracy',       'Quality of memory.search results',                                  'agent',   65),
  ('adela-scrape-freshness',      'Adela scrape freshness',       'How current is the market data Adela ingests',                      'agent',    0),
  ('zyra-prompt-defense',         'Zyra prompt defense',          'Resistance to prompt injection / jailbreak',                        'agent',    0),
  ('rls-information-walls',       'RLS information walls',        'Are customer/broker/supplier data walls enforced?',                 'process', 75),
  ('build-loop-throughput',       'Build loop throughput',        'Specs shipped per hour by Builder',                                 'infra',   85),
  ('cost-budget-discipline',      'Cost budget discipline',       'Stay under $400/mo AI spend',                                       'process', 95)
ON CONFLICT (node_key) DO NOTHING;
