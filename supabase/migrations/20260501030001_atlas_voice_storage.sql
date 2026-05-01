-- Phase 1.10v: Atlas WhatsApp voice notes — Supabase Storage bucket for
-- outbound voice replies.
--
-- The atlas service uploads MP3 audio (one file per Atlas turn) and hands
-- Twilio a 7-day signed URL. We deliberately keep the bucket NON-public; signed
-- URLs are issued per-request, so user voice replies are not enumerable.
--
-- Lifecycle: a nightly cron in the atlas service (cleanupOldVoiceNotes) removes
-- objects older than 7 days. This migration is idempotent — safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'atlas-voice-out',
  'atlas-voice-out',
  false,
  16777216,                               -- 16 MB hard ceiling (Twilio media cap)
  ARRAY['audio/mpeg', 'audio/mp3']
)
ON CONFLICT (id) DO UPDATE
  SET public            = EXCLUDED.public,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The atlas service uses the service-role key, which bypasses storage RLS.
-- We do NOT expose any anon/authenticated read or write policies — every
-- access path goes through service-role + a per-object signed URL.
