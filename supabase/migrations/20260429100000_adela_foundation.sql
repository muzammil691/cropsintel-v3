-- =============================================================================
-- Adela foundation: position_reports + adela_runs
-- Depends on: 20260428000001_v3_foundation.sql (commodities, has_role)
-- =============================================================================

-- Position reports (one row per ABC monthly report)
CREATE TABLE IF NOT EXISTS public.position_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL DEFAULT 'ABC',
  report_date date NOT NULL,
  report_url text NOT NULL,
  raw_pdf_storage_path text,
  extracted jsonb NOT NULL,
  total_shipments_lbs numeric,
  total_inventory_lbs numeric,
  domestic_shipments_lbs numeric,
  export_shipments_lbs numeric,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by text NOT NULL DEFAULT 'adela',
  UNIQUE(source, report_date, commodity_id)
);

ALTER TABLE public.position_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read position reports"
  ON public.position_reports FOR SELECT
  USING (true);

CREATE POLICY "Team can insert position reports"
  ON public.position_reports FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'team'));

CREATE INDEX IF NOT EXISTS idx_position_reports_date
  ON public.position_reports (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_position_reports_commodity
  ON public.position_reports (commodity_id, report_date DESC);

-- Audit log of every Adela scraper run
CREATE TABLE IF NOT EXISTS public.adela_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  rows_inserted int DEFAULT 0,
  rows_skipped int DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.adela_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read adela runs"
  ON public.adela_runs FOR SELECT
  USING (public.has_role(auth.uid(), 'team'));

CREATE POLICY "Team can insert adela runs"
  ON public.adela_runs FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'team'));

CREATE POLICY "Team can update adela runs"
  ON public.adela_runs FOR UPDATE
  USING (public.has_role(auth.uid(), 'team'));
