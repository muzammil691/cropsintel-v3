-- Atlas: runtime config table (Phase 1.10j)
-- Stores key/value pairs for runtime-flippable settings (e.g. trust_mode kill switch).

CREATE TABLE IF NOT EXISTS public.atlas_config (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  set_by     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read config" ON public.atlas_config
  FOR SELECT USING (true);

-- INSERT/UPDATE is service_role only — service_role bypasses RLS
