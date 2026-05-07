-- Migration: 20260506000001_atlas_schema_complete.sql
-- Created: 2026-05-06
-- Author: atlas-architect (autonomous agent)
-- Purpose: Create all 5 Atlas control-plane tables + 2 cost aggregation views
--
-- Tables: atlas_conversations, atlas_snapshots, atlas_dispatches, atlas_decisions, atlas_cost_log
-- Views: atlas_cost_today, atlas_cost_month_to_date
-- RLS: Admin-only access on all tables via auth.jwt()->>'role' = 'admin'
--
-- Idempotent: Safe to re-run multiple times (CREATE IF NOT EXISTS + exception guards)

-- ============================================================================
-- TABLE 1: atlas_conversations
-- Append-only LLM turn log for Atlas conversations
-- ============================================================================
CREATE TABLE IF NOT EXISTS atlas_conversations (
    id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id     UUID             NOT NULL,
    role          TEXT             NOT NULL,
    content       TEXT,
    tool_calls    JSONB,
    cost_usd      NUMERIC(12,6),
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ============================================================================
-- TABLE 2: atlas_snapshots
-- Periodic Atlas state snapshots (queue counters, trust mode, cost snapshot)
-- ============================================================================
CREATE TABLE IF NOT EXISTS atlas_snapshots (
    id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    queued           INT              NOT NULL DEFAULT 0,
    done             INT              NOT NULL DEFAULT 0,
    failed           INT              NOT NULL DEFAULT 0,
    cost_today_usd   NUMERIC(12,6),
    trust_mode       TEXT,
    payload          JSONB,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ============================================================================
-- TABLE 3: atlas_dispatches
-- Tool call audit trail (args, results, duration, status)
-- ============================================================================
CREATE TABLE IF NOT EXISTS atlas_dispatches (
    id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name     TEXT             NOT NULL,
    args          JSONB,
    result        JSONB,
    status        TEXT             NOT NULL,
    cost_usd      NUMERIC(12,6),
    duration_ms   INT,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ============================================================================
-- TABLE 4: atlas_decisions
-- Human-readable ADR log written by Atlas council
-- ============================================================================
CREATE TABLE IF NOT EXISTS atlas_decisions (
    id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    phase         TEXT             NOT NULL,
    decision      TEXT             NOT NULL,
    rationale     TEXT,
    made_by       TEXT             NOT NULL,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ============================================================================
-- TABLE 5: atlas_cost_log
-- Fine-grained per-call cost ledger (references atlas_dispatches)
-- NOTE: Must be created AFTER atlas_dispatches due to FK constraint
-- ============================================================================
CREATE TABLE IF NOT EXISTS atlas_cost_log (
    id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name     TEXT             NOT NULL,
    model         TEXT             NOT NULL,
    cost_usd      NUMERIC(12,6)    NOT NULL,
    tokens_in     INT,
    tokens_out    INT,
    dispatch_id   UUID             REFERENCES atlas_dispatches(id),
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- created_at DESC on all tables + thread_id on atlas_conversations
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_atlas_conversations_created_at
    ON atlas_conversations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_conversations_thread_id
    ON atlas_conversations (thread_id);

CREATE INDEX IF NOT EXISTS idx_atlas_snapshots_created_at
    ON atlas_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_dispatches_created_at
    ON atlas_dispatches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_decisions_created_at
    ON atlas_decisions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_cost_log_created_at
    ON atlas_cost_log (created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY — Enable on all 5 tables
-- ============================================================================
ALTER TABLE atlas_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_cost_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES — Admin-only access (idempotent via exception guards)
-- ============================================================================

-- Policy: atlas_conversations admin-only
DO $$
BEGIN
    CREATE POLICY atlas_conversations_admin_only ON atlas_conversations
        FOR ALL
        USING (auth.jwt()->>'role' = 'admin')
        WITH CHECK (auth.jwt()->>'role' = 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Policy: atlas_snapshots admin-only
DO $$
BEGIN
    CREATE POLICY atlas_snapshots_admin_only ON atlas_snapshots
        FOR ALL
        USING (auth.jwt()->>'role' = 'admin')
        WITH CHECK (auth.jwt()->>'role' = 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Policy: atlas_dispatches admin-only
DO $$
BEGIN
    CREATE POLICY atlas_dispatches_admin_only ON atlas_dispatches
        FOR ALL
        USING (auth.jwt()->>'role' = 'admin')
        WITH CHECK (auth.jwt()->>'role' = 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Policy: atlas_decisions admin-only
DO $$
BEGIN
    CREATE POLICY atlas_decisions_admin_only ON atlas_decisions
        FOR ALL
        USING (auth.jwt()->>'role' = 'admin')
        WITH CHECK (auth.jwt()->>'role' = 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Policy: atlas_cost_log admin-only
DO $$
BEGIN
    CREATE POLICY atlas_cost_log_admin_only ON atlas_cost_log
        FOR ALL
        USING (auth.jwt()->>'role' = 'admin')
        WITH CHECK (auth.jwt()->>'role' = 'admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VIEWS — Cost aggregations (daily + month-to-date)
-- ============================================================================

-- View: atlas_cost_today (daily roll-up)
CREATE OR REPLACE VIEW atlas_cost_today AS
SELECT SUM(cost_usd) AS total_usd
FROM atlas_cost_log
WHERE created_at >= CURRENT_DATE;

-- View: atlas_cost_month_to_date (MTD roll-up)
CREATE OR REPLACE VIEW atlas_cost_month_to_date AS
SELECT SUM(cost_usd) AS total_usd
FROM atlas_cost_log
WHERE created_at >= DATE_TRUNC('month', NOW());
