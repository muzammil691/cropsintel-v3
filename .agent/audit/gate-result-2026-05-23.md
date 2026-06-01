# Snapshot Verification Gate — Result

**Snapshot capture date:** 2026-05-23
**Snapshot input:** `.agent/audit/live-schema-snapshot-2026-05-23.json`
  (`_meta.is_live_db_output: true`,
  `_meta.captured_via: "aws-1-ap-southeast-1.pooler.supabase.com:5432 (Supabase pooler)"`,
  `_meta.generated_at: 2026-05-23T12:39:40.24879+00:00`)
**Status:** `PASS (against live DB)`

---

## Live-snapshot run under 1.2d

**Run date (UTC):** 2026-06-01.
**Phase:** 1.2d — Foundation audit gate re-run against authoritative
live-DB snapshot, with a properly enumerated spec body so the Verifier
gate (`empty-diff-guard`) can pass (1.2c's title-only spec body
prevented this; the P1 `requeueWithGaps` inheritance + P2 empty-
`filesRequired` pre-flight fixes are now in place).

Only the run-date line uses today's date. The four output filenames
keep the `-2026-05-23` date because they derive from the snapshot
captured on that date. Zero migration files have been added under
`supabase/migrations/` since 2026-05-23, so the snapshot remains
ground truth.

### Gate checks against live snapshot — all four PASS

| # | Check | Threshold | Observed (live) | Status |
|---|---|---|---|---|
| 1 | Snapshot covers expected ~80 tables | `table_count` between 75 and 90 (tightened from 1.2b's 50–120 range to detect a ≥10-table regression in either direction) | 80 | PASS |
| 2 | Every §4.1 entity appears in `section_4_1_entities[]` | length === 25 | 25 (18 present, 7 not) | PASS |
| 3 | RLS policy enumeration succeeded for every table with RLS on | every `rls_enabled[].enabled === true` (no silent permission failures) | 80/80 rows have `enabled: true`; 155 policies enumerated across 78 tables (2 RLS-on with zero client policies are service_role-only by intent) | PASS |
| 4 | `commodity_id_check[]` returned non-empty (FK check ran) | non-empty | 80/80 rows | PASS |

All four checks PASS. **The Snapshot Verification Gate verdict against
authoritative live-DB output is PASS.**

Evidence the input was live-DB output (the 1.2b "synthesized snapshot"
caveat does not apply to this run): the snapshot's `_meta` block
carries `is_live_db_output: true` and
`generated_at: 2026-05-23T12:39:40.24879+00:00`, captured via the
Supabase pooler (`aws-1-ap-southeast-1.pooler.supabase.com:5432`).
Sanity check `node -e "const d=require('./.agent/audit/live-schema-snapshot-2026-05-23.json'); if(d._meta.is_live_db_output!==true) throw 'fail';"`
exits 0.

### What 1.2d surfaced (full detail in gap-report-2026-05-23.md)

- **18 of 25 §4.1 entities present** in live DB. 7 not-present
  (`offers`, `offer_lines`, `inquiries`, `tracked_deals`,
  `communications`, `observations`, `exceptions`); all PLAN-AHEAD, all
  explicitly NOT V1.0-alpha-blocking, all deferred to their owning
  phase (V1.0-beta or Phase 2/3).
- **1.10bb-pattern column-level drift surfaced:**
  `cockpit_phase_approvals` whole-table partial-apply (the headline
  case: `concepts` from the same migration file IS live, but
  `cockpit_phase_approvals` is NOT, with the `schema_migrations` row
  reported present in 1.2c so `db push` will not re-apply). Plus 13
  column-level drift findings on cockpit/council tables (atlas_*,
  brain_*) from the `20260506000001_atlas_schema_complete.sql`
  redefinition file. **Zero V1.0-alpha-blocking.**
- **DB-AHEAD findings (routed to open-questions):**
  - 6 atlas-cockpit tables in live DB with no `CREATE TABLE` in any
    migration file (`atlas_audit_events`, `atlas_concept_links`,
    `atlas_connections`, `atlas_project_connections`,
    `atlas_queue_operations`, `atlas_user_state`).
  - 5 columns in live DB on declared tables that no migration file
    declares (`atlas_dispatches.builder_pause_token`,
    `concepts.parent_folder`, `plan_workshop_sessions.metadata`,
    `plan_workshop_sessions.archived_at`,
    `plan_workshop_sessions.last_whatsapp_ping_at`).
  - 3 MCP `apply_migration` entries cited in the spec Context block
    captured in `open-questions-2026-05-23.md` Q11:
    `phase_c1_workshop_whatsapp_ping_col`, `phase_1_10bd_queue_pivot_step2`,
    `phase_1_10be_orphan_archive` (the last is data-only — 8 `atlas_dispatches`
    rows flipped to `legacy_inert`; not surfaced by the column-level
    diff because the audit captures schema not row values).
- **ZERO V1.0-alpha-blocking gaps surfaced.** Every V1.0-alpha-blocking
  subset table (`commodities`, `news_items`, `market_intelligence`,
  `prices`, `profiles`, `user_roles`, `verification_requests`,
  `auth_bridge_log`, `legacy_users`, `guest_sessions`) is present in
  the live DB with the expected column shape.

### Migrations drafted in 1.2d

**Zero.** Per the spec's NARROW migration-drafting scope rule
(V1.0-alpha-blocking only), every drift finding routed to
follow-up. No new migration files written, no
`docs/phase-1.2d-manual-steps.md` written (only produced when
migrations are drafted, per the task spec touchpoint table).

### The headline win — drift-detection mechanism is production-validated

The 1.10bb migration drift (`subject_matter_hits` silently skipped on
`db push` for 15 days) was the proximate driver for this audit's
existence. Until 1.2d, the drift-detection mechanism had never been
exercised against live-DB output. With this run:
- The column-level drift detector correctly surfaces
  `cockpit_phase_approvals` as the partial-apply case (declared in
  `20260508000000`, present in `schema_migrations`, absent in DB).
- The detector correctly surfaces the
  `20260506000001_atlas_schema_complete.sql` redefinition gap (13
  columns declared but not in live).
- The detector correctly surfaces 5 MCP-applied columns + 6 MCP-applied
  tables as DB-AHEAD.

**The mechanism works.** Future phases can rely on the audit to catch
the next 1.10bb-class regression before it becomes a 15-day silent
drift.

### Artifacts in this pass

- `.agent/audit/live-schema-snapshot-2026-05-23.json` — unchanged from
  1.2c (this is the same authoritative live-DB snapshot;
  `_meta.is_live_db_output: true`).
- `.agent/audit/gate-result-2026-05-23.md` — this file. Overwritten with
  the 1.2d Live-snapshot run section.
- `.agent/audit/gap-report-2026-05-23.md` — overwritten with the live-
  snapshot-derived findings (replaces the 1.2b/1.2c content).
- `.agent/audit/open-questions-2026-05-23.md` — overwritten with the
  live-snapshot-derived DB-AHEAD + AMBIGUOUS findings.
- `.agent/runtime-state.md` — last-updated line bumped with a one-
  sentence 1.2d summary.

No new migration files written. No `.sql` was executed against the
live DB in this pass (read-only contract).
