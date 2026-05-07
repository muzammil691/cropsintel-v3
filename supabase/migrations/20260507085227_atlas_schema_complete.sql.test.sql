-- Test file for atlas_schema_complete migration
-- Verifies all tables, views, FKs, and RLS policies work correctly

BEGIN;

-- Test 1: Insert test data into all 5 tables

-- Insert into atlas_conversations
INSERT INTO atlas_conversations (thread_id, role, content, cost_usd)
VALUES (gen_random_uuid(), 'user', 'test message', 0.001);

-- Insert into atlas_snapshots
INSERT INTO atlas_snapshots (queued, done, failed, cost_today_usd, trust_mode)
VALUES (5, 3, 1, 0.05, 'standard');

-- Insert into atlas_dispatches (save ID for FK test)
INSERT INTO atlas_dispatches (tool_name, args, status, cost_usd)
VALUES ('test_tool', '{"arg": "value"}'::jsonb, 'success', 0.002)
RETURNING id AS dispatch_id \gset

-- Insert into atlas_decisions
INSERT INTO atlas_decisions (phase, decision, made_by)
VALUES ('test-phase', 'test decision', 'test-agent');

-- Insert into atlas_cost_log with FK to atlas_dispatches
INSERT INTO atlas_cost_log (tool_name, model, cost_usd, tokens_in, tokens_out, dispatch_id)
VALUES ('test_tool', 'claude-sonnet-4', 0.002, 100, 50, :'dispatch_id');

-- Test 2: Verify all tables exist and have data
DO $$
DECLARE
    count_conversations int;
    count_snapshots int;
    count_dispatches int;
    count_decisions int;
    count_cost_log int;
BEGIN
    SELECT COUNT(*) INTO count_conversations FROM atlas_conversations;
    SELECT COUNT(*) INTO count_snapshots FROM atlas_snapshots;
    SELECT COUNT(*) INTO count_dispatches FROM atlas_dispatches;
    SELECT COUNT(*) INTO count_decisions FROM atlas_decisions;
    SELECT COUNT(*) INTO count_cost_log FROM atlas_cost_log;

    IF count_conversations = 0 THEN
        RAISE EXCEPTION 'atlas_conversations insert failed';
    END IF;
    IF count_snapshots = 0 THEN
        RAISE EXCEPTION 'atlas_snapshots insert failed';
    END IF;
    IF count_dispatches = 0 THEN
        RAISE EXCEPTION 'atlas_dispatches insert failed';
    END IF;
    IF count_decisions = 0 THEN
        RAISE EXCEPTION 'atlas_decisions insert failed';
    END IF;
    IF count_cost_log = 0 THEN
        RAISE EXCEPTION 'atlas_cost_log insert failed';
    END IF;
END $$;

-- Test 3: Verify views return data (no error)
DO $$
DECLARE
    view_today_count int;
    view_month_count int;
BEGIN
    SELECT COUNT(*) INTO view_today_count FROM atlas_cost_today;
    SELECT COUNT(*) INTO view_month_count FROM atlas_cost_month_to_date;

    IF view_today_count = 0 THEN
        RAISE EXCEPTION 'atlas_cost_today view returned no rows';
    END IF;
    IF view_month_count = 0 THEN
        RAISE EXCEPTION 'atlas_cost_month_to_date view returned no rows';
    END IF;
END $$;

-- Test 4: Verify FK constraint exists with ON DELETE SET NULL
DO $$
DECLARE
    fk_count int;
    delete_type char;
BEGIN
    SELECT COUNT(*), MAX(confdeltype)
    INTO fk_count, delete_type
    FROM pg_constraint
    WHERE conname LIKE '%atlas_cost_log%dispatch%'
      AND contype = 'f';

    IF fk_count = 0 THEN
        RAISE EXCEPTION 'FK constraint on atlas_cost_log.dispatch_id not found';
    END IF;
    IF delete_type != 'n' THEN
        RAISE EXCEPTION 'FK constraint does not have ON DELETE SET NULL (expected n, got %)', delete_type;
    END IF;
END $$;

-- Test 5: Verify RLS is enabled on all tables
DO $$
DECLARE
    rls_count int;
BEGIN
    SELECT COUNT(*)
    INTO rls_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('atlas_conversations', 'atlas_snapshots', 'atlas_dispatches', 'atlas_decisions', 'atlas_cost_log')
      AND rowsecurity = true;

    IF rls_count != 5 THEN
        RAISE EXCEPTION 'RLS not enabled on all 5 Atlas tables (found % tables with RLS)', rls_count;
    END IF;
END $$;

-- Test 6: Verify admin_only policy exists on all tables
DO $$
DECLARE
    policy_count int;
BEGIN
    SELECT COUNT(*)
    INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('atlas_conversations', 'atlas_snapshots', 'atlas_dispatches', 'atlas_decisions', 'atlas_cost_log')
      AND policyname = 'admin_only';

    IF policy_count != 5 THEN
        RAISE EXCEPTION 'admin_only policy not found on all 5 Atlas tables (found %)', policy_count;
    END IF;
END $$;

ROLLBACK;
