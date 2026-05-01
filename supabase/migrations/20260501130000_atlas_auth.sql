-- Phase 1.10aj — Atlas WhatsApp-OTP auth + persistent sessions + Realtime sync.
--
-- Atlas dashboard at muzammil691.github.io/atlas was previously open to anyone
-- with the URL because VITE_ATLAS_API_TOKEN was baked into the static bundle.
-- This migration adds the server-side tables backing a phone-allowlisted OTP
-- login + opaque, server-revoked session tokens (no JWT exp).
--
-- All access is via the Atlas server using the Supabase service role; clients
-- never touch these tables directly. Only the atlas_conversations Realtime
-- publication is needed by the browser for live multi-device sync.

-- One-time codes for WhatsApp login.
CREATE TABLE IF NOT EXISTS public.atlas_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,           -- bcrypt(otp); never store the plain code
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_otp_phone_active
  ON public.atlas_otp_codes (phone, expires_at DESC) WHERE used_at IS NULL;

-- Long-lived sessions (no auto-expiry; revoked only on explicit logout).
CREATE TABLE IF NOT EXISTS public.atlas_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  token_hash text NOT NULL UNIQUE,   -- sha256(opaque session token)
  device_label text,                 -- 'web' / 'phone' / 'tablet' (best-effort UA parse)
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_token_active
  ON public.atlas_sessions (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_phone
  ON public.atlas_sessions (phone, created_at DESC);

ALTER TABLE public.atlas_otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_sessions ENABLE ROW LEVEL SECURITY;

-- Service-role only (no client RLS — all access goes through Atlas server).
DROP POLICY IF EXISTS "atlas_otp_service" ON public.atlas_otp_codes;
CREATE POLICY "atlas_otp_service" ON public.atlas_otp_codes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "atlas_sessions_service" ON public.atlas_sessions;
CREATE POLICY "atlas_sessions_service" ON public.atlas_sessions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── Realtime: atlas_conversations live multi-device sync ──────────────────
-- The browser subscribes via Supabase Realtime (anon key) so a message sent
-- from the user's phone via WhatsApp appears in the open web tab within ~2s.
-- Required: (a) table is part of supabase_realtime publication, (b) RLS
-- permits SELECT for anon-role on the rows the client subscribes to.
DO $$
BEGIN
  -- ALTER PUBLICATION ... ADD TABLE fails if the table is already in the publication;
  -- swallow that specific error so the migration is idempotent.
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atlas_conversations;
  EXCEPTION WHEN duplicate_object THEN
    -- Table already in the publication — nothing to do.
    NULL;
  END;
END $$;

-- Permissive SELECT policy so the anon-role Realtime subscription can stream
-- INSERTs to the browser. This is a single-user system (only Muzammil's phone
-- is on the allowlist for OTP), so leaking conversations to anon clients is
-- acceptable for v1. Tightened in a future task once we have proper
-- Supabase Auth-issued JWTs on the dashboard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'atlas_conversations'
       AND policyname = 'atlas_conversations_realtime_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "atlas_conversations_realtime_read" ON public.atlas_conversations
        FOR SELECT USING (true)
    $policy$;
  END IF;
END $$;
