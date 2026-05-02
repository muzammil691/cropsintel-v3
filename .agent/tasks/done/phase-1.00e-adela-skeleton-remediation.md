# Task: Phase 1.00e — Adela Skeleton Remediation

## Goal
Complete the Adela scraper skeleton. Currently abc.ts is truncated at step 3, and 8 required files are absent. Builder must complete abc.ts and create all missing files.

## Files to create / extend
- `adela/src/scrapers/abc.ts` — complete steps 4–7: (4) upload raw HTML to Supabase storage, (5) Gemini extraction of structured crop data, (6) insert extracted rows to `adela_scrape_results` table, (7) notify Atlas via HTTP POST /atlas/adela/notify, (8) write audit log row to `adela_audit_log`. Remove re-throw in catch block — log error and return {success: false, error} instead.
- `adela/Dockerfile` — node:20-alpine base, WORKDIR /app, COPY package*.json, RUN npm ci, COPY src, CMD node dist/index.js
- `adela/package.json` — name: adela, version: 1.0.0, dependencies: @supabase/supabase-js, @google/generative-ai, node-cron, node-fetch. devDependencies: typescript, @types/node.
- `adela/src/scheduler.ts` — node-cron schedule for abc scraper. Default: 0 6 * * * (6am daily). Reads SCRAPER_SCHEDULE env var for override.
- `adela/src/lib/supabase.ts` — Supabase client init from SUPABASE_URL + SUPABASE_SERVICE_KEY env vars.
- `adela/src/lib/gemini.ts` — Gemini client init from GEMINI_API_KEY. Exports extractCropData(html: string): Promise<CropDataRow[]>.
- `adela/src/lib/notify.ts` — HTTP POST to ATLAS_NOTIFY_URL with scrape summary payload. Retries once on failure.
- `adela/supabase/migrations/<timestamp>_adela.sql` — creates `adela_scrape_results` and `adela_audit_log` tables with RLS.
- `adela/README.md` — env table must include: SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, ATLAS_NOTIFY_URL, SCRAPER_SCHEDULE. Fix startup notification message to match index.ts exactly.

## Success criteria
- abc.ts runs end-to-end without throwing: fetch → upload → extract → insert → notify → audit
- Dockerfile builds successfully with docker build
- scheduler.ts registers cron job on startup without error
- All 5 env vars documented in README env table
- adela_scrape_results and adela_audit_log tables created by migration SQL
- RLS policies present on both tables
- Error in abc.ts returns {success: false, error} — never throws upward
- No placeholder text, no TODOs, no "coming soon" strings

## Risks + mitigations
- Risk: Gemini API key absent → mitigation: log warning, skip extraction step, insert raw HTML reference only
- Risk: Atlas notify endpoint down → mitigation: retry once, then log failure and continue — never block scraper
- Risk: Supabase storage bucket absent → mitigation: create bucket if not exists before upload
- Risk: Migration timestamp collision → mitigation: use Date.now() as prefix for migration filename

## NEVER list
- NEVER throw errors upward from runAbcScraper — catch all, log all, return {success, error}
- NEVER hardcode Supabase URL, API keys, or schedule strings — always read from env vars
- NEVER modify existing files outside adela/ directory
- NEVER use synchronous file I/O (fs.readFileSync etc.) — async only
- NEVER skip the audit log write even if notify fails — audit log is always written last