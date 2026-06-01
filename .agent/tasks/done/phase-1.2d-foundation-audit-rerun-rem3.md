---
priority: 1
remediation: true
remediation-attempt: 3
---
# 1.2d: V3 Foundation Audit — re-run Snapshot Verification Gate against live-DB snapshot

_launch tier: v1.0-alpha_

## Context

Phase 1.2b shipped the audit mechanics (audit SQL, snapshot gate,
gap-report template, manual-steps doc) but ran the gate against a
migration-derived synthesized snapshot — `_meta.is_live_db_output: false`
— because the live-DB Studio run was assigned to Muzammil and rem1
unblocked the gate with a placeholder. Phase 1.2c was supposed to re-run
against the real snapshot once Muzammil's Studio capture landed, but
1.2c died four times on the Verifier's `empty-diff-guard` due to a
title-only spec body. The P1 (`requeueWithGaps` inheritance) and P2
(empty-`filesRequired` pre-flight) fixes are now live; this phase 1.2d
is the same audit re-run with a properly enumerated spec body so it can
actually pass the Verifier gate.

Muzammil's Studio capture is on disk and authoritative:
`.agent/audit/live-schema-snapshot-2026-05-23.json` carries
`_meta.is_live_db_output: true`, `captured_via: "Supabase pooler"`,
`generated_at: 2026-05-23T12:39:40+00`. Zero migration files have been
added under `supabase/migrations/` since 2026-05-23, so the snapshot is
the correct ground truth for this audit's drift-detection contract.

The first known finding the live snapshot surfaces is **seven §4.1
entities listed in master plan §4.1 but not present in the live DB**:
`offers`, `offer_lines`, `inquiries`, `tracked_deals`, `communications`,
`observations`, `exceptions`. Per `idea.md` line 21 and the 1.2b "Out of
scope" block, all seven map to V1.0-beta or Phase 2/3 scope. **None are
V1.0-alpha-blocking.** They get categorized as PLAN-AHEAD findings; NO
migrations are drafted for them in this phase.

A second class of findings is anticipated: **MCP-applied migrations
with no files on disk.** Several schema changes have shipped via
Supabase MCP `apply_migration` rather than `db push` (examples:
`phase_c1_workshop_whatsapp_ping_col` adding
`plan_workshop_sessions.last_whatsapp_ping_at`,
`phase_1_10bd_queue_pivot_step2` adding `atlas_queue_operations` and
`plan_workshop_sessions.archived_at`, `phase_1_10be_orphan_archive`
flipping 8 `atlas_dispatches` rows to `legacy_inert`, and possibly
others). These changes are recorded in the DB's own
`supabase_migrations.schema_migrations` table but have no corresponding
`.sql` file under `supabase/migrations/`. The live snapshot reflects
their effects in `columns[]` and `tables[]`. **The audit MUST route
these to DB-AHEAD findings in `.agent/audit/open-questions-2026-05-23.md`
for follow-up. Do NOT draft migrations for them. Do NOT treat them as
failures — discovering them IS the audit working correctly.**

## In scope

**Pre-condition (must hold before Builder claims this spec):**
- `.agent/audit/live-schema-snapshot-2026-05-23.json` exists AND its
  top-level `_meta.is_live_db_output` is `true`. (Builder reads the
  file's `_meta` block at start; if `is_live_db_output: false` or the
  file is missing, FAIL pre-flight with a gap pointing at
  `docs/phase-1.2b-manual-steps.md` Step 1.)
- The four output filenames keep the `-2026-05-23` date so they match
  the snapshot they're derived from. Do NOT introduce a different date
  unless Muzammil re-runs the Studio capture; in that case, this spec
  must be re-issued with a matching date suffix.

**Steps to execute (mirrors 1.2b steps 4 + 5, applied to live-DB input):**

1. **Re-run Snapshot Verification Gate (1.2b step 4):**
   - Snapshot covers expected ~80 tables (`table_count` field >= 75 and
     <= 90 — tightened from 1.2b's wider range to detect a ≥10-table
     regression in either direction; current live count is exactly 80).
   - Every entity in master plan §4.1 appears in
     `section_4_1_entities[]` (length === 25, matching the hard-coded
     VALUES list in `scripts/audit-live-schema.sql`).
   - RLS policy enumeration succeeded for every table with
     `rls_enabled[].enabled === true` (no silent permission failures).
   - `commodity_id_check[]` returned non-empty (FK check ran).
   - **If ANY check fails:** overwrite
     `.agent/audit/snapshot-incomplete-2026-05-23.md` with the failure
     reason. STOP. Do not proceed to step 2.
   - **If ALL checks pass:** proceed.

