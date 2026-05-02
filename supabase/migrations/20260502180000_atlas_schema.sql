-- Phase 1.10b — Atlas persistence schema
-- Five tables (conversations, snapshots, dispatches, decisions, cost_log),
-- supporting indexes, RLS, and cost roll-up views.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

-- 1.1 atlas_conversations
CREATE TABLE IF NOT EXISTS public.atlas_conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 1.2 atlas_snapshots
CREATE TABLE IF NOT EXISTS public.atlas_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        REFERENCES public.atlas_conversations(id) ON DELETE CASCADE,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 1.3 atlas_dispatches
CREATE TABLE IF NOT EXISTS public.atlas_dispatches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        REFERENCES public.atlas_conversations(id) ON DELETE CASCADE,
  tool            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  input           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- 1.4 atlas_decisions
CREATE TABLE IF NOT EXISTS public.atlas_decisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text        NOT NULL,
  artifact_ref  text        NOT NULL,
  bucket        text        NOT NULL,
  reason        text,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 1.5 atlas_cost_log
CREATE TABLE IF NOT EXISTS public.atlas_cost_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text        NOT NULL,
  service     text        NOT NULL,
  model       text,
  tokens_in   int         NOT NULL DEFAULT 0,
  tokens_out  int         NOT NULL DEFAULT 0,
  usd_cost    numeric(12,6) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_atlas_snapshots_conv_created
  ON public.atlas_snapshots (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_status
  ON public.atlas_dispatches (status);

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_tool
  ON public.atlas_dispatches (tool);

CREATE INDEX IF NOT EXISTS idx_atlas_decisions_artifact
  ON public.atlas_decisions (artifact_kind, artifact_ref);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_log_provider_created
  ON public.atlas_cost_log (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_log_service_created
  ON public.atlas_cost_log (service, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.atlas_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_dispatches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_cost_log      ENABLE ROW LEVEL SECURITY;

-- 3.1 atlas_conversations — owner-scoped
DROP POLICY IF EXISTS "atlas_conversations_select" ON public.atlas_conversations;
CREATE POLICY "atlas_conversations_select" ON public.atlas_conversations
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "atlas_conversations_insert" ON public.atlas_conversations;
CREATE POLICY "atlas_conversations_insert" ON public.atlas_conversations
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "atlas_conversations_update" ON public.atlas_conversations;
CREATE POLICY "atlas_conversations_update" ON public.atlas_conversations
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  );

-- 3.2 atlas_snapshots — scoped via parent conversation
DROP POLICY IF EXISTS "atlas_snapshots_select" ON public.atlas_snapshots;
CREATE POLICY "atlas_snapshots_select" ON public.atlas_snapshots
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_snapshots.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "atlas_snapshots_insert" ON public.atlas_snapshots;
CREATE POLICY "atlas_snapshots_insert" ON public.atlas_snapshots
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_snapshots.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "atlas_snapshots_update" ON public.atlas_snapshots;
CREATE POLICY "atlas_snapshots_update" ON public.atlas_snapshots
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_snapshots.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_snapshots.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- 3.3 atlas_dispatches — scoped via parent conversation
DROP POLICY IF EXISTS "atlas_dispatches_select" ON public.atlas_dispatches;
CREATE POLICY "atlas_dispatches_select" ON public.atlas_dispatches
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_dispatches.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "atlas_dispatches_insert" ON public.atlas_dispatches;
CREATE POLICY "atlas_dispatches_insert" ON public.atlas_dispatches
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_dispatches.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "atlas_dispatches_update" ON public.atlas_dispatches;
CREATE POLICY "atlas_dispatches_update" ON public.atlas_dispatches
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_dispatches.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.atlas_conversations c
      WHERE c.id = atlas_dispatches.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- 3.4 atlas_decisions — readable by authenticated; writes service-role only by default
DROP POLICY IF EXISTS "atlas_decisions_select" ON public.atlas_decisions;
CREATE POLICY "atlas_decisions_select" ON public.atlas_decisions
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "atlas_decisions_insert" ON public.atlas_decisions;
CREATE POLICY "atlas_decisions_insert" ON public.atlas_decisions
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "atlas_decisions_update" ON public.atlas_decisions;
CREATE POLICY "atlas_decisions_update" ON public.atlas_decisions
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
  )
  WITH CHECK (
    auth.role() = 'service_role'
  );

-- 3.5 atlas_cost_log — readable by authenticated; writes service-role only by default
DROP POLICY IF EXISTS "atlas_cost_log_select" ON public.atlas_cost_log;
CREATE POLICY "atlas_cost_log_select" ON public.atlas_cost_log
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "atlas_cost_log_insert" ON public.atlas_cost_log;
CREATE POLICY "atlas_cost_log_insert" ON public.atlas_cost_log
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "atlas_cost_log_update" ON public.atlas_cost_log;
CREATE POLICY "atlas_cost_log_update" ON public.atlas_cost_log
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
  )
  WITH CHECK (
    auth.role() = 'service_role'
  );

-- ---------------------------------------------------------------------------
-- 4. HELPER VIEWS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.atlas_cost_today AS
  SELECT
    provider,
    service,
    SUM(usd_cost)   AS usd_cost,
    SUM(tokens_in)  AS tokens_in,
    SUM(tokens_out) AS tokens_out
  FROM public.atlas_cost_log
  WHERE created_at >= date_trunc('day', now())
  GROUP BY provider, service;

CREATE OR REPLACE VIEW public.atlas_cost_month_to_date AS
  SELECT
    provider,
    service,
    SUM(usd_cost)   AS usd_cost,
    SUM(tokens_in)  AS tokens_in,
    SUM(tokens_out) AS tokens_out
  FROM public.atlas_cost_log
  WHERE created_at >= date_trunc('month', now())
  GROUP BY provider, service;
