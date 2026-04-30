-- Atlas: Conductor agent tables (Phase 1.10b)
-- Five tables: conversations, snapshots, dispatches, decisions, cost_log

-- 4.1 Conversation thread (chat history, mirrored across web/WhatsApp/mobile)
CREATE TABLE IF NOT EXISTS public.atlas_conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   text        NOT NULL,
  channel     text        NOT NULL,  -- 'web' | 'whatsapp' | 'mobile-pwa'
  role        text        NOT NULL,  -- 'user' | 'atlas' | 'system'
  content     text        NOT NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read conversations" ON public.atlas_conversations
  FOR SELECT USING (true);

-- INSERT is service_role only — service_role bypasses RLS, so no INSERT policy needed for authenticated users

CREATE INDEX IF NOT EXISTS idx_atlas_conv_thread
  ON public.atlas_conversations (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_conv_channel
  ON public.atlas_conversations (channel, created_at DESC);

-- 4.2 Snapshots (project mental model, written every 5 min by cron)
CREATE TABLE IF NOT EXISTS public.atlas_snapshots (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at              timestamptz  NOT NULL DEFAULT now(),
  current_phase         text,
  queued_specs          int,
  in_flight_specs       int,
  done_specs_24h        int,
  failed_specs_24h      int,
  verifier_pass_rate    numeric(5,2),
  memory_chunk_count    int,
  cost_today_usd        numeric(10,4),
  cost_month_to_date_usd numeric(10,4),
  open_forks            jsonb        NOT NULL DEFAULT '[]',
  raw_state             jsonb        NOT NULL DEFAULT '{}'
);

ALTER TABLE public.atlas_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read snapshots" ON public.atlas_snapshots
  FOR SELECT USING (true);

-- INSERT/UPDATE is service_role only — service_role bypasses RLS

CREATE INDEX IF NOT EXISTS idx_atlas_snapshots_taken_at
  ON public.atlas_snapshots (taken_at DESC);

-- 4.3 Dispatch log (every action Atlas takes)
CREATE TABLE IF NOT EXISTS public.atlas_dispatches (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_at  timestamptz  NOT NULL DEFAULT now(),
  trust_mode    text         NOT NULL,
  initiated_by  text         NOT NULL,  -- 'cron' | 'chat:<thread_id>' | 'auto'
  tool          text         NOT NULL,
  arguments     jsonb        NOT NULL,
  result        jsonb,
  cost_usd      numeric(10,4)           DEFAULT 0,
  duration_ms   int,
  status        text         NOT NULL   DEFAULT 'pending',
  error_message text
);

ALTER TABLE public.atlas_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read dispatches" ON public.atlas_dispatches
  FOR SELECT USING (true);

-- INSERT/UPDATE is service_role only — service_role bypasses RLS

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_status
  ON public.atlas_dispatches (status, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_tool
  ON public.atlas_dispatches (tool, initiated_at DESC);

-- 4.4 Decision log (architectural forks resolved)
CREATE TABLE IF NOT EXISTS public.atlas_decisions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at          timestamptz NOT NULL DEFAULT now(),
  fork_question       text        NOT NULL,
  options_considered  jsonb       NOT NULL,
  multi_brain_votes   jsonb,
  chosen_option       text        NOT NULL,
  rationale           text,
  decided_by          text        NOT NULL,  -- 'user' | 'atlas-auto' | 'multi-brain-quorum'
  related_phase       text,
  related_specs       text[]
);

ALTER TABLE public.atlas_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read decisions" ON public.atlas_decisions
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert decisions" ON public.atlas_decisions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update decisions" ON public.atlas_decisions
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_atlas_decisions_decided_at
  ON public.atlas_decisions (decided_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_decisions_phase
  ON public.atlas_decisions (related_phase);

-- 4.5 Cost log (per-call AI spend)
CREATE TABLE IF NOT EXISTS public.atlas_cost_log (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      timestamptz  NOT NULL DEFAULT now(),
  provider         text         NOT NULL,  -- 'anthropic' | 'openai' | 'google' | 'elevenlabs'
  service          text         NOT NULL,  -- 'atlas' | 'council' | 'verifier' | etc.
  model            text,
  input_tokens     int,
  output_tokens    int,
  cost_usd         numeric(10,4) NOT NULL,
  request_metadata jsonb
);

ALTER TABLE public.atlas_cost_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cost log" ON public.atlas_cost_log
  FOR SELECT USING (true);

-- INSERT is service_role only — service_role bypasses RLS

CREATE INDEX IF NOT EXISTS idx_atlas_cost_log_occurred_at
  ON public.atlas_cost_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_log_provider
  ON public.atlas_cost_log (provider, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_log_service
  ON public.atlas_cost_log (service, occurred_at DESC);

-- Helper views for cost burn monitoring

CREATE OR REPLACE VIEW public.atlas_cost_today AS
SELECT
  provider,
  service,
  SUM(cost_usd)       AS cost_usd,
  SUM(input_tokens)   AS input_tokens,
  SUM(output_tokens)  AS output_tokens,
  COUNT(*)            AS call_count
FROM public.atlas_cost_log
WHERE occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
GROUP BY provider, service;

CREATE OR REPLACE VIEW public.atlas_cost_month_to_date AS
SELECT
  provider,
  SUM(cost_usd)  AS cost_usd,
  COUNT(*)       AS call_count
FROM public.atlas_cost_log
WHERE occurred_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
GROUP BY provider;
