# Task: Phase 1.6 — Adela skeleton + ABC position-report scraper

**Master plan reference:** v1.5 section 11.2 row 1.6 (expanded per user instruction 2026-04-29)
**Depends on:** Phase 1.4 RBAC migrations (for the `team` role check on writes)
**Estimated effort:** ~12-18 hours of agent work; iterate. Multiple Claude Code invocations expected.
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Build **Adela** — V3's runtime nervous system. A separate Railway service (sibling to `cropsintel-agent`) that runs cron schedules to scrape authoritative almond market sources, parses them with Gemini Pro, and writes structured data into V3 Supabase. This is the heart of CropsIntel's intelligence layer.

This task ships:
1. The Adela skeleton (Dockerfile, package.json, cron scheduler, audit log)
2. The first end-to-end scraper: **ABC position reports** (real working code, not a placeholder)
3. The supporting V3 schema (`position_reports`, `adela_runs` tables) with RLS
4. Deployment instructions for the user (so they can deploy Adela as a 2nd Railway service)

Other scrapers (USDA NASS, USDA AMS, industry RSS) ship as separate phases (1.6.2, 1.6.3, etc.) — keep those out of THIS task to bound scope.

## In scope

### Repo structure
Create `adela/` directory at repo root (sibling to `agent/` and `src/`):

```
adela/
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md             ← deployment + ops instructions for user
├── src/
│   ├── index.ts          ← entrypoint: starts cron scheduler, runs forever
│   ├── scheduler.ts      ← node-cron wrapper, registers jobs from config
│   ├── config.ts         ← cron schedules, source URLs, retry policy
│   ├── supabase.ts       ← V3 Supabase service-role client (writes bypass RLS)
│   ├── gemini.ts         ← Gemini Pro client wrapper for extraction
│   ├── notify.ts         ← WhatsApp via existing notify-whatsapp.sh contract OR direct Twilio
│   ├── audit.ts          ← writes adela_runs rows
│   └── scrapers/
│       └── abc.ts        ← FIRST WORKING SCRAPER
└── .gitignore            ← ignore /node_modules
```

### Schema (write `supabase/migrations/20260429xxxxxx_adela_foundation.sql`)
```sql
-- Position reports (one row per ABC monthly report)
CREATE TABLE IF NOT EXISTS public.position_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES public.commodities(id),
  source text NOT NULL DEFAULT 'ABC',           -- 'ABC' | 'USDA_NASS' | 'USDA_AMS'
  report_date date NOT NULL,                    -- the date the report covers
  report_url text NOT NULL,                     -- canonical source URL
  raw_pdf_storage_path text,                    -- Supabase Storage key for the original
  extracted jsonb NOT NULL,                     -- structured extracted data
  total_shipments_lbs numeric,                  -- common metrics promoted to columns
  total_inventory_lbs numeric,
  domestic_shipments_lbs numeric,
  export_shipments_lbs numeric,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by text NOT NULL DEFAULT 'adela',
  UNIQUE(source, report_date, commodity_id)     -- idempotency
);

ALTER TABLE public.position_reports ENABLE ROW LEVEL SECURITY;

-- Public read (this is market intelligence, not customer data)
CREATE POLICY "Anyone can read position reports"
  ON public.position_reports FOR SELECT
  USING (true);

-- Only service_role (Adela) and team can write
CREATE POLICY "Team can insert position reports"
  ON public.position_reports FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'team'));

CREATE INDEX idx_position_reports_date ON public.position_reports (report_date DESC);
CREATE INDEX idx_position_reports_commodity ON public.position_reports (commodity_id, report_date DESC);

-- Audit log of every Adela scraper run
CREATE TABLE IF NOT EXISTS public.adela_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text NOT NULL,                        -- 'abc' | 'usda_nass' | etc.
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',       -- 'running' | 'success' | 'failed' | 'skipped'
  rows_inserted int DEFAULT 0,
  rows_skipped int DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.adela_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read adela runs" ON public.adela_runs FOR SELECT USING (public.has_role(auth.uid(), 'team'));
```

### ABC scraper (`adela/src/scrapers/abc.ts`)
Real working implementation:
1. Fetch ABC's position reports index page (research the canonical URL — likely under `almonds.com` or `almondboard.com`)
2. Parse the page for the latest report's PDF link
3. Compare against `position_reports` table to detect new reports
4. If new: download PDF, store raw bytes in Supabase Storage bucket `adela-raw/abc/`
5. Send PDF to Gemini Pro with a strict extraction prompt (JSON output: `{ report_date, total_shipments_lbs, total_inventory_lbs, domestic_shipments_lbs, export_shipments_lbs, by_variety: [...] }`)
6. Validate extracted JSON against a Zod schema
7. INSERT into `position_reports` (idempotent via UNIQUE constraint)
8. Notify WhatsApp: "📊 New ABC position report for [date]. Shipments: X lbs, Inventory: Y lbs."
9. Write `adela_runs` row with status

