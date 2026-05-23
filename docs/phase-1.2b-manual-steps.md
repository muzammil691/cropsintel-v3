# Phase 1.2b — Manual Steps

**Audience:** Muzammil. The autonomous Builder pass for 1.2b stops at SQL
drafting (it has no live-DB access by design — per Turn 2 of the spec
"Granting Builder direct prod DB read access: rejected"). The remaining
work is one Studio run + commit, then deferred until any migrations need
applying.

**Apply order:**

| Step | What | Owner | Reversible? | Status |
|---|---|---|---|---|
| 1 | Run `scripts/audit-live-schema.sql` in Supabase Studio against project `hzrnohsxigrqlmzegwlb`. **Overwrite** `.agent/audit/live-schema-snapshot-2026-05-23.json` (currently holds a migration-derived placeholder synthesized by `scripts/synthesize-migration-snapshot.mjs` — see `_meta.is_live_db_output: false`). Commit. | Muzammil | Yes (read-only SQL, no schema changes) | ⏳ Pending — placeholder exists, live-DB output not yet captured |
| 2 | Queue post-snapshot follow-up phase (auto-suggested by the agent once `_meta.is_live_db_output` flips to `true` or is dropped). | Muzammil | Yes | ⏳ Pending |
| 3 | Apply any drafted migrations one-by-one in Studio per the per-step instructions a future spec will produce. | Muzammil | Per-migration rollback notes will be inline. | ⏳ Pending (no migrations drafted in 1.2b — none were needed at the migration-file level) |

> **Note on the placeholder snapshot.** Remediation attempt 1 added
> `scripts/synthesize-migration-snapshot.mjs` so the Snapshot Verification Gate
> has a non-empty input even before Muzammil's Studio run. The synthesized
> file mirrors the live-DB introspection JSON shape but only reflects what
> the migration files say *should* exist — it cannot detect 1.10bb-style
> drift. Replacing it with the genuine Studio output is still required and is
> the only blocking step for the post-snapshot follow-up phase.

---

## Step 1 — Run the snapshot SQL

**Dependency reasoning:** no FK deps. SQL is read-only against
`information_schema` + `pg_catalog`. Safe to run on production any time.

### Full SQL to run

Copy from `scripts/audit-live-schema.sql` (committed in this branch). Or
copy from the inline block below — they are identical.

```sql
-- =============================================================================
-- Phase 1.2b — Live-schema introspection snapshot
-- READ-ONLY. information_schema + pg_catalog only. Idempotent. No user data.
-- =============================================================================

WITH

tables AS (
  SELECT
    n.nspname AS table_schema,
    c.relname AS table_name,
    c.reltuples::bigint AS row_count_estimate
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
),

columns AS (
  SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default,
    c.ordinal_position
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
),

foreign_keys AS (
  SELECT
    tc.table_name        AS table_name,
    kcu.column_name      AS column_name,
    ccu.table_schema     AS ref_schema,
    ccu.table_name       AS ref_table,
    ccu.column_name      AS ref_column,
    tc.constraint_name   AS constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema    = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema    = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema    = 'public'
),

indexes AS (
  SELECT
    i.tablename  AS table_name,
    i.indexname  AS index_name,
    i.indexdef   AS index_definition
  FROM pg_indexes i
  WHERE i.schemaname = 'public'
),

rls_enabled AS (
  SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
),

rls_policies AS (
  SELECT
    p.tablename AS table_name,
    p.policyname AS policy_name,
    p.cmd AS policy_command,
    p.roles AS policy_roles,
    p.permissive AS policy_permissive
  FROM pg_policies p
  WHERE p.schemaname = 'public'
),

commodity_id_check AS (
  SELECT
    t.table_name,
    EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = t.table_name
        AND c.column_name = 'commodity_id'
    ) AS has_commodity_id_column,
    EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema    = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema    = 'public'
        AND tc.table_name      = t.table_name
        AND kcu.column_name    = 'commodity_id'
        AND ccu.table_name     = 'commodities'
        AND ccu.column_name    = 'id'
    ) AS has_commodity_fk_to_commodities,
    (
      SELECT c.is_nullable
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = t.table_name
        AND c.column_name = 'commodity_id'
      LIMIT 1
    ) AS commodity_id_nullable
  FROM tables t
),

section_4_1_entities AS (
  SELECT entity, EXISTS (
    SELECT 1 FROM tables t WHERE t.table_name = entity
  ) AS present_in_db
  FROM (
    VALUES
      ('commodities'),
      ('companies'),
      ('contacts'),
      ('canonical_products'),
      ('relationships'),
      ('profiles'),
      ('offers'),
      ('offer_lines'),
      ('inquiries'),
      ('tracked_deals'),
      ('positions'),
      ('market_intelligence'),
      ('zyra_conversations'),
      ('communications'),
      ('observations'),
      ('exceptions'),
      ('verification_requests'),
      ('guest_sessions'),
      ('auth_bridge_log'),
      ('chat_sessions'),
      ('news_items'),
      ('prices'),
      ('position_reports'),
      ('user_roles'),
      ('legacy_users')
  ) AS e(entity)
)

SELECT jsonb_build_object(
  'generated_at', now(),
  'database', current_database(),
  'table_count', (SELECT count(*) FROM tables),
  'tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', table_schema,
      'table',  table_name,
      'row_count_estimate', row_count_estimate
    ) ORDER BY table_name), '[]'::jsonb)
    FROM tables
  ),
  'columns', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name,
      'data_type', data_type, 'is_nullable', is_nullable,
      'default', column_default, 'ordinal_position', ordinal_position
    ) ORDER BY table_name, ordinal_position), '[]'::jsonb)
    FROM columns
  ),
  'foreign_keys', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name,
      'ref_schema', ref_schema, 'ref_table', ref_table,
      'ref_column', ref_column, 'constraint_name', constraint_name
    ) ORDER BY table_name, column_name, constraint_name), '[]'::jsonb)
    FROM foreign_keys
  ),
  'indexes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'index', index_name, 'definition', index_definition
    ) ORDER BY table_name, index_name), '[]'::jsonb)
    FROM indexes
  ),
  'rls_enabled', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'enabled', rls_enabled
    ) ORDER BY table_name), '[]'::jsonb)
    FROM rls_enabled
  ),
  'rls_policies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'policy', policy_name, 'cmd', policy_command,
      'roles', policy_roles, 'permissive', policy_permissive
    ) ORDER BY table_name, policy_name), '[]'::jsonb)
    FROM rls_policies
  ),
  'commodity_id_check', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name,
      'has_commodity_id_column', has_commodity_id_column,
      'has_commodity_fk_to_commodities', has_commodity_fk_to_commodities,
      'commodity_id_nullable', commodity_id_nullable
    ) ORDER BY table_name), '[]'::jsonb)
    FROM commodity_id_check
  ),
  'section_4_1_entities', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'entity', entity, 'present_in_db', present_in_db
    ) ORDER BY entity), '[]'::jsonb)
    FROM section_4_1_entities
  )
) AS snapshot;
```