2. **Regenerate gap-report (1.2b step 5):**
   - Overwrite `.agent/audit/gap-report-2026-05-23.md` (the existing
     file was generated against the synthesized snapshot — it is
     superseded by this run).
   - For every §4.1 entity AND every Phase 1.3a/b extension:
     categorize PLAN-AHEAD / DB-AHEAD / INTENTIONAL-DIVERGENCE /
     AMBIGUOUS per the 1.2b categorization rules.
   - For the 7 known missing entities (`offers`, `offer_lines`,
     `inquiries`, `tracked_deals`, `communications`, `observations`,
     `exceptions`): **categorize PLAN-AHEAD, mark NOT V1.0-alpha-
     blocking, cite the owning phase** (V1.0-beta or Phase 2/3) per
     the 1.2b "Out of scope" block. DO NOT draft migrations for these.
   - For every PRESENT §4.1 entity, run the multi-commodity FK check
     using the `commodity_id_check[]` array from the live snapshot. Any
     domain table without `has_commodity_id_column: true AND
     has_commodity_fk_to_commodities: true` is a PLAN-AHEAD finding;
     evaluate V1.0-alpha-blocking case-by-case.
   - **2a. Column-level drift detection (the 1.10bb pattern):** Parse
     all `*.sql` files in `supabase/migrations/`. For each
     `CREATE TABLE ... (column ...)` and each
     `ALTER TABLE ... ADD COLUMN`, build a set of `(table, column)`
     tuples that the migration files declare. Diff this set against
     the `(table, column)` tuples in the live snapshot's `columns[]`
     array.
     - Tuples DECLARED-but-ABSENT (migration says yes, snapshot says
       no): PLAN-AHEAD column-drift finding. If any matches the
       1.10bb pattern (migration file silently skipped on `db push`
       due to timestamp collision or merge-conflict resolution),
       surface it loudly under a dedicated **"1.10bb-pattern drift"**
       heading in the gap-report — that is the exact class of failure
       this audit exists to catch.
     - Tuples PRESENT-but-UNDECLARED (snapshot says yes, migration
       files say no): DB-AHEAD column-drift finding. Route to
       `.agent/audit/open-questions-2026-05-23.md`. Examples
       anticipated: `plan_workshop_sessions.last_whatsapp_ping_at`,
       `plan_workshop_sessions.archived_at`, `atlas_queue_operations`
       (entire table), and any `legacy_inert` rows on
       `atlas_dispatches.status`. Do NOT draft migrations for these.

