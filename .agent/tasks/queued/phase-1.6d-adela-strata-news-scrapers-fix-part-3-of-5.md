---
primary-domain: analytical
---
```markdown
---
model: claude-sonnet-4-5
phase: phase-1.6d
component: adela
estimated_effort: 3-4 hours
---

# Task: Phase 1.6d — Adela Strata + News Scrapers (Fix Part 3 of 5)

**Master plan reference:** `docs/master-plan.md` § Adela Multi-Commodity Scraper Fleet — Almond Vertical
**Estimated effort:** 3–4 hours
**Model:** `claude-sonnet-4-5`

## Goal

Implement two scrapers within the Adela service of CropsIntel V3:

1. **`adela/src/scrapers/strata-scraper.ts`** — fetches the Strata almond price sheet, parses prices by `variety` × `form` × `grade`, and upserts rows into `strata_prices` (`variety`, `form`, `grade`, `price_usd_per_lb`, `price_date`, `source_url`, `raw_json`).
2. **`adela/src/scrapers/news-scraper.ts`** — pulls RSS feeds from Almond Board of California, Fresh Plaza, and ProduceReport; normalizes entries (`title`, `summary`, `url`, `published_date`); and upserts into `market_news`.

Both scrapers must:
- Write a structured audit entry to `atlas_dispatches` on every run (success or failure).
- Handle errors gracefully — one scraper failure must **not** crash the other or any sibling scraper.
- Use the canonical V3 shared retry/backoff utility (`adela/src/lib/retry.ts`) rather than bespoke retry logic.

## Dependencies (Foundation-First)

This phase **depends on** the following already-shipped phases. **Verify each is present before writing a single line of scraper code.** If any dependency is absent, stop, open the appropriate phase as a blocker, and do not proceed.

| Dependency | Phase | Table / Artifact | How to verify |
|---|---|---|---|
| `strata_prices` schema migration | Phase 1.6a | `strata_prices` table in Supabase | `supabase/migrations/` contains a migration that creates `strata_prices` with all required columns |
| `market_news` schema migration | Phase 1.6b | `market_news` table in Supabase | `supabase/migrations/` contains a migration that creates `market_news` with all required columns |
| `atlas_dispatches` audit table | Phase 1.3 (Atlas core) | `atlas_dispatches` table in Supabase | `supabase/migrations/` contains the Atlas core migration; `AtlasDispatch` row type exists in `adela/src/types/db.ts` or `atlas/src/types/db.ts` |
| Shared retry/backoff library | Phase 1.5 (Adela lib hardening) | `adela/src/lib/retry.ts` | File exists and exports a `withRetry` (or equivalent) function; do not re-implement |

> **If any of the above has not shipped**, stop and implement the missing phase first. Do not create inline schema definitions or bespoke retry logic in this phase.

## Files

### New files
- `adela/src/scrapers/strata-scraper.ts`
- `adela/src/scrapers/news-scraper.ts`
- `adela/src/scrapers/__tests__/strata-scraper.test.ts`
- `adela/src/scrapers/__tests__/news-scraper.test.ts`
- `adela/src/scrapers/__tests__/fixtures/strata-sample.html` — representative Strata HTML fixture for unit tests
- `adela/src/scrapers/__tests__/fixtures/news-sample-abc.xml` — Almond Board of California RSS fixture
- `adela/src/scrapers/__tests__/fixtures/news-sample-freshplaza.xml` — Fresh Plaza RSS fixture
- `adela/src/scrapers/__tests__/fixtures/news-sample-producereport.xml` — ProduceReport RSS fixture

### Modified files
- `adela/src/scrapers/index.ts` — register both scrapers in the scraper registry
- `adela/src/types/db.ts` — add/confirm `StrataPrice`, `MarketNews`, and `AtlasDispatch` row types if not already present

### Reference files (read-only)
- `adela/src/lib/retry.ts` — canonical retry utility; use as-is, do not copy or modify
- `supabase/migrations/` — confirm `strata_prices`, `market_news`, and `atlas_dispatches` migrations exist before writing any upsert logic; read column names from migrations rather than inferring them

## Architecture

```
adela/src/scrapers/
  strata-scraper.ts        ← fetch + parse + upsert strata_prices
  news-scraper.ts          ← fetch RSS feeds + normalize + upsert market_news
  index.ts                 ← scraper registry; runs each scraper in an isolated
                              try/catch; one failure emits an error audit row
                              and continues to the next scraper

adela/src/lib/
  retry.ts                 ← shared exponential backoff (DO NOT duplicate)

adela/src/types/
  db.ts                    ← StrataPrice, MarketNews, AtlasDispatch row types

supabase/migrations/
  [phase-1.6a].sql         ← creates strata_prices (must exist before this phase)
  [phase-1.6b].sql         ← creates market_news   (must exist before this phase)
  [phase-1.3].sql          ← creates atlas_dispatches (must exist before this phase)

atlas_dispatches (Supabase table — owned by Phase 1.3)
  ← both scrapers write one row per run:
     { phase, scraper_name, status, rows_upserted, error_message, run_at }
```

### Scraper isolation contract

Each scraper is invoked independently inside the registry's orchestration loop. The registry wraps every scraper call in its own `try/catch` so one failure emits an error-status audit row to `atlas_dispatches` and execution continues to the next scraper. Neither scraper may `process.exit()` or rethrow past the registry boundary.

### CSS selector config pattern (Strata scraper)

All CSS selectors and XPath expressions used by `strata-scraper.ts` must be declared in a dedicated config object at the top of the file (or in a companion `strata-scraper.config.ts`). No selector string may be inlined inside parsing logic. This decouples structural changes from business logic and makes future updates a one-line change.

### RSS field validation (News scraper)

Before any upsert, `news-scraper.ts` must validate that each feed entry contains non-null `title`, `link`, and `pubDate`. Malformed entries are logged to `atlas_dispatches` as individual `status: warning` rows (or included in the run's `error_message` field) and skipped — they must not halt the feed loop or the sibling-scraper run.

## Success Criteria

All criteria below must be automatically verifiable by the Verifier agent without manual inspection.

1. **Strata upsert — shape**: `strata-scraper.ts` upserts at least one row into `strata_prices` containing non-null values for `variety`, `form`, `grade`, `price_usd_per_lb`, `price_date`, and `source_url` in a test run against `fixtures/strata-sample.html` (no live HTTP).
2. **Strata upsert — idempotency**: Running `strata-scraper.ts` twice against the same fixture produces exactly the same row count (no duplicates), confirmed via `ON CONFLICT DO UPDATE` behavior in the test database.
3. **News upsert — shape**: `news-scraper.ts` upserts at least one row into `market_news` containing non-null `title`, `url`, and `published_date` from **each** of the three configured RSS sources when fed the corresponding fixture XML files.
4. **News upsert — idempotency**: Running `news-scraper.ts` twice against the same fixture XML files produces no duplicate rows in `market_news`.
5. **Audit logging — success**: After a successful scraper run,

## Risks + mitigations

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- **Risk:** Council was unavailable, so draft may have gaps. **Mitigation:** review the spec carefully before queueing; refine ambiguous items.

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
