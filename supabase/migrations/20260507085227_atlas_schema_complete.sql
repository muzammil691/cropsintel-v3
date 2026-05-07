-- Phase 1.10b2 — Atlas Schema Complete
-- Creates all missing Atlas DB tables: conversations, snapshots, dispatches, decisions, cost_log
-- Plus 2 aggregate views: atlas_cost_today, atlas_cost_month_to_date
-- RLS enabled on all tables with admin-only policy

-- Table 1: atlas_conversations
-- Stores every message turn in an Atlas LLM conversation thread
CREATE TABLE IF NOT EXISTS atlas_conversations (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id     uuid          NOT NULL,
    role          text          NOT NULL CHECK (role IN ('system','user','assistant','tool')),
    content       text,
    tool_calls    jsonb,
    cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_conversations_thread_id_idx
    ON atlas_conversations (thread_id, created_at);

-- Table 2: atlas_snapshots
-- One row per Atlas snapshot run; tracks queue state and cost
CREATE TABLE IF NOT EXISTS atlas_snapshots (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    queued           int           NOT NULL DEFAULT 0,
    done             int           NOT NULL DEFAULT 0,
    failed           int           NOT NULL DEFAULT 0,
    cost_today_usd   numeric(12,6) NOT NULL DEFAULT 0,
    trust_mode       text          NOT NULL DEFAULT 'standard'
                                   CHECK (trust_mode IN ('standard','strict','permissive')),
    payload          jsonb,
    created_at       timestamptz   NOT NULL DEFAULT now()
);

-- Table 3: atlas_dispatches
-- Ledger of every tool invocation Atlas makes
CREATE TABLE IF NOT EXISTS atlas_dispatches (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name     text          NOT NULL,
    args          jsonb,
    result        jsonb,
    status        text          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','success','error')),
    cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
    duration_ms   int,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

-- Table 4: atlas_decisions
-- Audit log of decisions made by the Atlas council
CREATE TABLE IF NOT EXISTS atlas_decisions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phase         text        NOT NULL,
    decision      text        NOT NULL,
    rationale     text,
    made_by       text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Table 5: atlas_cost_log
-- Fine-grained per-call cost telemetry; FK to atlas_dispatches
-- IMPORTANT: Must come AFTER atlas_dispatches due to FK dependency
CREATE TABLE IF NOT EXISTS atlas_cost_log (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name     text          NOT NULL,
    model         text          NOT NULL,
    cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
    tokens_in     int           NOT NULL DEFAULT 0,
    tokens_out    int           NOT NULL DEFAULT 0,
    dispatch_id   uuid          REFERENCES atlas_dispatches (id) ON DELETE SET NULL,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_cost_log_dispatch_id_idx
    ON atlas_cost_log (dispatch_id);
CREATE INDEX IF NOT EXISTS atlas_cost_log_created_at_idx
    ON atlas_cost_log (created_at);

-- View 1: atlas_cost_today
-- Aggregates today's cost by tool and model
CREATE OR REPLACE VIEW atlas_cost_today AS
SELECT
    tool_name,
    model,
    SUM(cost_usd)     AS total_cost_usd,
    SUM(tokens_in)    AS total_tokens_in,
    SUM(tokens_out)   AS total_tokens_out,
    COUNT(*)          AS call_count
FROM atlas_cost_log
WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
GROUP BY tool_name, model;

-- View 2: atlas_cost_month_to_date
-- Aggregates this month's cost by tool and model
CREATE OR REPLACE VIEW atlas_cost_month_to_date AS
SELECT
    tool_name,
    model,
    SUM(cost_usd)     AS total_cost_usd,
    SUM(tokens_in)    AS total_tokens_in,
    SUM(tokens_out)   AS total_tokens_out,
    COUNT(*)          AS call_count
FROM atlas_cost_log
WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
GROUP BY tool_name, model;

-- RLS Policies
-- Enable RLS on all 5 tables with admin-only access

-- atlas_conversations
ALTER TABLE atlas_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_only ON atlas_conversations;
CREATE POLICY admin_only ON atlas_conversations
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

-- atlas_snapshots
ALTER TABLE atlas_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_only ON atlas_snapshots;
CREATE POLICY admin_only ON atlas_snapshots
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

-- atlas_dispatches
ALTER TABLE atlas_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_only ON atlas_dispatches;
CREATE POLICY admin_only ON atlas_dispatches
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

-- atlas_decisions
ALTER TABLE atlas_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_only ON atlas_decisions;
CREATE POLICY admin_only ON atlas_decisions
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

-- atlas_cost_log
ALTER TABLE atlas_cost_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_only ON atlas_cost_log;
CREATE POLICY admin_only ON atlas_cost_log
    FOR ALL
    USING      ((auth.jwt() ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() ->> 'role') = 'admin');