3. **Regenerate open-questions (1.2b step 5 continued):**
   - Overwrite `.agent/audit/open-questions-2026-05-23.md`.
   - DB-AHEAD entries (live DB has tables/columns the migration files
     don't declare) go here for follow-up workshop. These include:
     - Cockpit `atlas_*` infrastructure tables (likely INTENTIONAL-
       DIVERGENCE — flag with citation to runtime-state.md or the
       relevant follow-up).
     - MCP-applied migrations with no files on disk (see Context
       above). Cite the migration name from
       `supabase_migrations.schema_migrations` if known.
     - Any other live-DB tables/columns the migration files don't
       declare.
   - AMBIGUOUS entries (divergence with no clear cause) go here as
     highest-priority follow-up items.

4. **Update gate-result-2026-05-23.md:**
   - Overwrite with a new "Live-snapshot run under 1.2d" section
     dated today (UTC). NOTE: only the gate-result's internal run-date
     line uses today's date. All OUTPUT FILENAMES keep the
     `-2026-05-23` suffix to match the snapshot they derive from. Do
     NOT rename any output file to a different date.
   - Set status to `PASS (against live DB)` (or `FAIL — see
     snapshot-incomplete-2026-05-23.md` if step 1 failed).
   - Cite the snapshot's `_meta.generated_at` field
     (`2026-05-23T12:39:40+00`) as evidence the live-DB output was the
     input.

## Migration drafting scope (NARROW — V1.0-alpha-blocking only)

Same rules as 1.2b. A gap is V1.0-alpha-blocking iff it prevents
shipping:
- Auth (signup/login/OTP)
- RBAC (Tier 1/2/3)
- Verified-user queue
- V2 user migration via `auth_bridge_log`
- The read-only `/insights` surface (`commodities`, `news_items`,
  `market_intelligence`, `prices`)

**The 7 missing entities listed in Context are NOT V1.0-alpha-blocking.**
No migrations drafted for them. They remain PLAN-AHEAD findings in
the gap-report, deferred to their owning phase. The Builder MUST NOT
draft a migration file for any of:
- `offers`, `offer_lines`, `inquiries` (V1.0-beta — Phase 1.6/1.7 scope)
- `tracked_deals` (Phase 2 CRM scope)
- `communications` (Phase 2 scope)
- `observations`, `exceptions` (Phase 3 audit-trail scope)

**MCP-applied DB-AHEAD findings are NOT V1.0-alpha-blocking either.**
Route to open-questions, no migrations drafted, no failures emitted.

If the live-DB snapshot surfaces a previously-undetected V1.0-alpha-
blocking gap (e.g., a column on `profiles` declared in a 1.3a
migration but absent from the live DB), THAT one gets a drafted
migration per the 1.2b template, filed under
`supabase/migrations/<unique-timestamp>_<descriptor>.sql`, NOT applied
(human-gated Studio apply per 1.10bb learning — `supabase db push`
forbidden).

## Out of scope (deferred — same list as 1.2b)

- Migrating any Phase 2/3 entity (`tracked_deals`, `positions`,
  `communications`, `observations`, `exceptions`, `offers`,
  `offer_lines`, `inquiries`). Audited for visibility + multi-
  commodity FK presence only.
- Drafting migration files retroactively for MCP-applied changes.
  These are DB-AHEAD, surfaced for follow-up, not back-filled in
  this phase.
- Orphaned V1/V2 table cleanup: identify only, do NOT drop.
- Plan updates from DB-AHEAD findings: open-questions doc only; no
  plan edits from this phase.
- Applying any drafted migration: human-gated via Supabase Studio.
- Granting Builder direct prod DB read access: still rejected.

## Pre-flight checks (must pass before claiming the spec)

- `.agent/audit/live-schema-snapshot-2026-05-23.json` exists and is
  the live-DB output (the file's top-level `_meta.is_live_db_output`
  is `true`).
- 7/7 Railway services healthy (Atlas, Builder, Verifier, Designer,
  Adela, Council, Memory). The Verifier external URL 404 from
  follow-up E is acceptable — the Verifier responds via internal
  Railway routing; this audit's gate is Verifier-internal.
- `scripts/audit-live-schema.sql` unchanged from 1.2b (this spec
  assumes the same introspection contract).

## Acceptance criteria

1. `.agent/audit/gap-report-2026-05-23.md` overwritten with content
   derived from the live snapshot. The file's content includes a
   header line stating it was regenerated from live-DB output and
   citing the snapshot's `_meta.generated_at` field.
2. All 7 known-missing §4.1 entities (`offers`, `offer_lines`,
   `inquiries`, `tracked_deals`, `communications`, `observations`,
   `exceptions`) appear in the gap-report categorized as PLAN-AHEAD,
   explicitly labeled "NOT V1.0-alpha-blocking — owning phase: <phase>"
   for each.
3. NO migration files exist in `supabase/migrations/` named after any
   of the 7 entities (verified via `ls supabase/migrations/ | grep -iE
   "offers|offer_lines|inquiries|tracked_deals|communications|observations|exceptions"`
   returning empty).
4. `.agent/audit/open-questions-2026-05-23.md` overwritten with the
   live-snapshot-derived DB-AHEAD + AMBIGUOUS findings. At minimum
   includes entries for the MCP-applied migrations enumerated in
   Context (`phase_c1_workshop_whatsapp_ping_col`,
   `phase_1_10bd_queue_pivot_step2`, `phase_1_10be_orphan_archive`)
   plus any other DB-AHEAD findings the column-drift pass surfaces.
5. `.agent/audit/gate-result-2026-05-23.md` overwritten with status
   `PASS (against live DB)` and the live snapshot's
   `_meta.generated_at` timestamp cited as evidence.
6. If any V1.0-alpha-blocking gap is found (other than the deferred 7
   and the routed DB-AHEAD findings), ONE migration file per gap
   drafted under `supabase/migrations/` with a timestamp **strictly
   greater than** max(existing migration timestamp). Builder must run
   `ls supabase/migrations/ | sort | tail -1` to identify the current
   max, and any newly-drafted migration's timestamp prefix must sort
   strictly after it. This prevents the 1.10bb-pattern collision the
   audit exists to detect. Migration drafted but NOT applied.
   `docs/phase-1.2d-manual-steps.md` written with inline SQL +
   per-step verification SQL per the 1.2b template.
7. `.agent/runtime-state.md` last-updated line bumped with a one-
   sentence summary of what 1.2d surfaced.
8. No code is modified by this phase (audit writes markdown +
   optional migration draft only), so no test regression is expected.
   The Verifier should gate this spec on the audit artifacts (AC#1–7)
   being correctly produced, NOT on running the verifier code test
   suite. If the Verifier's diff-check sees only `.agent/audit/*.md` +
   `.agent/runtime-state.md` writes (and optionally one
   `supabase/migrations/` draft), that is the expected and complete
   diff.

## Verification (Builder self-check before declaring complete)

- `grep -c "PLAN-AHEAD" .agent/audit/gap-report-2026-05-23.md`
  returns ≥ 7 (one per missing entity, possibly more if the live
  snapshot surfaces column-level drift).
- `grep -c "NOT V1.0-alpha-blocking" .agent/audit/gap-report-2026-05-23.md`
  returns ≥ 7.
- `grep -c "DB-AHEAD" .agent/audit/open-questions-2026-05-23.md`
  returns ≥ 3 (the three MCP-applied migrations enumerated in Context).
- `python3 -c "import json; d=json.load(open('.agent/audit/live-schema-snapshot-2026-05-23.json')); assert d.get('_meta', {}).get('is_live_db_output') is True"`
  exits 0 (sanity gate the Builder runs once at start).

## Estimated effort

~30 min Builder time. This is a re-run of already-shipped logic against
a new input file; no new code paths.

## Why this phase, why now

- 1.2b's gate "passed" against synthesized data. Drift detection (the
  actual product) wasn't validated against live DB.
- 1.2c died 4× on the empty-diff-guard before the P1/P2 fixes shipped.
  1.2d is 1.2c re-run with a properly enumerated spec body.
- The 1.10bb migration drift (`subject_matter_hits` silently skipped
  on `db push` for 15 days) was the proximate driver for the audit's
  existence. Until this spec runs against the live DB, the drift-
  detection mechanism is untested in production.
- The MCP-applied migrations (Context) are themselves a class of drift
  this audit was designed to surface. 1.2d should produce a list of
  them in open-questions so the operator can decide whether to
  retroactively author migration files for them.

## Touchpoint files (Builder will read or write)

| Action | Path |
|---|---|
| READ | `.agent/audit/live-schema-snapshot-2026-05-23.json` (live DB, captured 2026-05-23) |
| READ | `.agent/master-plan.md` (§4.1 + phase scope) |
| READ | `.agent/idea.md` (V1.0-alpha scope) |
| READ | `.agent/runtime-state.md` (phase status + known issues) |
| READ | `supabase/migrations/*.sql` (column-drift Layer 2a parse target) |
| READ | `scripts/audit-live-schema.sql` (introspection contract reference) |
| WRITE (overwrite) | `.agent/audit/gap-report-2026-05-23.md` |
| WRITE (overwrite) | `.agent/audit/open-questions-2026-05-23.md` |
| WRITE (overwrite) | `.agent/audit/gate-result-2026-05-23.md` |
| WRITE (overwrite on fail) | `.agent/audit/snapshot-incomplete-2026-05-23.md` |
| WRITE (only if V1.0-alpha-blocking gap found) | `supabase/migrations/<unique-strictly-greater-timestamp>_<descriptor>.sql` |
| WRITE (only if step above produced files) | `docs/phase-1.2d-manual-steps.md` |
| WRITE (always) | `.agent/runtime-state.md` last-updated bump |

## Prior failure — gaps to address (attempt 1)

The previous run of `phase-1.2d-foundation-audit-rerun` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: docs/phase-1.2d-manual-steps.md exists
- Actual: docs/phase-1.2d-manual-steps.md is missing
- Remediation: Create docs/phase-1.2d-manual-steps.md per task spec

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-1.2d-foundation-audit-rerun` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: docs/phase-1.2d-manual-steps.md exists
- Actual: docs/phase-1.2d-manual-steps.md is missing
- Remediation: Create docs/phase-1.2d-manual-steps.md per task spec

## Prior failure — gaps to address (attempt 3)

The previous run of `phase-1.2d-foundation-audit-rerun` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: docs/phase-1.2d-manual-steps.md exists
- Actual: docs/phase-1.2d-manual-steps.md is missing
- Remediation: Create docs/phase-1.2d-manual-steps.md per task spec

