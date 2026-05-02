-- Phase 1.10b — Atlas schema (classification, actions, chat, cost ledger)
--
-- Adds five Atlas-runtime tables, supporting indexes, daily/MTD cost views,
-- and RLS policies. Uses IF NOT EXISTS so the migration is safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CREATE TABLE statements
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 atlas_decisions — Atlas classification decisions
CREATE TABLE IF NOT EXISTS public.atlas_decisions (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text         NOT NULL,
  artifact_ref  text         NOT NULL,
  bucket        text         NOT NULL,
  reason        text,
  payload       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- 1.2 atlas_actions — in-app actions taken on a decision
CREATE TABLE IF NOT EXISTS public.atlas_actions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     uuid         NOT NULL REFERENCES public.atlas_decisions(id) ON DELETE CASCADE,
  action_id       text         NOT NULL,
  action_payload  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  status          text         NOT NULL DEFAULT 'pending',
  executed_at     timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- 1.3 atlas_chat_sessions — chat sessions
CREATE TABLE IF NOT EXISTS public.atlas_chat_sessions (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- 1.4 atlas_chat_messages — chat messages within a session
CREATE TABLE IF NOT EXISTS public.atlas_chat_messages (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid         NOT NULL REFERENCES public.atlas_chat_sessions(id) ON DELETE CASCADE,
  role        text         NOT NULL,
  content     text         NOT NULL,
  tokens_in   int          NOT NULL DEFAULT 0,
  tokens_out  int          NOT NULL DEFAULT 0,
  model       text,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- 1.5 atlas_cost_events — token / cost ledger
CREATE TABLE IF NOT EXISTS public.atlas_cost_events (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text           NOT NULL,
  model       text           NOT NULL,
  tokens_in   int            NOT NULL DEFAULT 0,
  tokens_out  int            NOT NULL DEFAULT 0,
  cost_usd    numeric(10,6)  NOT NULL DEFAULT 0,
  task_id     text,
  created_at  timestamptz    NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_atlas_decisions_artifact
  ON public.atlas_decisions (artifact_kind, artifact_ref);

CREATE INDEX IF NOT EXISTS idx_atlas_decisions_created_at
  ON public.atlas_decisions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_actions_decision_id
  ON public.atlas_actions (decision_id);

CREATE INDEX IF NOT EXISTS idx_atlas_chat_messages_session
  ON public.atlas_chat_messages (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_events_created_at
  ON public.atlas_cost_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_events_provider_model
  ON public.atlas_cost_events (provider, model);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.atlas_cost_today AS
SELECT
  provider,
  model,
  SUM(cost_usd)   AS cost_usd,
  SUM(tokens_in)  AS tokens_in,
  SUM(tokens_out) AS tokens_out
FROM public.atlas_cost_events
WHERE created_at::date = current_date
GROUP BY provider, model;

CREATE OR REPLACE VIEW public.atlas_cost_month_to_date AS
SELECT
  provider,
  model,
  SUM(cost_usd)   AS cost_usd,
  SUM(tokens_in)  AS tokens_in,
  SUM(tokens_out) AS tokens_out
FROM public.atlas_cost_events
WHERE date_trunc('month', created_at) = date_trunc('month', now())
GROUP BY provider, model;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 atlas_decisions
ALTER TABLE public.atlas_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_decisions service_role select" ON public.atlas_decisions;
CREATE POLICY "atlas_decisions service_role select" ON public.atlas_decisions
  FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_decisions service_role insert" ON public.atlas_decisions;
CREATE POLICY "atlas_decisions service_role insert" ON public.atlas_decisions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_decisions service_role update" ON public.atlas_decisions;
CREATE POLICY "atlas_decisions service_role update" ON public.atlas_decisions
  FOR UPDATE USING (auth.role() = 'service_role');

-- 4.2 atlas_actions
ALTER TABLE public.atlas_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_actions service_role select" ON public.atlas_actions;
CREATE POLICY "atlas_actions service_role select" ON public.atlas_actions
  FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_actions service_role insert" ON public.atlas_actions;
CREATE POLICY "atlas_actions service_role insert" ON public.atlas_actions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_actions service_role update" ON public.atlas_actions;
CREATE POLICY "atlas_actions service_role update" ON public.atlas_actions
  FOR UPDATE USING (auth.role() = 'service_role');

-- 4.3 atlas_chat_sessions (has user_id — owners can also read their own)
ALTER TABLE public.atlas_chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_chat_sessions select" ON public.atlas_chat_sessions;
CREATE POLICY "atlas_chat_sessions select" ON public.atlas_chat_sessions
  FOR SELECT USING (auth.role() = 'service_role' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "atlas_chat_sessions service_role insert" ON public.atlas_chat_sessions;
CREATE POLICY "atlas_chat_sessions service_role insert" ON public.atlas_chat_sessions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_chat_sessions service_role update" ON public.atlas_chat_sessions;
CREATE POLICY "atlas_chat_sessions service_role update" ON public.atlas_chat_sessions
  FOR UPDATE USING (auth.role() = 'service_role');

-- 4.4 atlas_chat_messages
ALTER TABLE public.atlas_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_chat_messages service_role select" ON public.atlas_chat_messages;
CREATE POLICY "atlas_chat_messages service_role select" ON public.atlas_chat_messages
  FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_chat_messages service_role insert" ON public.atlas_chat_messages;
CREATE POLICY "atlas_chat_messages service_role insert" ON public.atlas_chat_messages
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_chat_messages service_role update" ON public.atlas_chat_messages;
CREATE POLICY "atlas_chat_messages service_role update" ON public.atlas_chat_messages
  FOR UPDATE USING (auth.role() = 'service_role');

-- 4.5 atlas_cost_events
ALTER TABLE public.atlas_cost_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atlas_cost_events service_role select" ON public.atlas_cost_events;
CREATE POLICY "atlas_cost_events service_role select" ON public.atlas_cost_events
  FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_cost_events service_role insert" ON public.atlas_cost_events;
CREATE POLICY "atlas_cost_events service_role insert" ON public.atlas_cost_events
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_cost_events service_role update" ON public.atlas_cost_events;
CREATE POLICY "atlas_cost_events service_role update" ON public.atlas_cost_events
  FOR UPDATE USING (auth.role() = 'service_role');
