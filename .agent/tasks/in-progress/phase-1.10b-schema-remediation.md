# Task: Phase 1.10b-rem — Atlas Schema Followup Remediation

## Goal
Create the 2 missing tables (`brain_discussions`, `brain_node_history`), add missing indexes on `brain_nodes`, complete RLS policies on `pd_decisions`, and create the `v_atlas_health` helper view. All identified as missing by o3 judge during re-audit of commit 839457f8.

## Background
Re-audit of phase-1.10b-atlas-schema-followup (commit 839457f8) returned `verdict: pass` but ai_judgment explicitly stated "fail decision" citing: two missing tables, specific indexes absent, incomplete RLS policies, and missing helper views. Cross-referencing V1 architecture doc confirms `brain_discussions` and `brain_node_history` exist in V1 with full schema but are not present in V3. The `v_atlas_health` helper view is confirmed absent from V3. These are schema foundation gaps — everything that builds on Atlas conductor persistence depends on these being present.

## Files to change
- `supabase/migrations/[timestamp]_brain_discussions.sql` — NEW — create brain_discussions table with RLS + indexes
- `supabase/migrations/[timestamp]_brain_node_history.sql` — NEW — create brain_node_history table with RLS + indexes
- `supabase/migrations/[timestamp]_brain_nodes_indexes.sql` — NEW — add missing indexes on brain_nodes(node_key, score)
- `supabase/migrations/[timestamp]_pd_decisions_rls.sql` — NEW — complete RLS policies on pd_decisions (admin all + team select)
- `supabase/migrations/[timestamp]_v_atlas_health.sql` — NEW — create v_atlas_health helper view

## Schema definitions

### brain_discussions
```sql
create table brain_discussions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references brain_nodes(id) on delete cascade,
  thread_id text not null,
  author text not null,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index brain_discussions_node_id_idx on brain_discussions(node_id);
create index brain_discussions_thread_id_idx on brain_discussions(thread_id);
alter table brain_discussions enable row level security;
create policy "admin all" on brain_discussions for all using (auth.jwt() ->> 'role' = 'admin');
create policy "team select" on brain_discussions for select using (auth.jwt() ->> 'role' = 'team');
```

### brain_node_history
```sql
create table brain_node_history (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references brain_nodes(id) on delete cascade,
  changed_by text not null,
  change_type text not null,
  before jsonb,
  after jsonb,
  changed_at timestamptz default now()
);
create index brain_node_history_node_id_idx on brain_node_history(node_id);
create index brain_node_history_changed_at_idx on brain_node_history(changed_at);
alter table brain_node_history enable row level security;
create policy "admin all" on brain_node_history for all using (auth.jwt() ->> 'role' = 'admin');
create policy "team select" on brain_node_history for select using (auth.jwt() ->> 'role' = 'team');
```

### v_atlas_health
```sql
create view v_atlas_health as
select
  (select count(*) from brain_nodes) as total_nodes,
  (select count(*) from brain_discussions) as total_discussions,
  (select count(*) from brain_node_history) as total_history_events,
  (select count(*) from pd_plans) as total_plans,
  (select count(*) from pd_decisions) as total_decisions,
  now() as checked_at;
```

## Success criteria
- [ ] `brain_discussions` table exists with correct columns, indexes, and RLS policies
- [ ] `brain_node_history` table exists with correct columns, indexes, and RLS policies
- [ ] `brain_nodes` has indexes on `node_key` and `score`
- [ ] `pd_decisions` has admin-all and team-select RLS policies
- [ ] `v_atlas_health` view exists and returns a row without error
- [ ] All migrations are idempotent (safe to re-run)
- [ ] Verifier stub-detector passes on all new files
- [ ] o3 re-audit confirms no schema gaps remain

## Risks + mitigations
- Risk: `brain_nodes` table does not exist yet in V3 → mitigation: migration checks for table existence before adding indexes, adds table if absent
- Risk: `pd_decisions` already has partial RLS that conflicts → mitigation: migration uses `drop policy if exists` before recreating
- Risk: `v_atlas_health` references tables not yet created in same migration run → mitigation: view migration runs last, after all table migrations
- Risk: timestamp ordering of migrations causes wrong execution order → mitigation: migrations named with explicit sequence prefix (001, 002, 003, 004, 005)

## NEVER list
- NEVER drop or alter existing tables: `pd_plans`, `pd_proposals`, `pd_approvals`, `pd_evidence`, `atlas_events`, `brain_nodes`
- NEVER modify existing confirmed RLS policies on any table not listed in Files to change
- NEVER run non-idempotent SQL — all migrations must use `if not exists` / `if exists` guards
- NEVER hardcode user IDs or environment-specific values in migrations
- NEVER modify application code outside supabase/migrations/
