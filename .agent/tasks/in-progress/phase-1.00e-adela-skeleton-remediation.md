# Task: Phase 1.00e-rem — Adela Skeleton Full Completion

## Goal
Complete the Adela skeleton that shipped only partially in phase-1.00e. The abc.ts scraper is truncated at step 3. Dockerfile, package.json, scheduler, wrapper libs, migration SQL, and README are all absent. This remediation delivers the complete Adela service scaffold.

## Files to create / extend
- `adela/src/scrapers/abc.ts` — complete steps 4–7:
  - Step 4: upload raw JSON to Supabase Storage bucket `adela-raw`
  - Step 5: Gemini extraction — structured crop/price fields from raw JSON
  - Step 6: insert extracted rows into `adela_scrape_results` table
  - Step 7: notify Atlas via `POST /atlas/adela/notify` with `{ scraper, rows_inserted, storage_path }`
  - Audit log entry on success AND failure
  - catch block: log error to audit log, NEVER re-throw upward
- `adela/Dockerfile` — node:20-slim base, non-root user, WORKDIR /app, COPY + npm ci + CMD
- `adela/package.json` — name: adela, version: 1.0.0, deps: @supabase/supabase-js, @google/generative-ai, node-cron, axios. devDeps: typescript, ts-node, @types/node
- `adela/src/scheduler.ts` — node-cron job, runs abc scraper on schedule `0 6 * * *` (6am UTC daily). Logs start/end. Catches and logs errors without crashing process.
- `adela/src/lib/supabase.ts` — createClient wrapper using env SUPABASE_URL + SUPABASE_SERVICE_KEY
- `adela/src/lib/gemini.ts` — GoogleGenerativeAI wrapper using env GEMINI_API_KEY. Exported fn: `extractStructured(raw: string, schema: object): Promise<object>`
- `adela/src/lib/notify.ts` — axios POST to ATLAS_URL/atlas/adela/notify. Exported fn: `notifyAtlas(payload: NotifyPayload): Promise<void>`
- `adela/supabase/migrations/<timestamp>_adela.sql` — create table `adela_scrape_results` (id uuid pk, scraper text, scraped_at timestamptz, rows jsonb, storage_path text, created_at timestamptz default now()). RLS: service role only.
- `adela/README.md` — env table must include: SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, ATLAS_URL, TWILIO_ACCOUNT_SID (optional). Startup message must match index.ts exactly.
- `adela/src/index.ts` — fix startup notification message to match README exactly

## Success criteria
- `abc.ts` completes all 7 steps without throwing
- catch block logs to audit log and returns gracefully — never re-throws
- Dockerfile builds without error (`docker build .`)
- `scheduler.ts` registers cron job without crashing on import
- `adela_scrape_results` table exists in migration SQL with RLS
- README env table contains all 6 env vars including ANTHROPIC_API_KEY
- Startup message in index.ts matches README exactly
- No "coming soon" / TODO / placeholder text
- TypeScript strict — zero `any` types
- Verifier stub-detector passes

## Risks + mitigations
- Risk: Gemini extraction schema mismatch → mitigation: validate extracted object keys before insert, log mismatch and skip row
- Risk: Supabase Storage bucket absent → mitigation: create bucket programmatically if not exists before upload
- Risk: Atlas notify endpoint not yet live → mitigation: wrap in try/catch, log failure, do not block scraper completion

## NEVER list
- NEVER re-throw errors in runAbcScraper catch block
- NEVER hardcode API keys or credentials anywhere
- NEVER modify files outside adela/ directory
- NEVER use `any` TypeScript type
- NEVER drop or alter existing tables in other services
- NEVER make startup message in index.ts differ from README
