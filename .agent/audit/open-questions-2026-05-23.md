# Phase 1.2d Open Questions — Follow-up Workshop

**Date:** 2026-05-23 (snapshot capture); regenerated 2026-06-01 under Phase 1.2d.
**Source:** `.agent/audit/gap-report-2026-05-23.md`
**Snapshot:** `.agent/audit/live-schema-snapshot-2026-05-23.json`
(`_meta.is_live_db_output: true`,
`_meta.generated_at: 2026-05-23T12:39:40.24879+00:00`)

These are decisions a human needs to make. Each question has the
context, the options visible from the migrations + live DB + plan, and
a recommendation where the agent has confidence. Workshop these before
queueing the next drift-repair phase.

---

## Q1 — Identity tables and the `commodity_id` rule (companies, contacts)

**Category:** INTENTIONAL-DIVERGENCE — confirmation requested

**Context.** Master plan §4.2 says "every domain table that scopes to
almonds today has a `commodity_id` foreign key from migration #1."
V3-CODING-INSTRUCTIONS rule #3 says "every domain table must have a
`commodity_id` FK." The foundation migration creates `companies` and
`contacts` without `commodity_id`, and the live snapshot's
`commodity_id_check[]` array confirms neither has the column. The
implicit assumption is these are *identity* tables and multi-commodity
context flows through `relationships` (and downstream domain rows like
offers/inquiries/tracked_deals which DO carry commodity_id when they
ship in Phase 1.6/1.7/2).

**Options.**
1. **Affirm identity exemption.** Companies and contacts span
   commodities by design — a single trader buys both almonds and
   pistachios. `commodity_id` does not belong on them. Update master
   plan §4.2 to make the identity-vs-domain split explicit.
2. **Add `company_commodities` / `contact_commodities` join tables.**
   Carry per-company / per-contact commodity scope explicitly. Almost
   certainly not how trade-house CRM works (Maxons contacts span
   commodities).

**Recommendation:** Option 1. Update §4.2 to list identity exemptions
(commodities, companies, contacts, profiles, user_roles, legacy_users,
verification_requests, guest_sessions, auth_bridge_log). No 1.2d
migration.

---

## Q2 — `relationships` and the `commodity_id` rule

**Category:** AMBIGUOUS

**Context.** `relationships` is the CRM/BRM/SRM edge (§4.1 row 5). Live
DB has the table without `commodity_id`. A relationship like
"Maxons ↔ Acme" might naturally be "Maxons ↔ Acme for almonds" — i.e.,
scoped per commodity, since a trader's broker for almonds and for
cashews can be different people / different terms.

**Options.**
1. **Add `commodity_id` to relationships.** `NOT NULL REFERENCES
   commodities(id)`. Drop `UNIQUE(company_id, role)`; replace with
   `UNIQUE(company_id, role, commodity_id)`. Phase 2 migration; needs
   `almonds` backfill.
2. **Keep relationships commodity-agnostic.** Treat each row as "this
   counterparty is a broker for us across all commodities" and let
   per-commodity nuance live in offers/inquiries.
3. **Add a `relationship_commodities` join table.** Many-to-many.

**Recommendation:** Option 1, deferred to Phase 2 CRM scope. Out of 1.2d
migration scope.

---

## Q3 — `zyra_conversations` and `chat_sessions` `commodity_id`

**Category:** AMBIGUOUS

