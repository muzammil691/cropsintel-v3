-- =============================================================================
-- CropsIntel V3 — Atlas chat summaries (Phase 1.10ar)
-- =============================================================================
-- Rolling per-thread summaries of Atlas chat for the clickable timeline UI
-- and for backward "what did we discuss earlier?" recall via memory_chunks.
--
-- Each row covers an inclusive [range_start_msg_id, range_end_msg_id] window
-- of atlas_conversations. The producer fires when ≥10 min have elapsed since
-- the last summary OR ≥30 messages have accumulated in the window.
--
-- The paired memory_chunks row holds the embedded summary_long so existing
-- vector search retrieves it without a new index.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.atlas_chat_summaries (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id          text          NOT NULL,
  range_start_msg_id uuid          NOT NULL,
  range_end_msg_id   uuid          NOT NULL,
  range_start_at     timestamptz   NOT NULL,
  range_end_at       timestamptz   NOT NULL,
  message_count      int           NOT NULL,
  summary_short      text          NOT NULL,
  summary_long       text          NOT NULL,
  topics             text[]        NOT NULL DEFAULT '{}'::text[],
  cost_usd           numeric(10,4) NOT NULL DEFAULT 0,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  memory_chunk_id    uuid
);

CREATE INDEX IF NOT EXISTS idx_atlas_chat_summaries_thread_time
  ON public.atlas_chat_summaries (thread_id, range_end_at DESC);

ALTER TABLE public.atlas_chat_summaries ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so the FOR ALL service-role policy is mostly
-- belt-and-braces. SELECT must remain open to authenticated readers because
-- the cockpit timeline fetches via the Atlas server but the row-level shape
-- mirrors atlas_conversations (anyone-can-read, service-role-writes).
CREATE POLICY "atlas_chat_summaries_read_all"
  ON public.atlas_chat_summaries
  FOR SELECT USING (true);

CREATE POLICY "atlas_chat_summaries_service_write"
  ON public.atlas_chat_summaries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Add `kind` to memory_chunks so chat-summary rows can be filtered out of
-- general knowledge-base searches and queried in isolation by the recall
-- heuristic in the chat handler.
ALTER TABLE public.memory_chunks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_memory_chunks_kind
  ON public.memory_chunks (kind);
