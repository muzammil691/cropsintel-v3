-- Phase 1.10am: Atlas v2 rich chat — uploads + audio recording.
--
-- Two changes:
--  1. New Storage bucket `atlas-chat-attachments` for user-uploaded files
--     (images, video, PDF, text/markdown, JSON, zip) and persisted audio
--     (user mic recordings + Atlas TTS replies). Service-role-only access;
--     all reads go through per-object signed URLs minted by the atlas server.
--  2. New table `atlas_voice_sessions` to log live-mode WebSocket sessions
--     with start/end timestamps + speech-second accounting on each side.
--
-- Idempotent — safe to re-run.

-- ─── Storage bucket ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'atlas-chat-attachments',
  'atlas-chat-attachments',
  false,
  26214400,                                 -- 25 MB per-object cap
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/webm',
    'application/pdf',
    'text/plain', 'text/markdown', 'text/csv', 'text/html',
    'application/json',
    'application/zip',
    'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/ogg'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public            = EXCLUDED.public,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No anon/authenticated policies — service-role only. Per-request signed URLs
-- are the only client read path until 1.10aj+1 introduces per-phone scoping.

-- ─── atlas_voice_sessions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atlas_voice_sessions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id                   text NOT NULL,
  phone                       text NOT NULL,
  session_id                  text,
  started_at                  timestamptz NOT NULL DEFAULT now(),
  ended_at                    timestamptz,
  user_speech_seconds         numeric(10, 2) NOT NULL DEFAULT 0,
  atlas_speech_seconds        numeric(10, 2) NOT NULL DEFAULT 0,
  turn_count                  integer NOT NULL DEFAULT 0,
  end_reason                  text,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_voice_sessions_thread_idx
  ON public.atlas_voice_sessions (thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS atlas_voice_sessions_phone_idx
  ON public.atlas_voice_sessions (phone, started_at DESC);

ALTER TABLE public.atlas_voice_sessions ENABLE ROW LEVEL SECURITY;

-- Read: authenticated members can see their own sessions; owners/admins see all.
DROP POLICY IF EXISTS atlas_voice_sessions_select_self ON public.atlas_voice_sessions;
CREATE POLICY atlas_voice_sessions_select_self
  ON public.atlas_voice_sessions
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: service role only (atlas server). No INSERT/UPDATE policy → blocked
-- for anon/authenticated under default-deny RLS.
