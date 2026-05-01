-- Atlas: re-confirm RLS on atlas_config (Phase 1.10y)
-- Idempotent re-check after the 2026-05-01 trust-mode persistence bug. The base
-- migration (20260430000001) created the table + SELECT policy and assumed
-- service_role would bypass RLS for upserts. If Atlas is configured with the
-- anon key (or a future migration tightened RLS), persistence silently breaks.
-- This migration:
--   1. Re-asserts the table exists with the expected shape
--   2. Re-asserts RLS is enabled
--   3. Re-asserts the read policy
--   4. Adds explicit service_role write policies (no-op when service_role
--      bypasses RLS, but defends against ALTER ROLE … BYPASSRLS = false)
-- Never DROPs or REVOKEs anything.

CREATE TABLE IF NOT EXISTS public.atlas_config (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  set_by     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'atlas_config' AND policyname = 'Anyone can read config'
  ) THEN
    CREATE POLICY "Anyone can read config" ON public.atlas_config
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'atlas_config' AND policyname = 'service_role can insert config'
  ) THEN
    CREATE POLICY "service_role can insert config" ON public.atlas_config
      FOR INSERT TO service_role WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'atlas_config' AND policyname = 'service_role can update config'
  ) THEN
    CREATE POLICY "service_role can update config" ON public.atlas_config
      FOR UPDATE TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;
