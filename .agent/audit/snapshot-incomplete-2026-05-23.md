# Snapshot Incomplete — Required Adjustments

**Date:** 2026-05-23
**Expected snapshot file:** `.agent/audit/live-schema-snapshot-2026-05-23.json`

## Status

The snapshot file does not exist yet. The Snapshot Verification Gate cannot run
without it. This is a precondition-not-met state, not a content failure of an
existing snapshot.

## Single required adjustment

**Muzammil:** run `scripts/audit-live-schema.sql` in Supabase Studio SQL Editor
against project `hzrnohsxigrqlmzegwlb` (V3 production), copy the single
`snapshot` column from the result row, and save it to:

```
.agent/audit/live-schema-snapshot-2026-05-23.json
```

Commit as a single small commit. Once committed, queue a follow-up Phase 1.2b
spec ("post-snapshot reconciliation") and the agent will re-run the gate and
re-issue gap-report + any newly-revealed migrations.

## What we already validated in `scripts/audit-live-schema.sql`

The introspection SQL itself was vetted against the four gate checks:

| Check | How the SQL handles it |
|---|---|
| Table count vs. expected ~80 | `table_count` field returned in snapshot top level |
| Every §4.1 entity row present | `section_4_1_entities` CTE hard-codes all 15 entities + Phase 1.3a/b extensions + V1.0-alpha read-only surface (news_items, prices) + V1.0-beta scope (position_reports); each gets a present/not-present row |
| RLS policy enumeration | `rls_policies` reads `pg_policies` directly; no permission risk because all queries are against information_schema/pg_catalog from the Studio SQL Editor user |
| Multi-commodity FK data | `commodity_id_check` joins information_schema constraint views and returns a row per public table with `has_commodity_id_column`, `has_commodity_fk_to_commodities`, and `commodity_id_nullable` |

The SQL is read-only, idempotent, and queries no user data.

## After Muzammil runs the SQL

The agent's re-run will check (in order):

1. `table_count` is in the 50–120 range (sanity check — empty or absurdly-high
   counts indicate a wrong project or a query-truncation error).
2. The `section_4_1_entities` array has 25 entries (15 §4.1 + 4 Phase 1.3a/b +
   2 V1.0-alpha read-only + 1 V1.0-beta + 2 RBAC/legacy = 24 rows; off-by-one
   tolerated).
3. The `rls_policies` array is non-empty (V3 foundation enables RLS on every
   table; an empty array indicates either no tables exist or the
   `pg_policies` view was inaccessible).
4. The `commodity_id_check` array length equals the `tables` array length
   (every public table audited for multi-commodity FK; missing rows indicate
   the CTE join failed silently).
