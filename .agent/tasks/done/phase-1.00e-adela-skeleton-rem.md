# Task: Phase 1.00e-rem — Adela Skeleton Completion Remediation

## Goal
The original phase-1.00e shipped only a partial abc.ts truncated at step 3. This remediation completes all missing files: Dockerfile, package.json, scheduler, wrappers, migration SQL, README, and fixes the re-throw bug and startup message mismatch.

## Files to create / modify
- `adela/src/scrapers/abc.ts` — complete steps 4–7: S3/storage upload, Gemini extraction, Supabase insert, notify wrapper call, audit log entry; remove re-throw in catch block (spec says never throw upward)
- `adela/Dockerfile` — Node 20 alpine, non-root user, health check on /health
- `adela/package.json` — all deps: @supabase/supabase-js, @google/generative-ai, node-cron, axios, dotenv
- `adela/src/scheduler.ts` — node-cron scheduler; runs abc scraper on configured cron; graceful shutdown on SIGTERM
- `adela/src/lib/supabase.ts` — typed Supabase client wrapper
- `adela/src/lib/gemini.ts` — Gemini Pro wrapper for document extraction
- `adela/src/lib/notify.ts` — notification wrapper (WhatsApp + Supabase insert to adela_events)
- `adela/supabase/migrations/<timestamp>_adela_init.sql` — adela_runs, adela_events, adela_documents tables with RLS
- `adela/README.md` — env table must include ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, TWILIO_*, ABC_*, CRON_SCHEDULE
- `adela/src/index.ts` — fix startup notification message to match README exactly

## Success criteria
- `abc.ts` completes all 7 steps without re-throwing errors
- `adela/Dockerfile` builds without error (no missing COPY targets)
- `scheduler.ts` starts, runs one tick, shuts down gracefully on SIGTERM
- All 3 migration tables present with RLS enabled
- README env table contains exactly: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ABC_*, CRON_SCHEDULE
- startup message in index.ts matches README word-for-word
- No stub, no TODO, no placeholder in any file
- Verifier stub-detector passes clean

## Risks + mitigations
- Risk: abc.ts already partially exists — mitigation: read existing file first, complete don't overwrite steps 1–3
- Risk: Gemini API shape changes — mitigation: pin to existing @google/generative-ai version already in monorepo if present
- Risk: migration timestamp collision — mitigation: use epoch ms at time of write for timestamp prefix

## NEVER list
- NEVER overwrite existing completed steps 1–3 in abc.ts
- NEVER add re-throw in any catch block in adela/src/ — log and continue only
- NEVER use a different Node base image than node:20-alpine
- NEVER omit ANTHROPIC_API_KEY from README env table
- NEVER leave TODO, "coming soon", or placeholder in any delivered file
