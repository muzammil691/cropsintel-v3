-- =============================================================================
-- Adela scraper output tables — phase 1.6a
-- Depends on: 20260428000001_v3_foundation.sql (commodities, has_role)
--             20260429100000_adela_foundation.sql (adela_runs, position_reports)
--
-- Adds the four tables Adela writes to from its scrapers:
--   prices         — price points scraped from ABC / Strata / etc.
--   positions      — Strata position snapshots (long/short/open/committed)
--   news_items     — items pulled from agricultural-news RSS feeds
--   scraper_errors — dead-letter log for scraper failures (after retries)
--
-- All tables enforce multi-commodity from Day 1 (commodity_id FK) and ship
-- with RLS enabled. Information walls:
--   * prices, news_items   — public read (authenticated), team write
--   * positions            — team-only (Strata is paid commercial intelligence)
--   * scraper_errors       — team-only
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prices — discrete price observations (origin x destination x basis x grade)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL,
  source_url text,
  occurred_at timestamptz NOT NULL,
  origin_country text,
  destination_country text,
  trade_basis text,
  variety text,
  product_type text,
  size_grade text,
  price_per_lb_usd numeric(10,4),
  currency text NOT NULL DEFAULT 'USD',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by text NOT NULL DEFAULT 'adela'
);

CREATE INDEX IF NOT EXISTS idx_prices_commodity_occurred
  ON public.prices (commodity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_prices_source ON public.prices (source);

ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated can read prices"
  ON public.prices FOR SELECT TO authenticated USING (true);

CREATE POLICY "team can insert prices"
  ON public.prices FOR INSERT TO authenticated
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update prices"
  ON public.prices FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access prices"
  ON public.prices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- positions — Strata long/short/open/committed snapshots
-- Team-only: Strata is paid commercial intel and falls behind the team wall.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL DEFAULT 'Strata',
  source_url text,
  occurred_at timestamptz NOT NULL,
  position_type text,
  variety text,
  size_grade text,
  quantity_lbs numeric(14,2),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by text NOT NULL DEFAULT 'adela'
);

CREATE INDEX IF NOT EXISTS idx_positions_commodity_occurred
  ON public.positions (commodity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_source ON public.positions (source);

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read positions"
  ON public.positions FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can insert positions"
  ON public.positions FOR INSERT TO authenticated
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update positions"
  ON public.positions FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access positions"
  ON public.positions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- news_items — items pulled from agricultural-news RSS feeds
-- Unique on (source, source_url) so re-runs are idempotent.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.news_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL,
  source_url text NOT NULL,
  occurred_at timestamptz NOT NULL,
  title text NOT NULL,
  summary text,
  body text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by text NOT NULL DEFAULT 'adela',
  UNIQUE (source, source_url)
);

CREATE INDEX IF NOT EXISTS idx_news_commodity_occurred
  ON public.news_items (commodity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_source ON public.news_items (source);

ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated can read news_items"
  ON public.news_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "team can insert news_items"
  ON public.news_items FOR INSERT TO authenticated
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update news_items"
  ON public.news_items FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access news_items"
  ON public.news_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- scraper_errors — dead-letter log for scraper failures
-- Adela writes here after exhausting retries; surfaced on the team admin UI.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scraper_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  error_message text NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_scraper_errors_unresolved
  ON public.scraper_errors (scraper, occurred_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.scraper_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read scraper_errors"
  ON public.scraper_errors FOR SELECT TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can insert scraper_errors"
  ON public.scraper_errors FOR INSERT TO authenticated
  WITH CHECK (public.is_team_or_admin(auth.uid()));

CREATE POLICY "team can update scraper_errors"
  ON public.scraper_errors FOR UPDATE TO authenticated
  USING (public.is_team_or_admin(auth.uid()));

CREATE POLICY "service_role full access scraper_errors"
  ON public.scraper_errors FOR ALL TO service_role USING (true) WITH CHECK (true);
