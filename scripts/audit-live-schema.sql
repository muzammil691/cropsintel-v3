-- =============================================================================
-- Phase 1.2b — Live-schema introspection snapshot
-- =============================================================================
-- READ-ONLY. Queries information_schema and pg_catalog only. NO user data.
-- Idempotent: running twice produces identical output (no DDL, no DML, no temp
-- tables persisted beyond the transaction).
--
-- HOW TO RUN (Muzammil, manual step):
--   1. Open Supabase Studio → SQL Editor → project hzrnohsxigrqlmzegwlb.
--   2. Paste the contents of this file.
--   3. Run. The single output column "snapshot" is the JSON document.
--   4. Click the cell → Copy. Save to:
--        .agent/audit/live-schema-snapshot-YYYY-MM-DD.json
--      (use today's UTC date)
--   5. Commit the snapshot file as a single small commit.
--
-- COMPOSITION OF THE SNAPSHOT
--   {
--     "generated_at":         <now()>,
--     "database":             <current_database()>,
--     "table_count":          <count of public tables>,
--     "tables":               [{schema, table, row_count_estimate}],
--     "columns":              [{table, column, data_type, is_nullable, default}],
--     "foreign_keys":         [{table, column, ref_table, ref_column}],
--     "indexes":              [{table, index, definition}],
--     "rls_enabled":          [{table, enabled}],
--     "rls_policies":         [{table, policy, cmd, roles}],
--     "commodity_id_check":   [{table, has_commodity_id, fk_target}],
--     "section_4_1_entities": [{entity, present_in_db}]
--   }
--
-- The §4.1 entity list is hard-coded so the snapshot has an explicit
-- present/not-present row for each, even when the table is missing.
-- =============================================================================

WITH

-- Public-schema table list with row-count estimate (pg_class.reltuples).
-- Estimates avoid touching user data; exact counts would require SELECT count(*)
-- against every table, which is slow and counts as "querying user data".
tables AS (
  SELECT
    n.nspname AS table_schema,
    c.relname AS table_name,
    c.reltuples::bigint AS row_count_estimate
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'   -- ordinary tables only (no views, no toast, no indexes)
),

-- Columns per public table (every column, ordered for deterministic output).
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

-- Foreign-key constraints (referencing public-schema tables).
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

-- Indexes per public table.
indexes AS (
  SELECT
    i.tablename  AS table_name,
    i.indexname  AS index_name,
    i.indexdef   AS index_definition
  FROM pg_indexes i
  WHERE i.schemaname = 'public'
),

-- RLS enable state per public table.
rls_enabled AS (
  SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
),

-- RLS policy ENUMERATION (existence + metadata only — NOT contents of USING/WITH CHECK).
-- Acceptance criterion #3 says "RLS policy presence (existence + table coverage,
-- NOT contents)". qual/with_check are intentionally omitted.
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

-- Multi-commodity FK check: does each public table have a commodity_id column,
-- and does it FK to commodities(id)? Used to detect §4.1 multi-commodity drift.
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

-- Master plan §4.1 entity presence — hard-coded so missing tables produce an
-- explicit row (acceptance criterion #4: every §4.1 entity appears in snapshot,
-- either present-row or not-present-row).
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
      -- Phase 1.3a/b extensions:
      ('verification_requests'),
      ('guest_sessions'),
      ('auth_bridge_log'),
      ('chat_sessions'),
      -- V1.0-alpha read-only insights surface:
      ('news_items'),
      ('prices'),
      -- V1.0-beta scope (per idea.md line 21 / runtime-state.md §Next up):
      ('position_reports'),
      -- RBAC foundation:
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
      'table',           table_name,
      'column',          column_name,
      'data_type',       data_type,
      'is_nullable',     is_nullable,
      'default',         column_default,
      'ordinal_position', ordinal_position
    ) ORDER BY table_name, ordinal_position), '[]'::jsonb)
    FROM columns
  ),
  'foreign_keys', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',           table_name,
      'column',          column_name,
      'ref_schema',      ref_schema,
      'ref_table',       ref_table,
      'ref_column',      ref_column,
      'constraint_name', constraint_name
    ) ORDER BY table_name, column_name, constraint_name), '[]'::jsonb)
    FROM foreign_keys
  ),
  'indexes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',      table_name,
      'index',      index_name,
      'definition', index_definition
    ) ORDER BY table_name, index_name), '[]'::jsonb)
    FROM indexes
  ),
  'rls_enabled', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',   table_name,
      'enabled', rls_enabled
    ) ORDER BY table_name), '[]'::jsonb)
    FROM rls_enabled
  ),
  'rls_policies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',      table_name,
      'policy',     policy_name,
      'cmd',        policy_command,
      'roles',      policy_roles,
      'permissive', policy_permissive
    ) ORDER BY table_name, policy_name), '[]'::jsonb)
    FROM rls_policies
  ),
  'commodity_id_check', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table',                            table_name,
      'has_commodity_id_column',          has_commodity_id_column,
      'has_commodity_fk_to_commodities',  has_commodity_fk_to_commodities,
      'commodity_id_nullable',            commodity_id_nullable
    ) ORDER BY table_name), '[]'::jsonb)
    FROM commodity_id_check
  ),
  'section_4_1_entities', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'entity',       entity,
      'present_in_db', present_in_db
    ) ORDER BY entity), '[]'::jsonb)
    FROM section_4_1_entities
  )
) AS snapshot;

-- =============================================================================
-- End of introspection SQL.
-- =============================================================================
