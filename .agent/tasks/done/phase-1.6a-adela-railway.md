# Phase 1.6a — Adela Runtime on Railway

## Goal
Deploy Adela scraper service on Railway with ABC Objective, Strata, and news-RSS scrapers running on schedule. Wire scraped data into Supabase V3 tables.

## Background
Adela is the data backbone of CropsIntel V3. Without live scraper data, Market Price Intelligence (1.8) and Dashboard (1.9) have nothing to display. This must land before 1.8 and 1.9 go live.

## Scope
- Railway service: `cropsintel-adela`
- Scrapers: ABC Objective (grain prices), Strata (position data), news-RSS (ag news feed)
- Scheduler: cron-based, ABC every 15min, Strata every 1hr, news every 30min
- Output: write to `prices`, `positions`, `news_items` Supabase tables
- Error handling: retry 3x, dead-letter log to `scraper_errors` table
- Health endpoint: `GET /health` returns last run timestamp + status per scraper

## Files to create/modify
- `services/adela/index.ts` — entry point
- `services/adela/scrapers/abc.ts`
- `services/adela/scrapers/strata.ts`
- `services/adela/scrapers/news.ts`
- `services/adela/scheduler.ts`
- `services/adela/db.ts` — Supabase write layer
- `railway.toml` — Adela service config
- `supabase/migrations/0013_adela_tables.sql` — prices, positions, news_items, scraper_errors

## Success criteria
- All 3 scrapers run on schedule without crashing
- Data appears in Supabase within 15 minutes of deploy
- `/health` returns 200 with valid JSON
- Zero data written without RLS policies in place

## Risks + mitigations
- ABC/Strata may change HTML structure → use CSS selector config file, not hardcoded selectors
- Railway cold starts may miss cron window → use persistent scheduler, not Railway cron
- Supabase write limits → batch inserts, not row-by-row

## NEVER list
- NEVER store API keys in code — use Railway environment variables only
- NEVER write to production Supabase without RLS policies active
- NEVER skip error logging — every scraper failure must land in scraper_errors
- NEVER hardcode scraper selectors inline
