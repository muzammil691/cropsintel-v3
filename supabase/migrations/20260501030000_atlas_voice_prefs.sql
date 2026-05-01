-- Phase 1.10v: Atlas WhatsApp voice notes — per-user voice-reply preferences.
--
-- Default voice_replies_enabled = true for the primary user (Muzammil) so the
-- feature works out of the box; users opt out with "disable voice" → upserts
-- a row with enabled=false. The atlas service uses the service-role key, so
-- service-role writes bypass RLS; admin reads (read-only) are allowed via
-- the policy below.

CREATE TABLE IF NOT EXISTS public.atlas_user_prefs (
  user_phone            text        PRIMARY KEY,
  voice_replies_enabled boolean     NOT NULL DEFAULT true,
  preferred_voice_id    text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_user_prefs ENABLE ROW LEVEL SECURITY;

-- Read-only access for any authenticated client (admins use this to inspect
-- prefs from the dashboard). Writes happen exclusively via the atlas service
-- using the service-role key.
DROP POLICY IF EXISTS "Anyone can read atlas user prefs" ON public.atlas_user_prefs;
CREATE POLICY "Anyone can read atlas user prefs" ON public.atlas_user_prefs
  FOR SELECT USING (true);

-- Seed Muzammil's preference so the first WhatsApp voice turn just works.
INSERT INTO public.atlas_user_prefs (user_phone, voice_replies_enabled)
VALUES ('+971562556592', true)
ON CONFLICT (user_phone) DO NOTHING;
