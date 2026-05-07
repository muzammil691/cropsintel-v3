---
primary-domain: analytical
---
```markdown
---
model: claude-sonnet-4-5
phase: phase-1.6d
component: adela
---

# Task: Phase 1.6d — Adela Scheduler + Strata/News Scrapers

**Master plan reference:** `docs/master-plan.md` § Phase 1.6 (Adela ingestion layer completion)
**Estimated effort:** ~450 LOC across 3 files; 1 working session (~3–4 hours)
**Model:** claude-sonnet-4-5

---

## Goal

Complete the Adela ingestion layer by implementing three files:

1. **`adela/src/scheduler.ts`** — node-cron master scheduler that registers six cron jobs, traps all errors per-job, logs every run to Supabase via `logAdelaScrapeRun`, never crashes the process, confirms Supabase connectivity on startup, and exits with code `1` if Supabase is unreachable.
2. **`adela/src/scrapers/strata-scraper.ts`** — fetches Strata almond price data, parses variety / form / grade / price rows, and upserts into the `strata_prices` table.
3. **`adela/src/scrapers/news-scraper.ts`** — fetches almond trade news from configured RSS feeds, deduplicates headlines, and stores headlines + summaries in the `market_news` table.

---

## Architecture

### `adela/src/scheduler.ts`

- Import `node-cron` (already in `package.json` — see dependency note in Risks).
- Import Supabase service-role client from `adela/src/lib/supabase.ts` (must be shipped; see Risks).
- Import `logAdelaScrapeRun` helper from `adela/src/lib/log.ts` (must be shipped; see Risks).
- On module load:
  - Call `supabase.from('adela_scrape_runs').select('id').limit(1)` as a connectivity probe; `process.exit(1)` on failure.
  - Log all six registered job names + schedules to `console.info`.
- Registered cron jobs (all UTC):

| Job | Schedule |
|-----|----------|
| ABC position report | `0 6 * * 1` (Mon 06:00) |
| Strata prices | `0 7 * * 2` (Tue 07:00) |
| News scraper | `0 8 * * *` (daily 08:00) |
| ABC shipments | `0 6 * * 3` (Wed 06:00) |
| ABC receipts | `0 6 * * 4` (Thu 06:00) |
| AI analyst | `0 18 * * *` (daily 18:00) |

- Each job body is wrapped in `try/catch`; errors call `logAdelaScrapeRun` with `status: 'error'` and `rethrow: false`.

### `adela/src/scrapers/strata-scraper.ts`

- HTTP GET to Strata price endpoint (URL from `process.env.STRATA_PRICES_URL`).
- Parse HTML/JSON response into rows: `{ variety, form, grade, price_usd_per_lb, effective_date }`.
- Upsert into `strata_prices` using Supabase service-role client (conflict target: `variety, form, grade, effective_date`).
- Returns `{ rowsUpserted: number }` for logging.

### `adela/src/scrapers/news-scraper.ts`

- Reads RSS feed URLs from `process.env.NEWS_RSS_FEEDS` (comma-separated).
- Parses feeds with `rss-parser` (must be in `package.json`).
- Deduplicates by `link` field before insert.
- Inserts into `market_news`: `{ title, summary, source_url, published_at }`.
- Returns `{ rowsInserted: number }` for logging.

---

## Files

| Path | Action | ~LOC |
|------|--------|------|
| `adela/src/scheduler.ts` | Create | ~160 |
| `adela/src/scrapers/strata-scraper.ts` | Create | ~140 |
| `adela/src/scrapers/news-scraper.ts` | Create | ~150 |

Total: ~450 LOC.

---

## Prerequisite Dependencies

The following must be **confirmed shipped** before this phase begins (see Risks if not):

| Dependency | Location | Purpose |
|-----------|----------|---------|
| `supabase` service-role client | `adela/src/lib/supabase.ts` | All DB writes |
| `logAdelaScrapeRun` helper | `adela/src/lib/log.ts` | Per-job run logging |
| `adela_scrape_runs` table | Supabase DB, RLS disabled for service role | Connectivity probe + log sink |
| `strata_prices` table | Supabase DB — columns: `variety, form, grade, price_usd_per_lb, effective_date` | Strata upsert target |
| `market_news` table | Supabase DB — columns: `title, summary, source_url, published_at` | News insert target |
| `node-cron` | `adela/package.json` | Scheduling |
| `rss-parser` | `adela/package.json` | RSS feed parsing |

---

## Success Criteria

1. **Startup probe:** When `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are invalid, process exits with code `1` and logs the error before any cron jobs register.
2. **Startup logging:** When valid, scheduler logs all six job names and their cron expressions to stdout before the first tick.
3. **Isolation:** Throwing an exception inside any single scraper does not terminate the scheduler process; remaining jobs continue to fire on schedule.
4. **Error logging:** Every caught exception produces a row in `adela_scrape_runs` with `status = 'error'` and a non-null `error_message`.
5. **Strata upsert:** Running `strata-scraper` against a live or stubbed Strata endpoint produces ≥1 row in `strata_prices`; re-running does not produce duplicates (upsert idempotent).
6. **News deduplication:** Running `news-scraper` twice with the same RSS fixture inserts rows only on the first run; second run inserts 0 rows.
7. **Timing constraint:** AI analyst job cron expression is strictly `0 18 * * *` (18:00 UTC); no earlier schedule is accepted by the Verifier.
8. **No `setInterval`:** Static analysis (`grep -r 'setInterval' adela/src/`) returns zero matches.

---

## Risks + Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | `adela/src/lib/supabase.ts` or `logAdelaScrapeRun` not yet shipped | Medium | Blocking | **Prerequisite gate:** run Phase 1.6c (or equivalent) before this task. List unshipped helpers as blockers in the PR description. |
| R2 | `strata_prices` / `market_news` tables missing or schema mismatch | Medium | High | Verify table existence + column list in Supabase dashboard before coding. Add schema migration in this PR if missing (migration file: `supabase/migrations/20260506_phase1_6d_tables.sql`). |
| R3 | `adela_scrape_runs` table missing (connectivity probe will fail) | Low–Medium | High | Same as R2; include in migration. |
| R4 | Strata endpoint returns unexpected HTML format | Medium | Medium | Wrap parser in `try/catch`; log raw response on parse failure; return `rowsUpserted: 0` rather than throwing. |
| R5 | RSS feed URLs unavailable / rate-limited in CI | Low | Medium | Abstract feed fetch behind an injectable function; unit tests use a local RSS fixture file. |
| R6 | `node-cron` or `rss-parser` not in `package.json

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