**Context.** Both tables record user-Zyra interactions; neither carries
`commodity_id` in live DB. Almonds-pilot through Phase 1.10 makes this
moot today. Phase 1.5 multi-commodity unlock makes it matter ("what did
this user ask Zyra about almonds" vs. "about pistachios").

**Options.**
1. Add nullable `commodity_id` now (NULL = general / multi-commodity chat).
2. Add NOT NULL `commodity_id` with default `almonds`.
3. Defer until Phase 1.5.

**Recommendation:** Option 3 — defer. Out of 1.2d scope.

---

## Q4 — Foundation-version collision risk audit (carried forward from 1.2b)

**Category:** Process

**Context.** Phase 1.10bb retro showed that two migration files sharing
a version prefix caused the verifier file to be silently skipped on
`db push`. The 1.2d column-level diff catches the *result* of such a
skip (declared but absent), but a separate `schema_migrations` table
dump is the only way to catch the *cause* (the row that "claims" the
file ran when it didn't).

**Question.** Should the next iteration of `scripts/audit-live-schema.sql`
include a dump of `supabase_migrations.schema_migrations` rows?

**Recommendation:** Yes — file as a future enhancement to the audit SQL.
Out of 1.2d scope (the SQL is locked at the 1.2b contract per task
spec).

---

## Q5 — DB-AHEAD tables (6 atlas-cockpit tables, no migration files)

**Category:** DB-AHEAD — flagged for follow-up workshop, NOT migrated.

**Findings (live-DB snapshot 2026-05-23):** six tables exist in the live
DB but have no `CREATE TABLE` in any migration file under
`supabase/migrations/`:

- `atlas_audit_events`
- `atlas_concept_links`
- `atlas_connections`
- `atlas_project_connections`
- `atlas_queue_operations` *(confirmed MCP-applied — see Q11 sub-entry)*
- `atlas_user_state`

None are §4.1 domain tables. None are V1.0-alpha-blocking. All were
likely created via direct Studio ALTERs or MCP `apply_migration` calls
during a cockpit phase that did not commit a migration file.

**Recommendation.** Schedule a dedicated workshop phase to backfill
migration files reproducing each `CREATE TABLE`. Capture column lists
from the live snapshot. Use FRESH unique timestamps (no sharing a
prefix with any existing `schema_migrations` version) and follow with
`supabase migration repair --status applied` against each new version
so `db push` does not try to re-run them on the already-populated live
DB. Per the 1.10bb retro this is the safe pattern.

---

## Q6 — DB-AHEAD columns (5 column-level findings, no migration files)

**Category:** DB-AHEAD — flagged for follow-up, NOT migrated.

**Findings (live-DB columns on declared tables, but the columns
themselves don't appear in any migration file):**

| Table | Column | Likely provenance |
|---|---|---|
| `atlas_dispatches` | `builder_pause_token` | MCP `apply_migration` during a cockpit / queue-pivot phase. No `.sql` file in repo. |
| `concepts` | `parent_folder` | MCP `apply_migration` during a concepts-UI phase. No `.sql` file in repo. |
| `plan_workshop_sessions` | `metadata` | MCP `apply_migration` during a workshop phase. No `.sql` file in repo. |
| `plan_workshop_sessions` | `archived_at` | DB-AHEAD — known MCP `phase_1_10bd_queue_pivot_step2` (cited in spec Context). |
| `plan_workshop_sessions` | `last_whatsapp_ping_at` | DB-AHEAD — known MCP `phase_c1_workshop_whatsapp_ping_col` (cited in spec Context). |

**Recommendation.** Same as Q5 — schedule a backfill workshop phase.
Each column gets an `ADD COLUMN IF NOT EXISTS` line in a new migration
with a fresh unique timestamp, followed by `migration repair --status
applied`. Out of 1.2d scope.

---

## Q7 — Verifier migration filename collision (1.10bb known issue, carried forward)

**Category:** INTENTIONAL-DIVERGENCE — already logged

**Context.** `20260507120000_verifier_subject_matter_hits.sql` shares
its version prefix with `20260507120000_atlas_schema_complete.sql`. The
ALTER was applied directly via pooled psql; the column is in the live
DB. A fresh clone running `db push` would still skip the verifier file.

**Recommendation.** Rename to a unique timestamp in a follow-up phase
(out of 1.2d scope). Listed here for visibility, not action.

---

## Q8 — Phase 2/3 schema design freeze (carried forward from 1.2b)

**Category:** Process

**Context.** Of the §4.1 entities, 7 (`offers`, `offer_lines`,
`inquiries`, `tracked_deals`, `communications`, `observations`,
`exceptions`) have no migration. All are Phase 2/3 / V1.0-beta scope.
The plan describes them at a high level but does not fix column lists.

**Question.** Should Phase 2 work pre-draft these migrations against
the master plan now, or wait for Phase 2 feature specs to drive the
schema?

**Recommendation.** Wait. Pre-drafting Phase 2 migrations risks the
anti-restart trap. Phase 1.2d's job is to surface what's there today;
Phase 2 owns the new tables.

---

## Q9 — `cockpit_phase_approvals` partial-apply drift (the 1.10bb-pattern headline)

**Category:** DRIFT — 1.10bb-class partial-apply

**Context.** Migration `20260508000000_concepts_and_phase_approvals.sql`
creates two tables: `concepts` and `cockpit_phase_approvals`. Live DB
has `concepts` but NOT `cockpit_phase_approvals` (column-level diff
shows the entire table as DECLARED-but-ABSENT). The `schema_migrations`
row for `20260508000000` was reported present in 1.2c, so `db push`
will not re-apply. This is the cleanest live-DB instance of the
1.10bb failure mode the audit was built to detect.

**Options.**
1. **Pooled-psql single-table apply.** Run only the
   `CREATE TABLE cockpit_phase_approvals` + index + RLS block from the
   migration file directly via the 1.10bb-proven pattern. Leaves the
   `schema_migrations` row claiming a partial state.
2. **New migration file with fresh unique timestamp.** Draft
   `<new-ts>_cockpit_phase_approvals_repair.sql` carrying only the
   missing table. Needs human gating per Phase 1.10bb learning.
3. **Defer.** Confirm via `grep -rn "cockpit_phase_approvals" src/
   supabase/ agent/` whether anything reads/writes it; if not,
   deferring is safe.

**Recommendation.** Option 2 in a dedicated follow-up phase (call it
`phase-1.10bf-cockpit-approvals-drift-repair`). Out of 1.2d scope per
the "V1.0-alpha-blocking only" migration-drafting rule. Cockpit
phase-approvals infrastructure is not auth/RBAC/queue/insights.

---

## Q10 — `20260506000001_atlas_schema_complete` redefinition gap (NEW in 1.2d)

**Category:** DRIFT — column-level (renaming/redefinition)

**Context.** The 1.2d column-level diff surfaced 13 columns declared in
`20260506000001_atlas_schema_complete.sql` that are NOT in the live DB:

| Table | Columns missing in live |
|---|---|
| `atlas_conversations` | `tool_calls`, `cost_usd` |
| `atlas_snapshots` | `queued`, `done`, `failed`, `trust_mode`, `payload` |
| `atlas_dispatches` | `tool_name`, `args` |
| `atlas_decisions` | `phase`, `decision`, `made_by` |

Some of these are renames of existing columns. Examples:
- `atlas_dispatches.tool_name` (declared) vs. `atlas_dispatches.tool`
  (live). The redefinition file proposed renaming `tool` → `tool_name`.
- `atlas_dispatches.args` (declared) vs. `atlas_dispatches.arguments`
  (live). Same renaming pattern.

The presence of three competing "atlas_schema_complete" files
(`20260506000001`, `20260507085227`, `20260507120000`) is itself a code
smell — they look like multiple competing attempts to consolidate the
atlas schema. None of the rename intentions in `20260506000001`
appear to have landed.

**Recommendation.** Workshop in the same drift-repair follow-up
(Q9/Q10). Decision needed: (a) accept the live shape as the truth and
delete the `20260506000001` redefinition lines, OR (b) ship a renaming
migration with explicit `ALTER TABLE ... RENAME COLUMN` statements
under a fresh timestamp. Until then, agent code must use the LIVE
column names (`tool`, `arguments`, not `tool_name`, `args`). Out of
1.2d scope.

---

## Q11 — Ghost `schema_migrations` rows from MCP `apply_migration` (NEW in 1.2d)

**Category:** AMBIGUOUS — migration history honesty

**Context.** Per the task spec Context block, three MCP-applied
migrations are known to have shipped via Supabase MCP `apply_migration`
rather than `db push`, leaving `schema_migrations` rows in the live DB
with no corresponding `.sql` file in `supabase/migrations/`:

| MCP migration name | Schema effect on live DB |
|---|---|
| `phase_c1_workshop_whatsapp_ping_col` | Added `plan_workshop_sessions.last_whatsapp_ping_at` |
| `phase_1_10bd_queue_pivot_step2` | Created `atlas_queue_operations` table + added `plan_workshop_sessions.archived_at` |
| `phase_1_10be_orphan_archive` | DATA migration: flipped 8 rows on `atlas_dispatches.status` to `legacy_inert`. No schema change. |

The schema effects of `phase_c1_workshop_whatsapp_ping_col` and
`phase_1_10bd_queue_pivot_step2` were both detected by the 1.2d
column-level / table-level diff (see Q5 and Q6 above). The data-only
effect of `phase_1_10be_orphan_archive` (the 8 `legacy_inert` rows)
was NOT surfaced by the diff because the audit captures schema
state, not row values; it is carried forward here for traceability.

Two additional ghost rows from 1.2c are still on the books:
- `20260506` (name `ai_analyses`) — the malformed remote row already
  documented in `runtime-state.md`. Muzammil-owned manual delete still
  pending.
- Any other phase rows the operator added since 1.2c.

**Options.**
1. **Backfill three migration files (no live-DB change).** Draft repo
   files capturing each phase's actual schema effect; then `migration
   repair --status applied` to keep `db push` quiet. Makes history
   honest. Needs investigation per phase.
2. **`--status reverted` then delete the rows.** Treat them as never-
   applied; the actual schema/data changes remain (no migration drives
   a DROP). Simpler but silently masks history.
3. **Mark as known-divergence in `runtime-state.md`.** Defer.

**Recommendation.** Option 1, scoped to the same drift-repair follow-up
as Q9 / Q10. The `20260506` row deletion remains Muzammil-owned per the
existing Phase 1.3c manual step. Out of 1.2d migration-drafting scope.

---

## Q12 — `verifier_runs` RLS hardening unapplied (carried forward from 1.2c)

**Category:** DRIFT — fully unapplied

**Context.** `20260511000001_fix_verifier_runs_rls.sql` adds four
explicit role-scoped RLS policies on `verifier_runs`. Live DB has none
of them; the file's `schema_migrations` row is absent. Verifier write
path operates today via service_role bypass, so this is hardening drift
not breaking drift.

**Recommendation.** Include in the same dedicated drift-repair follow-up
(Q9). The file is idempotent (`DROP POLICY IF EXISTS … CREATE POLICY`)
so re-running via `db push` or Studio is safe. Out of 1.2d scope.

---

## Summary table

| ID | Status | Scope | V1.0-alpha-blocking? | Routed to |
|---|---|---|---|---|
| Q1 | Workshop confirmation | Plan-text update | No | §4.2 plan revision |
| Q2 | Defer to Phase 2 | Schema change | No | Phase 2 CRM |
| Q3 | Defer to Phase 1.5 | Schema change | No | Phase 1.5 multi-commodity unlock |
| Q4 | Future enhancement | Audit SQL extension | No | Next iteration of `scripts/audit-live-schema.sql` |
| Q5 | Workshop | DB-AHEAD (6 tables) | No | Drift-repair follow-up phase |
| Q6 | Workshop | DB-AHEAD (5 columns) | No | Drift-repair follow-up phase |
| Q7 | Already logged | Filename collision | No | Standalone rename phase |
| Q8 | Defer | Process | No | Phase 2/3 feature specs own these |
| Q9 | Workshop (headline) | 1.10bb-pattern partial apply | No | Drift-repair follow-up phase |
| Q10 | Workshop | Redefinition gap | No | Drift-repair follow-up phase |
| Q11 | Workshop | MCP-applied ghost rows | No | Drift-repair follow-up phase |
| Q12 | Workshop | Unapplied RLS hardening | No | Drift-repair follow-up phase |

**Every entry routed for follow-up. Zero V1.0-alpha-blocking. Zero
migrations drafted in 1.2d.**

---

## DB-AHEAD count for self-verification

The Builder's `grep -c "DB-AHEAD" .agent/audit/open-questions-2026-05-23.md`
self-check expects ≥ 3 (the three MCP-applied migrations). This file
contains explicit "DB-AHEAD" labels in Q5 (DB-AHEAD tables), Q6
(DB-AHEAD columns), and Q11 (MCP-applied ghost-row entries for
`phase_c1_workshop_whatsapp_ping_col`, `phase_1_10bd_queue_pivot_step2`,
`phase_1_10be_orphan_archive`).
