# Task: Phase 1.7b — V1 data extraction + clean migration to V3

**Master plan reference:** new task — "complete clean data parsed and written cleanly" per user instruction 2026-04-29
**Depends on:** Phase 1.4 RBAC, Phase 1.2 schema
**Estimated effort:** ~10-15 hours; iterate.
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

V1 (`almond-oracle` Supabase project `knicjcmgizovpsnmbwex`) holds years of real almond data — varieties, prices, position reports, scraped industry intel, news. V3 needs that data parsed, normalized to V3's schema, and loaded into V3's Supabase (`hzrnohsxigrqlmzegwlb`) before Phase 1.8 (Market Price Intelligence) and 1.9 (Dashboard) can render anything meaningful.

This is the data foundation. Treat it carefully.

## In scope

### Step 1 — Discover V1 schema
Connect to V1 Supabase (read-only) using V1's anon key (in `~/Documents/Claude/Projects/Cropsintel/SECRETS.md` under V1 section). Enumerate all tables. Write `.agent/notes/v1-schema-inventory.md` listing:
- Every table's name, row count, columns, sample 3 rows
- Likely candidates for migration: anything with "price", "variety", "position", "news", "scrape", "report", "market"

### Step 2 — Identify the valuable subset
From the inventory, propose ~5-8 tables worth migrating. Write `.agent/notes/v1-migration-targets.md` justifying each pick. Examples I'd expect:
- `varieties` or `canonical_products` → V3's `variety_options` (already seeded but only with 9 vars; V1 may have more)
- `position_reports` → V3 needs a `position_reports` table (write a new migration if missing)
- `market_prices` / `daily_prices` → V3's `market_intelligence` table
- `news` → V3 needs a `news` table (write migration if missing)
- `scraped_data` / `industry_reports` → V3's `market_intelligence` (or a new `scraped_intel` table)

### Step 3 — Schema gap migrations
For any V1 table that doesn't have a V3 destination, write a new V3 migration: `supabase/migrations/20260429xxxxxx_data_foundation.sql`. Include:
- New tables with `commodity_id` foreign key (Day 1 multi-commodity rule per master plan 4.2)
- RLS policies (public read for `market_intelligence` and `news`; team-write only)
- Indexes on common query patterns (date desc, commodity_id, variety_id)

### Step 4 — Write migration scripts
In `scripts/migrate-v1-data/` create one TypeScript file per source table:
- `001-varieties.ts` — fetch from V1, transform, insert to V3
- `002-position-reports.ts`
- `003-market-prices.ts`
- `004-news.ts`
- `005-scraped-intel.ts`

Each script:
- Connects to V1 (read) and V3 (write) using credentials from env vars (`V1_SUPABASE_URL`, `V1_SUPABASE_ANON_KEY`, `V3_SUPABASE_URL`, `V3_SUPABASE_SERVICE_KEY`)
- Reads in batches of 500 (don't OOM)
- Transforms to V3 schema with explicit field mapping (no `any` types)
- Validates each row against V3 constraints
- Logs a count summary at end: `imported 1234 of 1500 rows; 266 skipped (reasons: ...)`
- Idempotent — safe to re-run

### Step 5 — Run + verify
- Run scripts in order
- After each, query V3 to spot-check: SELECT count(*), min(date), max(date) FROM <table>
- Document results in `.agent/notes/v1-migration-results.md`

### Step 6 — Update SEED reflection
- Update `supabase/migrations/20260428000001_v3_foundation.sql` (or write a follow-up migration) so re-running Day-1 setup doesn't blow away the migrated data. Use INSERT ... ON CONFLICT DO NOTHING patterns.

## Out of scope

- Migrating user accounts (those come via Phase 1.3's auth bridge)
- Migrating CRM data (V1 has minimal CRM; that's Phase 2 anyway)
- Real-time sync from V1 to V3 (one-time migration only)
- Touching V1 Supabase write operations (read-only)

## Acceptance criteria

1. V3 Supabase has at least 4 of these populated with real V1 data: varieties (>9 rows), position_reports (>10), market_prices (>30 days of history), news (>20), scraped_intel (>50)
2. Spot check: opening V3's Supabase Studio, picking a random row, the values look correct (not corrupted, not lorem ipsum, not test data from V1's dev environment)
3. Each migration script is idempotent — re-running doesn't duplicate rows
4. RLS verified: anonymous read works for `market_intelligence` and `news`; mutation requires team role
5. `npm run build` passes (no broken imports if you add any new types)
6. Migration script logs clearly say: "✅ X rows imported, Y rows skipped (reasons), Z conflicts handled"

## Foundation check (BEFORE starting)

- V1 Supabase access: V1's anon key from SECRETS.md (V1 section)
- V3 Supabase service-role key: needed for write side — should be in Railway env as `SUPABASE_SERVICE_ROLE_KEY` (if missing, write a question)
- Master plan rule 5: information walls ≠ data walls. Public market data CAN flow into V3's market_intelligence; private V1 customer data MUST NOT migrate (we're starting CRM fresh in Phase 2).

## Notes

- V1 was Lovable-built so its schema may have inconsistencies (snake_case vs camelCase, NULL where shouldn't be, etc.). Handle gracefully; skip rows that fail validation, log them. Don't crash on first bad row.
- Use `pg_dump` from V1 if Supabase API limits get in the way — Supabase exposes a Postgres connection string for that.
- After migration, manually inspect V3 Supabase Studio to make sure the data renders correctly — open `market_intelligence` and visually scroll.
- This task may legitimately need 5 retries — V1 is messy. That's OK. Worst case write a partial-progress question file.

---

**Done condition:** V3 has a populated data foundation; subsequent phases (1.8 market intel, 1.9 dashboard) can render against real numbers, not zeros.
