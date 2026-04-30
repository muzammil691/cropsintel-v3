# Task: Phase 1.6a — Adela schema extensions

**Master plan reference:** §11.2 row 1.6 (Adela runtime + scrapers); §4.1 entity order rows 12 (`market_intelligence`); §4.2 multi-commodity rule (every domain table gets `commodity_id`).
**Context:** 1.00e shipped Adela's foundation tables (`position_reports`, `adela_runs`) plus the ABC scraper. Phase 1.6 adds 5 more scrapers (USDA NASS/FAS, Strata price, news RSS, freight rates, weekly bulletins). Each needs a destination table. This spec creates those tables + a `scraper_sources` config table so future scrapers can be added by SQL row, not code.
**Estimated effort:** ~25 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Add a single new migration file `supabase/migrations/20260501000001_adela_extensions.sql` that creates:

1. `price_observations` — daily/weekly price points scraped from Strata, Mintec, USDA AMS
2. `news_items` — RSS-aggregated almond/agriculture news with dedup hash
3. `scraper_sources` — config registry (a row per scraper; type, schedule, last_run, enabled flag)
4. `freight_observations` — ocean container rates for major lanes (CA → Karachi, Hamburg, Shanghai, Jebel Ali) — placeholder schema even if Phase 1.6 doesn't yet ingest
5. `market_signals` — derived signals from raw observations (Adela writes these; Zyra reads them in Phase 2)

All five tables MUST:
- Have `commodity_id uuid NOT NULL REFERENCES commodities(id)` (master plan §4.2)
- `ENABLE ROW LEVEL SECURITY`
- Read policy: `USING (true)` (public market data is read-public)
- Write policy: `WITH CHECK (public.has_role(auth.uid(), 'team'))` matching `position_reports` pattern
- Reasonable indexes: `(commodity_id, observation_date DESC)`, `(source, observation_date)`

## Schema (final)

```sql
-- 1. price_observations
CREATE TABLE IF NOT EXISTS public.price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL,                      -- 'strata' | 'usda_ams' | 'mintec' | 'broker'
  observation_date date NOT NULL,
  variety text,                               -- 'Nonpareil', 'Carmel', 'Independence', etc.
  size_grade text,                            -- '23/25', '25/27', etc.
  product_form text,                          -- 'inshell' | 'shelled' | 'blanched' | 'sliced'
  trade_basis text,                           -- 'FAS' | 'CIF' | 'FOB' | 'CFR' | 'DAP'
  origin text,                                -- 'California' | 'Australia'
  price_usd_per_lb numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  source_url text,
  notes text,
  raw jsonb DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by text NOT NULL DEFAULT 'adela'
);

-- 2. news_items
CREATE TABLE IF NOT EXISTS public.news_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid REFERENCES public.commodities(id),  -- nullable for general agri news
  source text NOT NULL,                      -- feed name
  source_url text NOT NULL,
  headline text NOT NULL,
  summary text,
  published_at timestamptz,
  hash text NOT NULL UNIQUE,                  -- sha256(source_url) for dedup
  tags text[] DEFAULT '{}',
  raw jsonb DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

-- 3. scraper_sources (config table — Atlas can read this to know what's scheduled)
CREATE TABLE IF NOT EXISTS public.scraper_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper_key text NOT NULL UNIQUE,           -- 'abc', 'usda_nass', 'strata', 'news_rss', 'freight'
  display_name text NOT NULL,
  cron_schedule text NOT NULL,                -- e.g. '0 6 * * *'
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_status text,                            -- 'success' | 'failure' | 'skipped'
  notes text,
  config jsonb DEFAULT '{}'::jsonb            -- per-scraper config overrides
);

-- 4. freight_observations
CREATE TABLE IF NOT EXISTS public.freight_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL,                       -- 'drewry' | 'xeneta' | 'manual'
  observation_date date NOT NULL,
  origin_port text NOT NULL,
  destination_port text NOT NULL,
  container_type text NOT NULL DEFAULT '40HC',
  rate_usd numeric NOT NULL,
  transit_days int,
  source_url text,
  raw jsonb DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

-- 5. market_signals
CREATE TABLE IF NOT EXISTS public.market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  signal_type text NOT NULL,                  -- 'price_spike' | 'shipment_anomaly' | 'inventory_drop' | 'news_volume'
  severity text NOT NULL,                     -- 'info' | 'warn' | 'critical'
  observed_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',        -- references to source rows
  acknowledged boolean NOT NULL DEFAULT false
);
```

Add RLS, read-public + team-writes policies, plus indexes:

```sql
-- RLS + indexes for each (omitted for brevity but follow position_reports pattern)
CREATE INDEX idx_price_obs_commodity_date ON price_observations (commodity_id, observation_date DESC);
CREATE INDEX idx_news_published ON news_items (published_at DESC NULLS LAST);
CREATE INDEX idx_freight_lane_date ON freight_observations (origin_port, destination_port, observation_date DESC);
CREATE INDEX idx_market_signals_observed ON market_signals (observed_at DESC) WHERE acknowledged = false;
```

Seed `scraper_sources` with 5 rows (ABC, USDA NASS, Strata, News RSS, Freight) — `enabled=true` for ABC + USDA + Strata + News, `enabled=false` for freight (placeholder until 1.7).

## Files

- `supabase/migrations/20260501000001_adela_extensions.sql` (new) — all 5 tables, RLS, indexes, seed rows
- `adela/src/types.ts` (new) — TS types for the 5 tables
- `adela/src/supabase.ts` (extend) — export typed insert helpers if not already present

## Success criteria

- `npx supabase db push` applies the migration without errors against the V3 Supabase project
- `select count(*) from scraper_sources` returns 5
- All 5 tables have RLS enabled (verify via `pg_class.relrowsecurity`)
- TypeScript build of `adela/` still passes (`cd adela && npm run build`)

## Risks + mitigations

- **Risk:** Existing migrations conflict with new column names. **Mitigation:** Use `CREATE TABLE IF NOT EXISTS` and prefix everything with the `public.` schema explicitly. Run migration locally before pushing.
- **Risk:** RLS policy syntax wrong. **Mitigation:** Copy-paste `position_reports` policy block as the source of truth.

## NEVER list (refuse if spec creep tries to add)

- Sale Contract / Purchase Contract issuance
- BC posting integration
- Multi-tenant aggregation across subscribers (information walls)