If extraction fails or PDF format unexpected: write `adela_runs` with status='failed', error_message, attach last 200 chars of Gemini response. Do NOT crash the cron loop.

### Cron scheduler (`adela/src/index.ts` + `scheduler.ts`)
- Use `node-cron` package
- ABC: `0 6 * * *` (daily at 06:00 UTC) — enough buffer for ABC's typical morning publish
- Each cron callback: try-catch the scraper, write audit row, never throw upward

### Dockerfile
- Base: `node:22-bookworm-slim`
- Install: git, curl, ca-certificates
- WORKDIR `/app`
- COPY package.json + package-lock.json, RUN npm ci --omit=dev
- COPY src/, tsconfig.json
- RUN npx tsc (compile to dist/)
- CMD `node dist/index.js`
- Uses env vars: `V3_SUPABASE_URL`, `V3_SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, `TWILIO_*` (for WhatsApp), `ANTHROPIC_API_KEY` (fallback for extraction if Gemini fails)

### README (`adela/README.md`)
Deployment guide for Muzammil:
1. Create new Railway service in same project (`generous-possibility`)
2. Source: GitHub repo `muzammil691/cropsintel-v3`
3. Root Directory: `adela`
4. Builder: Dockerfile
5. Restart Policy: Always
6. Environment variables: list each one with where to find the value
7. Watch Paths: `adela/**`
8. Confirmation: first WhatsApp arrives within ~5 min showing "Adela online"

### Lib/types updates (`src/lib/types.ts`)
Re-export the new tables' types after `npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb --schema public > src/lib/database.types.ts`.

## Out of scope

- USDA NASS scraper (separate phase, uses different parser logic)
- USDA AMS scraper (separate phase)
- Industry RSS scrapers (separate phase, simpler)
- Twitter/X scraper (Phase 2 maybe)
- Backfill of historical ABC reports — first run only fetches the latest. Backfill is a separate task spec.
- Multi-Brain validation of extracted data (Phase 2 enhancement)

## Acceptance criteria

1. `adela/` directory exists with the file structure above
2. `npm run build` (V3 root) still passes (no broken imports if you touched `src/lib/types.ts`)
3. `cd adela && npx tsc` compiles cleanly
4. The migration adds `position_reports` and `adela_runs` tables, RLS, and indexes
5. ABC scraper code is REAL — not a placeholder. It fetches a real ABC URL, parses HTML, downloads a PDF, calls Gemini with a real extraction prompt, writes to V3 Supabase. (If the live ABC URL has changed, write a question file describing what URL pattern you tried and what response you got.)
6. `adela/README.md` is detailed enough for the user to follow without asking me follow-up questions
7. Conventional commits: ~5 commits (schema, skeleton, scraper, README, types regen)
8. WhatsApp notification structure matches the existing agent's pattern

## Foundation check (BEFORE starting)

- Verify `commodities` table exists with at least an `almonds` row (it does — seeded in Phase 1.2)
- Verify `has_role()` SQL function exists (it should — Phase 1.4 RBAC adds it; if it doesn't, write a question file BEFORE proceeding)
- Verify env vars in Railway will include `V3_SUPABASE_SECRET_KEY` (Supabase's NEW key format — value starts with `sb_secret_`. This replaces the legacy `service_role` JWT. When initializing the Supabase client, pass this to the `supabase-js` library's createClient with `{ global: { headers: { apikey: SECRET_KEY, Authorization: 'Bearer ' + SECRET_KEY } } }` — the JS library was built around the JWT format so older docs may show different setup; always use the apikey header pattern with sb_secret values.)

## Notes for the agent

- Gemini extraction prompt should be VERY strict about JSON shape. Use Gemini's `response_mime_type: "application/json"` + a JSON schema if the SDK supports it. Validate with Zod.
- ABC's website may rate-limit; respect a `User-Agent` header that identifies CropsIntel. Use exponential backoff.
- This task may legitimately take 5+ retries since you'll be discovering the live ABC site structure. That's fine. Persist; commit small wins.
- DO NOT hardcode the ABC report URL — extract it from the index page so future-month reports are picked up automatically.
- DO NOT migrate any V1 data. User explicitly rejected V1 migration 2026-04-29.

---

**Done condition:** Adela's `adela/` codebase exists, compiles, has a real ABC scraper, V3 Supabase has the new tables. User can deploy as a 2nd Railway service following README.md. First run fetches latest ABC report, parses, writes to DB, sends WhatsApp.
