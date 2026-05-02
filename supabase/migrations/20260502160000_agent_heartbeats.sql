-- =============================================================================
-- CropsIntel V3 — Atlas agent heartbeats (Phase 1.10ax)
-- =============================================================================
-- Push-based liveness channel. Builder POSTs its state to Atlas every ~60s
-- (idle | starting | running | shipping | verifying), and the conductor cron
-- writes heartbeats on behalf of agents that don't push themselves (Atlas,
-- Verifier, Designer, Memory, Council, Adela). The cockpit subscribes via
-- Supabase Realtime and renders the in-flight chip + pipeline + Agents tab.
--
-- One row per agent, keyed by lowercase agent name. UPSERT-only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.atlas_agent_heartbeats (
  agent      text        PRIMARY KEY,
  state      text        NOT NULL,
  task       text,
  elapsed_s  int         NOT NULL DEFAULT 0,
  msg        text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_agent_heartbeats ENABLE ROW LEVEL SECURITY;

-- Read-open: cockpit reads via Atlas server (authenticated) but the realtime
-- subscription needs the anon role to receive change notifications.
CREATE POLICY "atlas_agent_heartbeats_read_all"
  ON public.atlas_agent_heartbeats
  FOR SELECT USING (true);

CREATE POLICY "atlas_agent_heartbeats_service_write"
  ON public.atlas_agent_heartbeats
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Make this table broadcast on the Realtime channel so the cockpit chip
-- updates within ~1s of a Builder heartbeat without polling.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'atlas_agent_heartbeats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atlas_agent_heartbeats;
  END IF;
END $$;
