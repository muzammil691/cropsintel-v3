-- Atlas Schema Complete Migration — Smoke Tests
-- Phase 1.10b2
-- Tests table creation, FK constraints, views, and RLS policies

BEGIN;

-- ============================================================================
-- TEST 1: Insert rows into all 5 tables
-- ============================================================================

-- Insert into atlas_conversations
INSERT INTO atlas_conversations (thread_id, role, content, cost_usd)
VALUES (gen_random_uuid(), 'user', 'test message', 0.001);

-- Insert into atlas_snapshots
INSERT INTO atlas_snapshots (queued, done, failed, cost_today_usd, trust_mode)
VALUES (5, 3, 0, 0.050, 'standard');

-- Insert into atlas_dispatches
INSERT INTO atlas_dispatches (tool_name, args, status, cost_usd)
VALUES ('test_tool', '{"param": "value"}'::jsonb, 'success', 0.002);

-- Insert into atlas_decisions
INSERT INTO atlas_decisions (phase, decision, rationale, made_by)
VALUES ('phase-1.10b2', 'test decision', 'test rationale', 'test-agent');

-- Insert into atlas_cost_log (with FK to atlas_dispatches)
INSERT INTO atlas_cost_log (tool_name, model, cost_usd, tokens_in, tokens_out, dispatch_id)
SELECT 'test_tool', 'claude-sonnet-4-5', 0.002, 100, 50, id
FROM atlas_dispatches
WHERE tool_name = 'test_tool'
LIMIT 1;

-- ============================================================================
-- TEST 2: Verify FK constraint exists and has ON DELETE SET NULL
-- ============================================================================

DO $$
DECLARE
    fk_count int;
    delete_action char;
BEGIN
    -- Check FK exists
    SELECT COUNT(*), MAX(confdeltype)
    INTO fk_count, delete_action
    FROM pg_constraint
    WHERE conname LIKE '%atlas_cost_log%dispatch%'
      AND conrelid = 'atlas_cost_log'::regclass;

    IF fk_count = 0 THEN
        RAISE EXCEPTION 'FK constraint atlas_cost_log.dispatch_id not found';
    END IF;

    IF delete_action != 'n' THEN
        RAISE EXCEPTION 'FK constraint should have ON DELETE SET NULL (n), got %', delete_action;
    END IF;

    RAISE NOTICE 'FK constraint verified: atlas_cost_log.dispatch_id → atlas_dispatches.id ON DELETE SET NULL';
END;
$$;

-- ============================================================================
-- TEST 3: Query views (must return without error)
-- ============================================================================

-- atlas_cost_today should return rows or empty set
SELECT tool_name, model, total_cost_usd, total_tokens_in, total_tokens_out, call_count
FROM atlas_cost_today;

-- atlas_cost_month_to_date should return rows or empty set
SELECT tool_name, model, total_cost_usd, total_tokens_in, total_tokens_out, call_count
FROM atlas_cost_month_to_date;

-- ============================================================================
-- TEST 4: Verify RLS is enabled on all tables
-- ============================================================================

DO $$
DECLARE
    rls_count int;
BEGIN
    SELECT COUNT(*)
    INTO rls_count
    FROM pg_class
    WHERE relname IN ('atlas_conversations', 'atlas_snapshots', 'atlas_dispatches',
                      'atlas_decisions', 'atlas_cost_log')
      AND relrowsecurity = true;

    IF rls_count != 5 THEN
        RAISE EXCEPTION 'Expected RLS enabled on 5 tables, found %', rls_count;
    END IF;

    RAISE NOTICE 'RLS verified: enabled on all 5 Atlas tables';
END;
$$;

-- ============================================================================
-- TEST 5: Verify admin_only policy exists on all tables
-- ============================================================================

DO $$
DECLARE
    policy_count int;
BEGIN
    SELECT COUNT(*)
    INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('atlas_conversations', 'atlas_snapshots', 'atlas_dispatches',
                        'atlas_decisions', 'atlas_cost_log')
      AND policyname = 'admin_only';

    IF policy_count != 5 THEN
        RAISE EXCEPTION 'Expected admin_only policy on 5 tables, found %', policy_count;
    END IF;

    RAISE NOTICE 'Policies verified: admin_only policy exists on all 5 Atlas tables';
END;
$$;

ROLLBACK;

-- Output success message
SELECT 'Atlas schema migration tests PASSED' AS test_result;