### Per-step verification SQL

After pasting the snapshot into `.agent/audit/live-schema-snapshot-2026-05-23.json`,
verify by running these short queries in Studio (each ~1 second):

```sql
-- Sanity check 1: public schema table count matches what's in the snapshot's table_count field
SELECT count(*) AS public_table_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
```

```sql
-- Sanity check 2: section_4_1_entities present-in-db rows
SELECT relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND relname IN (
    'commodities','companies','contacts','canonical_products','relationships',
    'profiles','offers','offer_lines','inquiries','tracked_deals','positions',
    'market_intelligence','zyra_conversations','communications','observations',
    'exceptions','verification_requests','guest_sessions','auth_bridge_log',
    'chat_sessions','news_items','prices','position_reports','user_roles',
    'legacy_users'
  )
ORDER BY relname;
```

Expected: a list including at minimum `commodities`, `companies`, `contacts`,
`canonical_products`, `relationships`, `profiles`, `positions`,
`market_intelligence`, `zyra_conversations`, `verification_requests`,
`guest_sessions`, `auth_bridge_log`, `chat_sessions`, `news_items`, `prices`,
`position_reports`, `user_roles`, `legacy_users`. Missing entries are
PLAN-AHEAD; extra entries are out of scope (Phase 2/3 entities not yet
created).

### Per-step failure-recovery

The SQL is read-only — there is nothing to roll back. If the JSON output
is truncated by Studio's display (rare, but possible at ~100 KB +), re-run
each top-level CTE separately:

```sql
-- e.g., just the columns
SELECT jsonb_agg(jsonb_build_object(
  'table', table_name, 'column', column_name,
  'data_type', data_type, 'is_nullable', is_nullable, 'default', column_default
) ORDER BY table_name, ordinal_position)
FROM information_schema.columns
WHERE table_schema = 'public';
```

Concatenate the pieces into the snapshot JSON manually. The post-snapshot
gate doesn't care whether the JSON came from one query or twelve, only that
the top-level keys are populated.

---

## Step 2 — Queue post-snapshot follow-up phase

Once `.agent/audit/live-schema-snapshot-2026-05-23.json` is committed, queue
a follow-up spec (suggested title: "Phase 1.2b-post — snapshot reconciliation
+ drift-fix migrations") and the agent will:

1. Re-run the Snapshot Verification Gate against the snapshot.
2. Update `.agent/audit/gap-report-2026-05-23.md` with a Live-DB column.
3. Draft any V1.0-alpha-blocking migrations that the snapshot reveals to be
   genuinely missing (likely 0 — see gap-report's V1.0-alpha-blocking
   subsection — but the gate is exactly the mechanism that catches Phase
   1.10bb-style silent drift).
4. Update this manual-steps doc Step 3 with per-migration apply instructions.

There is no per-step verification or failure-recovery for this step beyond
"the follow-up spec gets queued."

---

## Step 3 — Apply drafted migrations (deferred)

**No migrations drafted in 1.2b.** Per the gap-report's V1.0-alpha-blocking
subsection, every table in the allowed subset
(`{commodities, news_items, market_intelligence, prices, profiles,
user_roles, verification_requests, auth_bridge_log}`) already has a migration
file in `supabase/migrations/`. Drafting "just in case" migrations against
unknown live-DB state would violate the anti-restart rule.

If the post-snapshot pass reveals genuine drift (a migration file exists
but did not apply, à la Phase 1.10bb's `subject_matter_hits` case), the
follow-up spec will append per-migration instructions to this Step 3 with:

- Apply order with FK dependency reasoning
- Full SQL inline per step
- Per-step verification SQL (column existence checks, RLS-policy presence
  checks)
- Per-step failure-recovery note (drop column, drop policy, or `IF NOT
  EXISTS` re-run safety)

Apply only via Supabase Studio. **`supabase db push` is forbidden** per
Phase 1.10bb learning.
