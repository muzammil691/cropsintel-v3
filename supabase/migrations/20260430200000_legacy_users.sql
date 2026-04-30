-- Phase 1.3f — Legacy users snapshot table
-- Stores a one-time export of V1 (almond-oracle) and V2 (CropsIntelV2) user records.
-- The check-legacy-user edge function reads from this table to detect returning users
-- and copy their profile fields into V3 on first sign-in.
--
-- Population is manual (see .agent/questions/phase-1.3f-q.md for instructions).
-- This table is read-only to clients; all writes go via service_role through the edge function.

CREATE TABLE public.legacy_users (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text        NOT NULL CHECK (source IN ('v1', 'v2')),
  legacy_user_id        text        NOT NULL,
  email                 text,
  phone                 text,
  display_name          text,
  tier                  text        NOT NULL DEFAULT 'registered',
  -- company_id is stored as the V1/V2 text ID; it does NOT reference V3 companies.
  -- Phase 2 will add a company matching step when the CRM is populated.
  company_id            text,
  preferred_language    text        NOT NULL DEFAULT 'en',
  legacy_created_at     timestamptz,
  migrated_to_v3_user_id uuid       REFERENCES auth.users(id) ON DELETE SET NULL,
  migrated_at           timestamptz,
  raw_legacy_record     jsonb,
  imported_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_legacy_users_source_id ON public.legacy_users (source, legacy_user_id);
CREATE INDEX idx_legacy_users_email ON public.legacy_users (email) WHERE email IS NOT NULL;
CREATE INDEX idx_legacy_users_phone ON public.legacy_users (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_legacy_users_migrated ON public.legacy_users (migrated_to_v3_user_id)
  WHERE migrated_to_v3_user_id IS NOT NULL;

ALTER TABLE public.legacy_users ENABLE ROW LEVEL SECURITY;
-- No client-facing policies: clients always go through the check-legacy-user edge function.
-- service_role (used by edge functions) bypasses RLS automatically.
