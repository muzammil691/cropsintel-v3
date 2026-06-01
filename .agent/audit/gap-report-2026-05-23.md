# Phase 1.2d Gap Report — V3 Foundation vs. Master Plan §4.1

**Date:** 2026-05-23 (snapshot capture); regenerated 2026-06-01 under Phase 1.2d.
**Regenerated from:** live-DB output. The input is
`.agent/audit/live-schema-snapshot-2026-05-23.json` with
`_meta.is_live_db_output: true` and
`_meta.generated_at: 2026-05-23T12:39:40.24879+00:00` (Supabase pooler
capture). This file overwrites the 1.2b/1.2c content; the prior
synthesized-snapshot caveat from 1.2b is no longer applicable.

**Source-of-truth refs:**
- Master plan §4.1 (25 enumerated entities) — `.agent/master-plan.md`
- V1.0-alpha scope — `.agent/idea.md` line 20 ("auth + RBAC + verified queue + V2 user migration. Single product (almonds). Read-only insights at /insights.")
- V1.0-beta scope — `.agent/idea.md` line 21
- Phase 1.10bb migration-drift lesson — `.agent/runtime-state.md` (drift-detection mandate)

---

## Categorization

- **PLAN-AHEAD** — migration files declare a table/column missing from
  live DB.
  - V1.0-alpha-blocking → draft migration (none surfaced in 1.2d).
  - Phase 2/3 → report only (this phase's spec, "Out of scope").
- **DB-AHEAD** — live DB has a table/column the migration files don't
  declare. Routed to `open-questions-2026-05-23.md`. Do NOT migrate, do
  NOT update plan.
- **INTENTIONAL-DIVERGENCE** — divergence documented in follow-ups,
  runtime-state notes, V1/V2 legacy carry-over per framing. List with
  citation.
- **AMBIGUOUS** — divergence with no clear cause. Highest attention. Full
  context to `open-questions-2026-05-23.md`.

---

## §4.1 entity present/not-present (live snapshot)

The snapshot's `section_4_1_entities[]` array enumerates 25 entities, of
which 18 are present in the live DB and 7 are not. The 7 not-present
entries are exactly the Phase 2/3 entities listed in the task spec
"Migration drafting scope (NARROW)" block. None are V1.0-alpha-blocking.

| # | Entity | Master plan ref | In live DB? | Multi-commodity FK (live) | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `commodities` | §4.1 row 1, §4.2 | Yes | N-A-identity (this IS the master table) | Yes (foundation) | INTENTIONAL — table is the multi-commodity master itself | Seeded with `almonds`. |
| 2 | `companies` | §4.1 row 2 | Yes | FAIL — no commodity_id column in live DB | No (Phase 2 CRM) | INTENTIONAL-DIVERGENCE | Identity table; multi-commodity context flows via `relationships` and downstream domain rows. Q1 in open-questions confirms. |
| 3 | `contacts` | §4.1 row 3 | Yes | FAIL — no commodity_id column in live DB | No (Phase 2 CRM) | INTENTIONAL-DIVERGENCE | Same as `companies`. |
| 4 | `canonical_products` | §4.1 row 4 | Yes | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` in live | No (foundation, already shipped) | INTENTIONAL | Seeded with 9 almond varieties. |
| 5 | `relationships` | §4.1 row 5 | Yes | FAIL — no commodity_id column in live DB | No (Phase 2 CRM) | AMBIGUOUS | §4.2 reads as if relationships is a domain table and should carry `commodity_id`. Either the foundation missed it or the plan intends a `relationship × commodity` join. Does NOT block V1.0-alpha. Q2 in open-questions. |
| 6 | `profiles` | §4.1 row 6 | Yes | N-A-identity | Yes (auth foundation) | INTENTIONAL | Auth identity table. Multi-commodity context lives via relationships → company → commodity-scoped rows. |
| 7 | `offers` | §4.1 row 7 | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: V1.0-beta (Phase 1.6/1.7 marketplace scope)** | No migration drafted in 1.2d per task spec. |
| 8 | `offer_lines` | §4.1 row 8 | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: V1.0-beta (Phase 1.6/1.7 marketplace scope)** | Should FK to canonical_products + offers when drafted. No 1.2d migration. |
| 9 | `inquiries` | §4.1 row 9 | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: V1.0-beta (Phase 1.6/1.7 marketplace scope)** | No 1.2d migration. |
| 10 | `tracked_deals` | §4.1 row 10 | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: Phase 2 (CRM)** | Plan marks tracked_deals OPTIONAL. No 1.2d migration. |
| 11 | `positions` | §4.1 row 11 | Yes | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` | No (Phase 1.6 Adela / V1.0-beta) | INTENTIONAL — early ship for Adela | Adela scraper writes Strata positions; user-logged positions reuse table with `source` discriminator. |
| 12 | `market_intelligence` | §4.1 row 12 | Yes | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` | Yes (V1.0-alpha /insights surface) | INTENTIONAL | Backing store for read-only /insights. |
| 13 | `zyra_conversations` | §4.1 row 13 | Yes | FAIL — no commodity_id column | No (Zyra is single-commodity-pilot in Phase 1.10) | AMBIGUOUS | Almonds-pilot makes this temporarily moot; multi-commodity Phase 1.5 will require it. Q3 in open-questions. |
| 14 | `communications` | §4.1 row 14 | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: Phase 2 (CRM communications log)** | No 1.2d migration. |
| 15 | `observations` | §4.1 row 15a | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: Phase 3 (Atlas audit-trail)** | Atlas's data-quality findings. No 1.2d migration. |
| 16 | `exceptions` | §4.1 row 15b | **NOT present** | N-A-not-present | No | **PLAN-AHEAD — NOT V1.0-alpha-blocking — owning phase: Phase 3 (Atlas audit-trail)** | Atlas's market-anomaly findings. No 1.2d migration. |
| 17 | `verification_requests` | §4.1 extension (Phase 1.3a) | Yes | N-A-identity (per-user verification queue) | Yes (verified queue is V1.0-alpha) | INTENTIONAL | Verification is identity-state work, upstream of commodity scoping. |
| 18 | `guest_sessions` | §4.1 extension (Phase 1.3a) | Yes | N-A-identity | Yes (anonymous gating for /insights) | INTENTIONAL | — |
| 19 | `auth_bridge_log` | §4.1 extension (Phase 1.3a) | Yes | N-A-identity | Yes (V2 user migration is V1.0-alpha) | INTENTIONAL | — |
| 20 | `chat_sessions` | §4.1 extension (Phase 1.3b) | Yes | FAIL — no commodity_id column | No (Phase 1.10 Zyra-pilot scope) | AMBIGUOUS | Same shape concern as zyra_conversations. Q3 in open-questions. |
| 21 | `news_items` | §4.1 row 12 backing-store | Yes | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` | Yes (V1.0-alpha /insights) | INTENTIONAL | UNIQUE on (source, source_url). |
| 22 | `prices` | §4.1 row 12 backing-store | Yes | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` | Yes (V1.0-alpha /insights) | INTENTIONAL | — |
| 23 | `position_reports` | §4.1 row 11 backing-store | Yes | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` | No (V1.0-beta — Phase 1.6) | INTENTIONAL-DIVERGENCE — V1 carry-over per task spec | UNIQUE on (source, report_date, commodity_id). |
| 24 | `user_roles` | RBAC (§4.1 extension) | Yes | N-A-identity | Yes (RBAC is V1.0-alpha) | INTENTIONAL | RLS fixed in `20260428000002_fix_user_roles_rls`. |
| 25 | `legacy_users` | V2 bridge (§4.1 extension) | Yes | N-A-identity | Yes (V2 user migration is V1.0-alpha) | INTENTIONAL | RLS enabled, no client policies (service_role bypass only). |

---

## §4.1 missing-entity summary

All seven §4.1 entities listed in master plan §4.1 but not present in
the live DB are PLAN-AHEAD findings, **none V1.0-alpha-blocking**:

| Entity | Owning phase (where it will be created) |
|---|---|
| `offers` | V1.0-beta (Phase 1.6/1.7 marketplace) |
| `offer_lines` | V1.0-beta (Phase 1.6/1.7 marketplace) |
| `inquiries` | V1.0-beta (Phase 1.6/1.7 marketplace) |
| `tracked_deals` | Phase 2 (CRM, OPTIONAL per master plan) |
| `communications` | Phase 2 (CRM communications log) |
| `observations` | Phase 3 (Atlas audit-trail / data-quality findings) |
| `exceptions` | Phase 3 (Atlas audit-trail / market-anomaly findings) |

**Zero migrations drafted for any of the seven in this phase.** Verified
by `ls supabase/migrations/ | grep -iE "offers|offer_lines|inquiries|tracked_deals|communications|observations|exceptions"`
returning empty.

---

## Multi-commodity FK PLAN-AHEAD findings (present entities only)

Live snapshot `commodity_id_check[]` was used to confirm `commodity_id`
presence + FK target on each present §4.1 entity. Tables without
`has_commodity_id_column: true AND has_commodity_fk_to_commodities: true`
are PLAN-AHEAD findings; per the task spec rule each is evaluated
V1.0-alpha-blocking case-by-case.

| Entity | commodity_id_column? | commodity_fk_to_commodities? | V1.0-alpha-blocking? | Resolution |
|---|---|---|---|---|
| `companies` | No | No | No (Phase 2 CRM) | INTENTIONAL-DIVERGENCE — identity table, see Q1 |
| `contacts` | No | No | No (Phase 2 CRM) | INTENTIONAL-DIVERGENCE — identity table, see Q1 |
| `relationships` | No | No | No (Phase 2 CRM) | AMBIGUOUS — Q2 |
| `zyra_conversations` | No | No | No (Phase 1.10 pilot) | AMBIGUOUS — Q3 |
| `chat_sessions` | No | No | No (Phase 1.10 pilot) | AMBIGUOUS — Q3 |
| `profiles` | No | No | No (identity) | INTENTIONAL — identity table |
| `user_roles` | No | No | No (identity) | INTENTIONAL — identity table |
| `legacy_users` | No | No | No (identity) | INTENTIONAL — identity bridge |
| `verification_requests` | No | No | No (identity) | INTENTIONAL — per-user state |
| `guest_sessions` | No | No | No (identity) | INTENTIONAL — pre-auth state |
| `auth_bridge_log` | No | No | No (identity) | INTENTIONAL — V2 migration bridge |

**Result:** zero PLAN-AHEAD multi-commodity FK findings are
V1.0-alpha-blocking. Phase 2/3 entities will revisit the FAIL rows
when shipping their owning scope.

---

## 1.10bb-pattern drift (column-level — DECLARED-but-ABSENT)

This is the headline finding the audit exists to surface. The
column-level drift detector parsed every `*.sql` file in
`supabase/migrations/`, built `(table, column)` tuples from each
`CREATE TABLE` and `ALTER TABLE ... ADD COLUMN`, and diffed against the
live snapshot's `columns[]` array.

The findings below are tables/columns the migration files declare but
the live DB does NOT have — the exact failure class Phase 1.10bb
(`subject_matter_hits` silently skipped on `db push`) was the
proximate cause for.

### Whole-table drift (one entry)

| Table | Declaring migration file | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|
| `cockpit_phase_approvals` | `20260508000000_concepts_and_phase_approvals.sql` | No (cockpit scope, not auth/RBAC/queue/insights) | **PLAN-AHEAD — 1.10bb-pattern drift** | Partial-apply: `concepts` from the SAME file IS present in live, but `cockpit_phase_approvals` is NOT. The `schema_migrations` row for `20260508000000` is reported present in 1.2c, so `db push` will not re-apply. Out-of-scope for 1.2d migration drafting; routed to follow-up. |

### Column-level drift (one entry per declared-but-absent column)

| Table | Column | Declaring migration file | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|
| `brain_discussions` | `updated_at` | `20260502250001_brain_discussions.sql` | No (council scope) | PLAN-AHEAD — column drift | Single missing column. Cockpit/council infrastructure, not §4.1. |
| `atlas_conversations` | `tool_calls` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | `20260506000001` was a redefinition / "schema complete" attempt; live DB carries an earlier table shape. |
| `atlas_conversations` | `cost_usd` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same as above. |
| `atlas_snapshots` | `queued` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |
| `atlas_snapshots` | `done` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |
| `atlas_snapshots` | `failed` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |
| `atlas_snapshots` | `trust_mode` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |
| `atlas_snapshots` | `payload` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |
| `atlas_dispatches` | `tool_name` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Live table has `tool` (text); the redefinition file proposed renaming to `tool_name`. Live retains the older shape. |
| `atlas_dispatches` | `args` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Live has `arguments` (jsonb); same renaming gap. |
| `atlas_decisions` | `phase` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same redefinition gap. |
| `atlas_decisions` | `decision` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |
| `atlas_decisions` | `made_by` | `20260506000001_atlas_schema_complete.sql` | No (cockpit) | PLAN-AHEAD — column drift | Same. |

**V1.0-alpha-blocking determination across all 1.10bb-pattern drift
findings: ZERO.** Every drift is in cockpit/council infrastructure
(`atlas_*`, `brain_*`) — none touch auth, RBAC, the verified queue,
the V2 user migration bridge, or the `/insights` read-only surface.
No migrations drafted in 1.2d.

The headline takeaway: the drift-detection mechanism the audit exists
to validate **works against live-DB output** (it correctly surfaces
`cockpit_phase_approvals` as the partial-apply case, plus 13
shape-redefinition columns from the `20260506000001` schema-complete
file). The mechanism is now production-validated for future phases.

---

## DB-AHEAD findings (live DB has, migrations don't declare)

Routed in detail to `.agent/audit/open-questions-2026-05-23.md`.
Headline counts here:

- **6 tables** in live DB with no `CREATE TABLE` in any migration file:
  `atlas_audit_events`, `atlas_concept_links`, `atlas_connections`,
  `atlas_project_connections`, `atlas_queue_operations`, `atlas_user_state`.
  All are atlas-cockpit runtime infrastructure (none are §4.1 domain
  entities). At least `atlas_queue_operations` is known to have shipped
  via MCP `apply_migration` (`phase_1_10bd_queue_pivot_step2`).
- **5 columns** in live DB on tables that ARE declared but the columns
  themselves are not in any migration file:
  - `atlas_dispatches.builder_pause_token`
  - `concepts.parent_folder`
  - `plan_workshop_sessions.metadata`
  - `plan_workshop_sessions.archived_at` (MCP `phase_1_10bd_queue_pivot_step2`)
  - `plan_workshop_sessions.last_whatsapp_ping_at` (MCP `phase_c1_workshop_whatsapp_ping_col`)
- **1 known data-only DB-AHEAD** not surfaced by the column-level
  diff but flagged in spec Context: 8 rows on `atlas_dispatches.status`
  flipped to `legacy_inert` by MCP `phase_1_10be_orphan_archive`. The
  audit captures schema state, not row values; this finding is
  carried forward from the spec into open-questions for traceability.

Three view-bodies (`atlas_workflow_trace`, `v_atlas_health`,
`v_user_graph`) appear in the snapshot's `columns[]` array because
`information_schema.columns` includes views. They ARE declared in
migration files via `CREATE VIEW` (`20260501080000_atlas_workflow_trace_view.sql`,
`20260502170000_verifier_unknown_reason.sql`,
`20260502250005_v_atlas_health.sql`, `20260502000000_relationship_graphs.sql`).
These are INTENTIONAL — not real DB-AHEAD findings. The column-level
drift parser only inspects `CREATE TABLE` / `ALTER TABLE ADD COLUMN`,
so view-bodies surface as false positives in the raw diff. They are
explicitly NOT routed to open-questions.

None of the DB-AHEAD findings are V1.0-alpha-blocking. Routed for
follow-up workshop, no migrations drafted in 1.2d.

---

## V1.0-alpha-blocking PLAN-AHEAD gaps — migration drafting target

Per task spec the V1.0-alpha-blocking subset is:
- Auth (signup/login/OTP)
- RBAC (Tier 1/2/3)
- Verified-user queue
- V2 user migration via `auth_bridge_log`
- Read-only `/insights` surface (`commodities`, `news_items`,
  `market_intelligence`, `prices`)

Cross-checking against the live snapshot:

| Subset member | In live DB? | Expected column shape present? | V1.0-alpha-blocking gap? |
|---|---|---|---|
| `commodities` | Yes | Yes (seeded with almonds) | None |
| `news_items` | Yes | Yes; `commodity_id` FK confirmed | None |
| `market_intelligence` | Yes | Yes; `commodity_id` FK confirmed | None |
| `prices` | Yes | Yes; `commodity_id` FK confirmed | None |
| `profiles` | Yes | Yes (foundation + Phase 1.3a extensions) | None |
| `user_roles` | Yes | Yes (`app_role` enum, RLS fixed) | None |
| `verification_requests` | Yes | Yes (Phase 1.3a structured extensions) | None |
| `auth_bridge_log` | Yes | Yes (Phase 1.3a created) | None |
| `legacy_users` | Yes | Yes | None |
| `guest_sessions` | Yes | Yes | None |

**Result: ZERO V1.0-alpha-blocking PLAN-AHEAD gaps surfaced by the live
snapshot.** No migration files drafted in 1.2d. No
`docs/phase-1.2d-manual-steps.md` written (only produced when migrations
are drafted, per the task spec touchpoint table).

This confirms what 1.2c reported against the same snapshot — the
V1.0-alpha foundation is fully shipped at the schema level. The
drift this audit surfaces is real but outside the V1.0-alpha-blocking
scope.

---

## Summary — what 1.2d surfaced

- 4/4 Snapshot Verification Gate checks PASS against authoritative
  live-DB snapshot (`_meta.is_live_db_output: true`,
  `_meta.generated_at: 2026-05-23T12:39:40+00`).
- 18 of 25 §4.1 entities present in live DB. 7 not-present, all PLAN-AHEAD,
  all explicitly NOT V1.0-alpha-blocking.
- 1.10bb-pattern column-level drift surfaced: `cockpit_phase_approvals`
  whole-table partial-apply (the headline case) + 13 column-level drift
  findings on cockpit/council tables. Zero V1.0-alpha-blocking.
- DB-AHEAD: 6 atlas-cockpit tables + 5 columns in live DB that no
  migration file declares. Routed to open-questions. Includes MCP-applied
  changes from `phase_1_10bd_queue_pivot_step2` and
  `phase_c1_workshop_whatsapp_ping_col`.
- ZERO V1.0-alpha-blocking gaps surfaced. ZERO migrations drafted.

---

## Citations used in this report

- Master plan §4.1 — `.agent/master-plan.md`
- V3-CODING-INSTRUCTIONS rule #3 (multi-commodity FK) — see system prompt + task spec
- `.agent/idea.md` line 20 (V1.0-alpha scope) + line 21 (V1.0-beta scope)
- Live snapshot `_meta` block — `.agent/audit/live-schema-snapshot-2026-05-23.json`
- Phase 1.10bb migration-drift lesson — `.agent/runtime-state.md`
- Task spec out-of-scope list (Phase 2/3 entities + V1/V2 legacy + DB-AHEAD non-migration)
