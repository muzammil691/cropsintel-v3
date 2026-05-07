---
primary-domain: analytical
---
```markdown
---
phase: phase-1.10b3
model: claude-sonnet-4-5
status: draft
owner: atlas-architect
created: 2026-05-06
---

# Task: Phase 1.10b3 — Complete Atlas DB Schema (Tables + Cost Views)

**Master plan reference:** CropsIntel V3 Master Plan §4.2 "Atlas Control Plane — Persistence Layer"
**Estimated effort:** 3–5 hours (single migration file, no application-layer changes)
**Model:** claude-sonnet-4-5

---

## Goal

Create all 5 missing Atlas control-plane tables and 2 aggregation views in a single idempotent Supabase migration file. The migration must be safe to re-run, must never drop existing objects, must enable Row-Level Security on every new table, and must restrict all access to JWT-authenticated admin users only.

This is a **foundational persistence task**. No Atlas agent logic, no API routes, and no UI components may be built until this migration is merged and verified against the production Supabase project.

Tables to create (all with `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`):

| Table | Key columns |
|---|---|
| `atlas_conversations` | `id UUID PK`, `thread_id UUID NOT NULL`, `role TEXT NOT NULL`, `content TEXT`, `tool_calls JSONB`, `cost_usd NUMERIC(12,6)` |
| `atlas_snapshots` | `id UUID PK`, `queued INT NOT NULL DEFAULT 0`, `done INT NOT NULL DEFAULT 0`, `failed INT NOT NULL DEFAULT 0`, `cost_today_usd NUMERIC(12,6)`, `trust_mode TEXT`, `payload JSONB` |
| `atlas_dispatches` | `id UUID PK`, `tool_name TEXT NOT NULL`, `args JSONB`, `result JSONB`, `status TEXT NOT NULL`, `cost_usd NUMERIC(12,6)`, `duration_ms INT` |
| `atlas_decisions` | `id UUID PK`, `phase TEXT NOT NULL`, `decision TEXT NOT NULL`, `rationale TEXT`, `made_by TEXT NOT NULL` |
| `atlas_cost_log` | `id UUID PK`, `tool_name TEXT NOT NULL`, `model TEXT NOT NULL`, `cost_usd NUMERIC(12,6) NOT NULL`, `tokens_in INT`, `tokens_out INT`, `dispatch_id UUID REFERENCES atlas_dispatches(id)` |

Views to create:

| View | Definition |
|---|---|
| `atlas_cost_today` | `SELECT SUM(cost_usd) AS total_usd FROM atlas_cost_log WHERE created_at >= CURRENT_DATE` |
| `atlas_cost_month_to_date` | `SELECT SUM(cost_usd) AS total_usd FROM atlas_cost_log WHERE created_at >= DATE_TRUNC('month', NOW())` |

---

## Files

```
supabase/
└── migrations/
    └── 20260506000001_atlas_schema_complete.sql   ← PRIMARY DELIVERABLE
```

**No other files are created or modified by this task.**

The migration file must follow this internal structure:

1. Header comment block (filename, date, author, purpose)
2. `CREATE TABLE IF NOT EXISTS` blocks in dependency order:
   - `atlas_conversations`
   - `atlas_snapshots`
   - `atlas_dispatches`
   - `atlas_decisions`
   - `atlas_cost_log` (depends on `atlas_dispatches` for FK)
3. `CREATE INDEX IF NOT EXISTS` blocks — one on `created_at DESC` per table, plus `atlas_conversations(thread_id)`
4. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — one per table
5. `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$` guards for all RLS policy creation
6. RLS policy bodies using `auth.jwt()->>'role' = 'admin'` for SELECT, INSERT, UPDATE, DELETE
7. `CREATE OR REPLACE VIEW` blocks for the two cost views

---

## Architecture

```
Supabase Postgres (production)
│
├── atlas_conversations        ← append-only LLM turn log
├── atlas_snapshots            ← periodic Atlas state snapshots
├── atlas_dispatches           ← tool call audit trail
│   └── ← referenced by atlas_cost_log.dispatch_id (nullable FK)
├── atlas_decisions            ← human-readable ADR log written by Atlas
└── atlas_cost_log             ← fine-grained per-call cost ledger
    │
    ├── VIEW: atlas_cost_today          (daily roll-up, no materialisation)
    └── VIEW: atlas_cost_month_to_date  (MTD roll-up, no materialisation)

All tables: RLS ON, admin-only policy, created_at DESC index
```

**No application code changes.** The Atlas agent will read/write these tables via the existing Supabase client already initialised in `lib/supabase.ts`. This task does not wire up that client — that is Phase 1.11.

---

## Success criteria

The Verifier must confirm **all** of the following before marking this task Done:

1. **File exists:** `supabase/migrations/20260506000001_atlas_schema_complete.sql` is present in the repository with a non-zero byte count.
2. **Idempotency:** Running `psql … -f 20260506000001_atlas_schema_complete.sql` twice against a clean test database produces zero errors on the second run.
3. **All 5 tables exist** in `information_schema.tables` with `table_schema = 'public'`:
   - `atlas_conversations`
   - `atlas_snapshots`
   - `atlas_dispatches`
   - `atlas_decisions`
   - `atlas_cost_log`
4. **Both views exist** in `information_schema.views`:
   - `atlas_cost_today`
   - `atlas_cost_month_to_date`
5. **RLS enabled:** `SELECT relrowsecurity FROM pg_class WHERE relname = '<table>'` returns `true` for all 5 tables.
6. **Admin policy present:** `SELECT COUNT(*) FROM pg_policies WHERE tablename = '<table>'` returns ≥ 1 for all 5 tables.
7. **Policy correctness:** Each policy's `qual` or `with_check` expression contains `auth.jwt()`.
8. **Indexes present:** `pg_indexes` contains at least one index on `created_at` for each of the 5 tables, and one index on `thread_id` for `atlas_conversations`.
9. **FK integrity:** `atlas_cost_log.dispatch_id` references `atlas_dispatches(id)` — confirmed via `information_schema.referential_constraints`.
10. **No existing tables dropped:** A `git diff` of the migration file contains zero `DROP TABLE` statements.
11. **Views return without error** when queried against an empty database (result is `NULL`, not an error).

---

## Risks + mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Partial prior migration exists** — one or more of the 5 tables already exists in production from an earlier ad-hoc migration, causing `CREATE TABLE IF NOT EXISTS` to silently skip columns. | Medium | High | Before running, Builder must execute `\d atlas_conversations` (and each table) in the Supabase SQL editor. If any table exists with a different schema, create a companion patch migration `20260506000002_atlas_schema_patch.sql` using `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Do NOT drop and recreate. |
| R2 | **RLS policy already exists** — re-running the migration fails with `duplicate_object` if policy names collide. | Medium | Medium | All `CREATE POLICY` statements must be wrapped in the idempotent PL/pgSQL `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$` guard. |
| R3 | **`auth.jwt()` unavailable in local dev** — Supabase local emulator may not expose `auth.jwt()` in the same way as production. | Low | Medium | RLS policies are verified in the Supabase **production** or **staging** project, not solely against a local Docker Postgres instance. Local smoke-tests may skip RLS enforcement checks. |
| R4 |

## NEVER list

<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->

- Never violate master plan §11.6 invariants.
- Never ship without verifying `npm run build` is clean.
