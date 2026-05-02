# Task: Phase 1.00e-rem — Adela Skeleton Completion

## Goal
Complete the Adela scraper skeleton from partial scaffold to fully runnable service. Multiple files are absent or truncated. Complete all missing pieces.

## Files to create / modify
1. `adela/src/scrapers/abc.ts` — complete steps 4–7 that were truncated:
   - Step 4: Upload raw JSON to Supabase Storage bucket `adela-raw`
   - Step 5: Gemini extraction — structured data from raw JSON
   - Step 6: Insert extracted rows into `adela_abc_data` table
   - Step 7: Send notify (success count, errors) + write audit log row to `adela_audit_log`
   - Fix: remove re-throw in catch block — log error, resolve, never throw upward
2. `adela/Dockerfile` — Node 20 alpine, copies src, runs `npm ci`, CMD `node dist/index.js`
3. `adela/package.json` — if absent: create with name `adela`, scripts (build, start, dev), deps (typescript, @supabase/supabase-js, @google/generative-ai, node-cron, axios)
4. `adela/src/scheduler.ts` — cron scheduler. Runs `runAbcScraper` on schedule (default: `0 6 * * *`). Reads `ADELA_ABC_CRON` env var to override. Logs start/end/error.
5. `adela/src/lib/supabase.ts` — Supabase client singleton. Reads `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. Exports `supabase`.
6. `adela/src/lib/gemini.ts` — Gemini client wrapper. Reads `GEMINI_API_KEY`. Exports `extractStructured(prompt: string, data: unknown): Promise<unknown>`.
7. `adela/src/lib/notify.ts` — notification util. Reads `NOTIFY_WEBHOOK_URL`. Sends POST with `{ event, payload }`. Never throws — logs on failure.
8. `adela/supabase/migrations/<timestamp>_adela_schema.sql` — creates `adela_abc_data` and `adela_audit_log` tables with RLS enabled, indexes on `scraped_at`, `source`.
9. `adela/README.md` — env table must include: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `NOTIFY_WEBHOOK_URL`, `ADELA_ABC_CRON`. Startup message must match `index.ts` exactly.
10. `adela/src/index.ts` — fix startup notification message to match README exactly.

## Success criteria
- `adela/Dockerfile` present and valid (FROM node:20-alpine, CMD node dist/index.js)
- `adela/package.json` present with build + start scripts
- `adela/src/scheduler.ts` present, exports `startScheduler()`
- `adela/src/lib/supabase.ts`, `gemini.ts`, `notify.ts` all present
- `adela/supabase/migrations/` contains at least one SQL file creating `adela_abc_data`
- `adela/README.md` env table contains all 6 env vars including `ANTHROPIC_API_KEY`
- `abc.ts` catch block does NOT re-throw — logs and resolves
- `abc.ts` steps 4–7 all implemented (upload, extract, insert, notify+audit)
- Startup message in `index.ts` matches README exactly
- TypeScript compiles with zero errors across adela/src/
- No TODO / coming soon / placeholder strings anywhere

## Risks + mitigations
- Risk: `adela-raw` Supabase Storage bucket may not exist → mitigation: wrap upload in try/catch with clear error log "bucket adela-raw missing — create it in Supabase dashboard"
- Risk: `GEMINI_API_KEY` absent at runtime → mitigation: guard in gemini.ts, log warn and return empty extraction — never crash scheduler
- Risk: Migration timestamp collision → mitigation: use current unix timestamp in filename
- Risk: package.json already exists partial → mitigation: read before writing, merge deps not replace

## NEVER list
- NEVER delete existing abc.ts steps 1–3 — only append steps 4–7
- NEVER throw errors upward from runAbcScraper catch block
- NEVER hardcode Supabase URLs or API keys
- NEVER add npm packages beyond those listed in Goal section without checking existing package.json
- NEVER modify files outside adela/ directory
- NEVER leave TODO, "coming soon", or placeholder strings
- NEVER run destructive SQL (DROP TABLE, TRUNCATE) in migrations
