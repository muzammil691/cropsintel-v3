---
primary-domain: analytical
---
# ADR-010: Draft a CropsIntel V3 task spec for Phase phase-1.10b3. Goal / additional contex

**Status:** Proposed
**Date:** 2026-05-06
**Council depth:** Quick
**Confidence:** 0.85
**Total cost:** $0.1960
**Wall time:** 33s

## Context
Draft a CropsIntel V3 task spec for Phase phase-1.10b3.
Goal / additional context (from caller):
Complete Atlas DB schema. Create Supabase migration file supabase/migrations/&lt;timestamp&gt;_atlas_schema_complete.sql — idempotent, IF NOT EXISTS everywhere. Tables required: atlas_conversations (id uuid PK, thread_id text NOT NULL, role text CHECK IN user/assistant/system, content text, tool_calls jsonb, cost_usd numeric(10,6) default 0, created_at timestamptz), atlas_snapshots (id uuid PK, queued int, done int, failed int, cost_today_usd numeric(10,4), trust_mode text, payload jsonb, created_at timestamptz), atlas_dispatches (id uuid PK, tool_name text NOT NULL, args jsonb, result jsonb, status text default pending, cost_usd numeric(10,6), duration_ms int, created_at timestamptz), atlas_decisions (id uuid PK, phase text, decision text NOT NULL, rationale text, made_by text default atlas, created_at timestamptz), atlas_cost_log (id uuid PK, tool_name text, model text, cost_usd numeric(10,6), tokens_in int, tokens_out int, dispatch_id uuid FK atlas_dispatches, created_at timestamptz). Views: atlas_cost_today (SUM cost_usd where created_at >= date_trunc day now()), atlas_cost_month_to_date (SUM cost_usd where created_at >= date_trunc month now()). RLS enabled on all tables, admin-only policy on each using auth.jwt()->>role = admin. Indexes on thread_id, created_at DESC on all tables. NEVER drop existing tables. NEVER skip RLS. NEVER use REPLACE on tables.
Output the full spec body as adrMarkdown. The spec MUST contain (case-insensitive):
  - "# Task: Phase <X.Y> — <name>" heading
  - "**Master plan reference:**" line
  - "**Estimated effort:**" line
  - "**Model:**" line
  - "model:" frontmatter line
  - "## Goal" section
  - "## Files" or "## Architecture" section
  - "## Success criteria" section (these become Verifier check inputs)
  - "## Risks + mitigations" section
  - "## NEVER list" section (Builder hard constraints)
Foundation-first rule: do not propose a feature whose dependencies aren't
already shipped. If a dependency is missing, name it in Risks + mitigations
and recommend the dependency phase first.

## Decision
# Task: Phase 1.10b3 — Complete Atlas DB Schema

**Master plan reference:** CropsIntel V3 Development Roadmap — Completes the durable storage needed by the Atlas system.

**Estimated effort:** 1.5–2 hours

**Model:** CropsIntel V3 Atlas

## Goal
Ship a single idempotent Supabase migration that finalizes the Atlas persistence schema with five tables (`atlas_conversations`, `atlas_snapshots`, `atlas_dispatches`, `atlas_decisions`, `atlas_cost_log`) and two views (`atlas_cost_today`, `atlas_cost_month_to_date`). Ensure compliance with all safety and performance requirements, including use of RLS and specific indexation, while adhering to constraints on existing tables.

## Files
- `supabase/migrations/<timestamp>_atlas_schema_complete.sql` — creates necessary schema elements with `IF NOT EXISTS` to ensure idempotency.

## Success criteria
1. Successful idempotent application of the migration file.
2. All required tables and columns with constraints properly set.
3. Proper creation of views `atlas_cost_today`, `atlas_cost_month_to_date`.
4. Indexes applied to `thread_id` and `created_at DESC`.
5. RLS policies enabled correctly.
6. Strict adherence to NEVER policies.

## Risks + mitigations
- **Integration Risk:** Possible conflicts with existing schemas may arise; using thorough testing in a development environment mitigates this.
- **RLS Complexity:** Risk of data access issues due to misconfigured RLS policies, mitigated by careful review and testing.
- **Missing Dependencies:** Delay risks if dependencies are not met; address the creation of prerequisites first.

## NEVER list
- NEVER drop existing tables or data.
- NEVER skip RLS configuration.
- NEVER use REPLACE on tables.

## Synthesis
Claude and GPT-4o agreed on the core requirements for the database schema deployment, focusing on idempotency, RLS, and table/index creation, while Gemini Pro's input was unavailable. The main conflict was effort estimation, which was resolved in favor of Claude's more detailed phase description, enhancing credibility.

**Individual answers:**
- **Claude:** ---
model: claude-sonnet-4.5
phase: phase-1.10b3
type: database-migration
---

# Task: Phase 1.10b3 — Atlas DB Schema Completion

**Master plan reference:** CropsIntel V3 Master Plan §4.3 (Atlas Orchestrator persistence layer) — completes the durable storage substrate required by Atlas conversation 
- **GPT:** ```markdown
---
model: CropsIntel V3 Atlas

# Task: Phase 1.10b3 — Complete Atlas DB Schema

**Master plan reference:** CropsIntel V3 Development Roadmap
**Estimated effort:** 3 developer days
**Model:** CropsIntel V3 Atlas

## Goal

The objective of this task is to finalize and implement the Atlas 
- **Gemini:** (error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent: [404 Not Found] models/gemini-1.5-pro is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of avail

## Consequences
This architectural decision should be implemented in the next relevant task. The council has reviewed the question from multiple AI perspectives and reached a consensus.

## Full audit trail
council_runs.id = undefined in V3 Supabase
