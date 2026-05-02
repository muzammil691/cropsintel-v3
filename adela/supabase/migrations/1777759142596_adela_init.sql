-- =============================================================================
-- Adela init migration (phase-1.00e-rem)
--
-- Provisions the three tables Adela's runtime requires:
--
--   adela_runs       — per-run lifecycle audit (running/success/failed/skipped).
--                      Mirrors the row layout written by adela/src/audit.ts.
--                      Idempotent: parent supabase/migrations create the same
--                      table; this file uses CREATE IF NOT EXISTS so applying
--                      either order produces the same shape.
--   adela_events     — emitted events surfaced by the WhatsApp + DB notifier
--                      wrapper (adela/src/lib/notify.ts). One row per notify()
--                      call. Lets the team admin UI replay every event.
--   adela_documents  — metadata for raw artifacts uploaded to the adela-raw
--                      Storage bucket (PDFs, HTML snapshots). The blob lives
--                      in Storage; this row is the searchable index.
--
-- All three tables ship with RLS enabled and a service_role-only policy. End
-- users never read these directly; the team admin UI queries via the service
-- role from a server-side edge function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- adela_runs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adela_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  rows_inserted int NOT NULL DEFAULT 0,
  rows_skipped int NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_adela_runs_scraper_started
  ON public.adela_runs (scraper, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_adela_runs_status_started
  ON public.adela_runs (status, started_at DESC);

ALTER TABLE public.adela_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adela_runs_service_role_only ON public.adela_runs;
CREATE POLICY adela_runs_service_role_only
  ON public.adela_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.adela_runs IS
  'Lifecycle audit of every Adela scraper run. Service role only.';

-- -----------------------------------------------------------------------------
-- adela_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adela_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text,
  event_type text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adela_events_scraper_created
  ON public.adela_events (scraper, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_adela_events_type_created
  ON public.adela_events (event_type, created_at DESC);

ALTER TABLE public.adela_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adela_events_service_role_only ON public.adela_events;
CREATE POLICY adela_events_service_role_only
  ON public.adela_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.adela_events IS
  'Notifier event stream. One row per notify() call from adela/src/lib/notify.ts. Service role only.';

-- -----------------------------------------------------------------------------
-- adela_documents
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adela_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text NOT NULL,
  source_url text,
  storage_bucket text NOT NULL DEFAULT 'adela-raw',
  storage_path text NOT NULL,
  content_type text,
  size_bytes bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_adela_documents_scraper_created
  ON public.adela_documents (scraper, created_at DESC);

ALTER TABLE public.adela_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adela_documents_service_role_only ON public.adela_documents;
CREATE POLICY adela_documents_service_role_only
  ON public.adela_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.adela_documents IS
  'Metadata index for raw artifacts uploaded to the adela-raw Storage bucket. Service role only.';
