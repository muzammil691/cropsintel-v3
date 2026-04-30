# Task: Phase 1.6b — Adela USDA NASS / FAS scraper

**Master plan reference:** §11.2 row 1.6 (Adela 6 scrapers); §7.4 Market Price Intelligence (USDA reports as input).
**Context:** ABC scraper (1.00e) covers monthly Position Reports. USDA NASS Quick Stats API + USDA FAS Global Agricultural Trade System (GATS) cover crop forecasts, acreage, yield, and global trade flow data — fundamental priced-in inputs for almond market intelligence. Both have free, key-gated public APIs (no scraping; clean JSON responses).
**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7 (data extraction + schema mapping benefits from reasoning)

model: claude-opus-4-7

---

## Goal

Add a new scraper at `adela/src/scrapers/usda.ts` that:

1. Fetches USDA NASS Quick Stats API for almond crop year data (acreage, production, yield, value)
2. Fetches USDA FAS GATS export data (almond exports by destination, by month)
3. Writes acreage / production / yield rows into a new `usda_crop_stats` table
4. Writes export-by-destination rows into `usda_exports`
5. Idempotent — re-running doesn't duplicate rows (use unique constraints + upsert)
6. Registered in `adela/src/scheduler.ts` to run weekly (`0 7 * * 1` — Mondays 07:00 UTC)
7. Logs every run to `adela_runs`

## API references

- **NASS Quick Stats:** `https://quickstats.nass.usda.gov/api/api_GET/?key=<KEY>&commodity_desc=ALMONDS&statisticcat_desc=PRODUCTION&format=JSON`
- **FAS GATS:** `https://apps.fas.usda.gov/OpenData/api/esr/exports/commodityCode/0802120000/allCountries/...`
- API keys required: `USDA_NASS_API_KEY`, `USDA_FAS_API_KEY` (free signup; add to Railway env)

## Architecture

```
adela/
├── src/
│   ├── scrapers/
│   │   ├── abc.ts (existing)
│   │   └── usda.ts (NEW)
│   └── scheduler.ts (extend with USDA job)
└── ...
```

`adela/src/scrapers/usda.ts` exports `runUsdaScraper(): Promise<void>`. Pattern: same as ABC — `startRun` → fetch → validate (Zod) → upsert → `finishRun`.

## Schema additions

Add to migration `20260501000002_adela_usda.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.usda_crop_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL DEFAULT 'NASS',
  crop_year text NOT NULL,                    -- '2025' (calendar year of harvest)
  state_alpha text NOT NULL DEFAULT 'CA',
  statistic text NOT NULL,                    -- 'BEARING_ACRES' | 'PRODUCTION_LB' | 'YIELD_LB_PER_ACRE' | 'PRICE_RECEIVED_USD_LB'
  value numeric,
  unit text,
  raw jsonb DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, commodity_id, crop_year, state_alpha, statistic)
);

CREATE TABLE IF NOT EXISTS public.usda_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL DEFAULT 'FAS_GATS',
  marketing_year text NOT NULL,                -- '2025/26'
  month_year date NOT NULL,                    -- first of month
  destination_country text NOT NULL,
  weight_kg numeric,
  value_usd numeric,
  raw jsonb DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, commodity_id, marketing_year, month_year, destination_country)
);
```

Both tables: RLS enabled, public read, team write (mirror `position_reports`). Indexes: `(commodity_id, crop_year DESC)` and `(commodity_id, month_year DESC, destination_country)`.

## Files

- `adela/src/scrapers/usda.ts` (NEW) — main scraper
- `adela/src/config.ts` (extend) — add `usda` block: NASS endpoint, FAS endpoint, schedule
- `adela/src/scheduler.ts` (extend) — register `runUsdaScraper`
- `supabase/migrations/20260501000002_adela_usda.sql` (NEW) — 2 tables + RLS + indexes
- `adela/package.json` — verify `zod` is present (already used by abc.ts)

## Success criteria

- `npm run build && npm start` in `adela/` boots without throwing
- Scheduler logs include `[scheduler] Registered job: usda-crop-stats @ 0 7 * * 1`
- Manual `node dist/scrapers/usda.js` (or equivalent CLI) writes ≥10 rows into `usda_crop_stats`
- Re-running the scraper inserts 0 new rows (UPSERT idempotency)
- `adela_runs` shows a row with `scraper='usda'`, `status='success'`

## Risks + mitigations

- **Risk:** API rate limits / 429s. **Mitigation:** reuse `fetchWithRetry` from `abc.ts`; cap weekly schedule.
- **Risk:** API keys missing in Railway. **Mitigation:** scraper logs WARN and `finishRun(status='skipped')` instead of crashing if `USDA_NASS_API_KEY` is unset; don't fail the whole Adela process.
- **Risk:** Schema drift between NASS payload and our table. **Mitigation:** Zod validation; on validation failure log full payload to `adela_runs.metadata`; insert only the fields that validate.

## NEVER list

- No scraping HTML — use the documented JSON APIs only.
- No client-side calls — all fetching from Adela server, never from `src/`.
