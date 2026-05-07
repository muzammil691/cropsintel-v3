---
primary-domain: mixed
---
```markdown
---
model: gemini-flash
phase: phase-1.6c
component: adela
status: approved
---

# Task: Phase 1.6c — Adela Supabase Client Wrapper and ABC Scraper Completion

**Master plan reference:** CropsIntel V3 Master Plan §4.2 (Adela ingestion layer) and §6.1 (ABC weekly position report pipeline). Follows phase-1.6a (Adela project scaffold) and phase-1.6b (Supabase schema migrations for `position_reports` and `strata_prices` tables with RLS policies).
**Estimated effort:** 3 developer days
**Model:** Gemini Flash (PDF extraction and scraper logic); spec authored under claude-sonnet-4.5

---

## Goal

Complete two files in the `adela` sub-package that together form the full Adela ingestion pipeline:

1. **`adela/src/lib/supabase.ts`** — a typed Supabase client wrapper that reads credentials from environment variables and exports domain-specific helper functions for all database writes and reads used by Adela scrapers.

2. **`adela/src/scrapers/abc-scraper.ts`** — the complete, production-ready ABC weekly position report scraper, implementing all 7 pipeline steps through to anomaly notification.

After this phase, the Adela service must be able to run end-to-end from ABC PDF discovery through to a persisted `position_reports` row and a logged scrape run, with anomaly alerts firing correctly on >15% week-on-week change.

**Prerequisite gate:** Phase-1.6b must be complete and its migrations applied before any code in this phase is merged. Builder must confirm `position_reports` and `strata_prices` tables exist with RLS policies before writing upsert logic. If phase-1.6b is not complete, halt and resolve it first.

---

## Files

### `adela/src/lib/supabase.ts`

**Purpose:** Single, canonical typed Supabase client for the Adela package.

**Requirements:**

- Before creating a new client, audit `packages/shared/src/supabase.ts` (and any other monorepo-wide shared Supabase client paths). If a compatible shared client exists, re-export or extend it rather than duplicating instantiation. Document the decision in a one-line comment at the top of the file (e.g., `// No monorepo shared client found at packages/shared — creating scoped Adela client` or `// Extending shared client from packages/shared/src/supabase.ts`).
- Read `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from `process.env`; throw a descriptive error at module load time if either is absent. The error message must contain the variable name (e.g., `"SUPABASE_URL is not set"`).
- Create the client using `createClient<Database>(url, key)` where `Database` is imported from the shared generated types file. Confirm the correct import path (`@cropsIntel/supabase-types` or `../../types/supabase`) by checking the monorepo before writing. Do **not** inline a hand-written `Database` type; use the generated source of truth.
- Export the following named helper functions with the exact signatures below:

```ts
insertPositionReport(data: InsertPositionReport): Promise<void>
upsertStrataPrice(data: UpsertStrataPrice): Promise<void>
logAdelaScrapeRun(status: 'success' | 'error', error?: string): Promise<void>
getLastScrapeTime(scraper_name: string): Promise<Date | null>
```

- All helpers must throw typed errors (not swallow them) so the scraper can catch and log them.
- No hardcoded credentials anywhere in this file.

---

### `adela/src/scrapers/abc-scraper.ts`

**Purpose:** Fetches the latest ABC PDF, parses 9 market rows, upserts to Supabase, logs the run, and fires anomaly alerts.

**The 7 mandatory steps:**

**Step 1 — Fetch ABC PDF URL list**
- Discover the current PDF listing from the ABC website dynamically (no hardcoded PDF URLs).
- Use HTTP fetch or axios; handle non-2xx responses with a thrown error.

**Step 2 — Download latest PDF**
- Select the most recent PDF from the discovered list (by date or filename convention, documented in code comments).
- Stream or buffer the download; do not write to disk unless absolutely necessary.

**Step 3 — Extract text via `pdf-parse`**
- Pass the PDF buffer to `pdf-parse`.
- Use **Gemini Flash** for any AI-assisted field extraction from raw text (see `## NEVER list`).

**Step 4 — Parse 9 market rows**
- Markets (in this exact order, matching V1 column mapping): `India`, `W.Europe`, `Middle East`, `China/HK`, `Vietnam`, `Turkey`, `UAE`, `Pakistan`, `Domestic`.
- **Column mapping MUST replicate the logic in `V1/src/extract-market-shipments.ts`.** Builder must read that file before writing any regex or parsing code. Do not guess at column indices or field positions.
- **`Turkey` is a standalone row. It MUST NOT be aggregated into, derived from, or summed with the `Middle East` row.** Both rows are parsed independently from the raw PDF text. This constraint was a 25-iteration fix in V1; regression here is unacceptable and is enforced by a mandatory unit test (see Success criteria §2).
- If a market row is missing from a given PDF, log a warning and continue; do not throw.

**Step 5 — Upsert into `position_reports`**
- Call `insertPositionReport(data)` from the Supabase wrapper.
- The `position_reports` table and its RLS policies must already exist (phase-1.6b dependency; see Risks + mitigations §1).

**Step 6 — Log scrape run result**
- Call `logAdelaScrapeRun('success')` on success or `logAdelaScrapeRun('error', errorMessage)` in the catch block.
- The scrape_runs log must always be written, even on partial failure. Use a `finally` block or equivalent pattern to guarantee this.

**Step 7 — Anomaly notification**
- After upsert, compare each market row's current value against the previous week's value retrieved via a dedicated query.
- If any market row shows a week-on-week change of **>15%** (absolute), fire a notification: `console.error` at minimum; Slack webhook if `SLACK_WEBHOOK_URL` env var is set.
- Anomaly check must run for all 9 rows; a single row breach must not suppress checks on remaining rows (use a loop with individual try/catch per row if needed).

---

## Success Criteria

The following conditions must all pass before this phase is considered complete. These become direct Verifier check inputs.

1. **TypeScript compilation:** `tsc --noEmit` passes with zero errors across the `adela` package.
2. **Unit test — Turkey/Middle East isolation:** A Jest test asserts that parsing a fixture PDF containing both Turkey and Middle East rows produces two separate entries in the output array, and that the `Middle East` numeric value does not include the Turkey value. Test file: `adela/src/scrapers/__tests__/abc-scraper.test.ts`.
3. **Unit test — all 9 markets present:** A Jest test asserts that a known fixture PDF produces exactly 9 market rows with the correct market name strings in the specified order.
4. **Unit test — anomaly threshold:** A Jest test asserts that a >15% week-on-week change triggers the notification path and a ≤15% change does not.
5. **Unit test — missing market row:** A Jest test asserts that a PDF missing one market row logs a warning (`console.warn` or logger equivalent) and does not throw.
6. **Environment variable guard:** Starting the module without `SUPABASE_URL` set throws an error with a message containing `"SUPABASE_URL"`.
7. **No hardcoded URLs:** `grep -r "https://abc\." adela/src/scrapers/` returns zero results.
8. **Scrape run always logged:** Code review and/or test confirms `logAdelaScrapeRun` is called in both the success and catch/finally paths.
9. **End-to-end smoke test (CI):** Running

## Risks + mitigations

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- **Risk:** Council was unavailable, so draft may have gaps. **Mitigation:** review the spec carefully before queueing; refine ambiguous items.

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
