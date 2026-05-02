# Adela — CropsIntel V3 Runtime Nervous System

Adela is a standalone Node.js service that runs cron-scheduled scrapers to ingest authoritative almond market data into V3 Supabase. Phase 1.6 ships the ABC Position Report scraper.

## What it does

- Runs daily at **06:00 UTC**: fetches the latest Almond Board of California (ABC) position report
- Downloads the PDF, sends it to Gemini Pro for structured extraction
- Writes results to `position_reports` table in V3 Supabase
- Writes a generic per-scrape audit row to `adela_scrape_results`
- Notifies Atlas (`POST $ATLAS_URL/atlas/adela/notify`) on success
- Sends a WhatsApp notification when a new report is ingested (optional)
- Records every run (success/skip/fail) in `adela_runs` for audit

## Repository structure

```
adela/
├── Dockerfile              ← Railway builds this
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            ← entrypoint
│   ├── scheduler.ts        ← node-cron job registry
│   ├── config.ts           ← URLs, schedules, retry policy
│   ├── supabase.ts         ← V3 Supabase service-role client
│   ├── gemini.ts           ← Gemini Pro extraction wrapper
│   ├── notify.ts           ← WhatsApp via Twilio
│   ├── audit.ts            ← adela_runs write helpers
│   ├── lib/
│   │   ├── supabase.ts     ← env-flexible client + bucket bootstrap
│   │   ├── gemini.ts       ← extractStructured() wrapper
│   │   └── notify.ts       ← Atlas POST notifier
│   └── scrapers/
│       └── abc.ts          ← ABC position report scraper
└── supabase/
    └── migrations/         ← adela_scrape_results table
```

---

## Deploy to Railway (step by step)

### Step 1 — Apply the Adela migration

Before deploying, apply the new tables to V3 Supabase:

```bash
cd /path/to/cropsintel-v3
npx supabase db push
```

This creates `position_reports` and `adela_runs` tables with RLS.

### Step 2 — Create the `adela-raw` Storage bucket

1. Open https://supabase.com/dashboard/project/hzrnohsxigrqlmzegwlb/storage/buckets
2. Click **New bucket**
3. Name: `adela-raw`
4. Public: **off** (private — only service role can write)
5. Click **Save**

### Step 3 — Create a new Railway service

1. Go to https://railway.app → your `generous-possibility` project
2. Click **+ New Service** → **GitHub Repo**
3. Select `muzammil691/cropsintel-v3`
4. Change **Root Directory** to `adela`
5. Railway will detect the `Dockerfile` and use it

### Step 4 — Set environment variables in Railway

In the Railway service **Variables** tab, add each of these. The first six
are required by the phase-1.00e-rem skeleton; Twilio is optional and only
needed if you want WhatsApp notifications on successful scrapes.

| Variable | Required | Value | Where to find it |
|---|---|---|---|
| `SUPABASE_URL` | yes | `https://hzrnohsxigrqlmzegwlb.supabase.co` | Supabase project settings → API |
| `SUPABASE_SERVICE_KEY` | yes | `sb_secret_...` | Supabase project settings → API → **Secret key** (new `sb_secret_` format) |
| `GEMINI_API_KEY` | yes | `AIza...` | https://aistudio.google.com/app/apikey |
| `ANTHROPIC_API_KEY` | yes | `sk-ant-...` | https://console.anthropic.com → API Keys (used by future Claude-powered scrapers + monthly briefs) |
| `ATLAS_NOTIFY_URL` | yes | `https://atlas.cropsintel.app/atlas/adela/notify` | Full URL Adela POSTs scrape summaries to (per phase-1.00e-rem). `ATLAS_URL` is accepted as a legacy fallback (path appended automatically). |
| `SCRAPER_SCHEDULE` | optional | `0 6 * * *` | Cron expression overriding the default ABC schedule (06:00 UTC daily). Useful for staging deploys that need faster cadence. |
| `TWILIO_ACCOUNT_SID` | optional | `AC...` | https://console.twilio.com → Account Info |
| `TWILIO_AUTH_TOKEN` | optional | `...` | https://console.twilio.com → Account Info |
| `TWILIO_WHATSAPP_FROM` | optional | `whatsapp:+12345622692` | Your registered Maxons WhatsApp Business number |
| `TWILIO_WHATSAPP_TO` | optional | `whatsapp:+971562556592` | Muzammil's number |

> The legacy env names `V3_SUPABASE_URL` / `V3_SUPABASE_SECRET_KEY` are still
> accepted as fallbacks for backwards compatibility with earlier deploys.

### Step 5 — Configure Watch Paths

In Railway service **Settings → Source**:

- Watch Paths: `adela/**`

This ensures Railway only rebuilds Adela when files under `adela/` change (not when V3 frontend code changes).

### Step 6 — Set Restart Policy

In Railway service **Settings**:
- Restart Policy: **Always**
- This keeps Adela running even after a crash.

### Step 7 — Deploy

Click **Deploy** (or Railway will auto-deploy when the branch is detected). Build takes ~90 seconds.

### Step 8 — Verify it's running

1. Check Railway logs — you should see:
   ```
   [adela] Starting Adela v1.1 — CropsIntel runtime nervous system
   [adela] Time: 2026-05-02T...
   [scheduler] Registered: abc @ 0 6 * * *
   [adela] Ready. Scheduler armed; health server up.
   ```
2. Within ~5 minutes of startup, a WhatsApp message arrives:
   ```
   🤖 Adela v1.1 online. Cron jobs registered. ABC scrape at 06:00 UTC daily.
   ```

---

## First real scrape

The ABC scraper runs automatically at **06:00 UTC** daily. To trigger it manually for testing:

```bash
# SSH into Railway service shell (or use Railway's ephemeral shell)
node -e "import('./dist/scrapers/abc.js').then(m => m.runAbcScraper())"
```

After a successful scrape you'll see:
- A row in `position_reports` (check Supabase table editor)
- A row in `adela_runs` with `status = 'success'`
- A WhatsApp message like:
  ```
  📊 New ABC position report for March 2026. Shipments: 153.4M lbs, Inventory: 628.7M lbs.
  ```

---

## Monitoring and ops

### Check recent runs

```sql
SELECT scraper, started_at, status, rows_inserted, rows_skipped, error_message
FROM adela_runs
ORDER BY started_at DESC
LIMIT 20;
```

### Check ingested reports

```sql
SELECT source, report_date, total_shipments_lbs, total_inventory_lbs, ingested_at
FROM position_reports
ORDER BY report_date DESC
LIMIT 10;
```

### If a scrape fails

1. Check Railway logs for `[abc] Scraper failed:` line
2. Check `adela_runs` row with `status = 'failed'` — `error_message` column has details
3. Common causes:
   - `GEMINI_API_KEY` not set or exhausted quota → set the key or wait for quota reset
   - ABC website layout changed → the PDF link selector may need updating in `src/scrapers/abc.ts` (look for the `extractLatestPdfHref` function)
   - Supabase `adela-raw` bucket doesn't exist → create it (Step 2 above); scraper will still ingest without the raw backup

---

## Adding future scrapers (USDA NASS, USDA AMS, RSS)

1. Create `adela/src/scrapers/<name>.ts` exporting a `run<Name>Scraper(): Promise<void>` function
2. Add a cron schedule to `config.ts`
3. Register the job in `scheduler.ts`
4. The `adela_runs` audit table is shared — pass the scraper name to `startRun()`

---

## Local development

```bash
cd adela
npm install
cp .env.example .env    # fill in your values
npx ts-node src/index.ts
```

Environment variables are read from process.env. For local dev, set them in a `.env` file (not committed).
