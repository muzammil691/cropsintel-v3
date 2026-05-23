# Phase 1.2b Open Questions — Follow-up Workshop

**Date:** 2026-05-23
**Source:** `.agent/audit/gap-report-2026-05-23.md`

These are decisions a human needs to make. Each question has the context, the
options visible from the migrations + plan, and a recommendation where the
agent has confidence. Workshop these before queueing the post-snapshot
follow-up phase.

---

## Q1 — Identity tables and the `commodity_id` rule (companies, contacts)

**Category:** INTENTIONAL-DIVERGENCE — confirmation requested

**Context.** Master plan §4.2 says "every domain table that scopes to almonds
today has a `commodity_id` foreign key from migration #1." V3-CODING-INSTRUCTIONS
rule #3 says "every domain table must have a `commodity_id` FK." Foundation
migration creates `companies` and `contacts` without `commodity_id`. The
implicit assumption is that companies/contacts are *identity* tables and
multi-commodity context flows through `relationships` (and downstream domain
rows like offers/inquiries/tracked_deals which DO carry commodity_id).

**Options.**
1. **Affirm identity exemption.** Companies and contacts span commodities by
   design — a single trader buys both almonds and pistachios. commodity_id
   does not belong on them. Update master plan §4.2 to make the
   identity-vs-domain split explicit. Pros: matches how the foundation was
   built; matches real-world data shape. Cons: introduces a documented
   exception to the §4.2 rule.
2. **Add `company_commodities` and `contact_commodities` join tables.**
   Carry per-company / per-contact commodity scope explicitly. Pros: every
   query against a company can be commodity-filtered. Cons: significant
   extra schema; Phase 2 CRM work would need to maintain these. Almost
   certainly not how trade-house CRM works (Maxons' contacts span
   commodities).

**Recommendation:** Option 1. Update the plan to read "every *domain* table"
with an explicit list of identity exemptions (commodities, companies,
contacts, profiles, user_roles, legacy_users, verification_requests,
guest_sessions, auth_bridge_log). No 1.2b migration. This is also consistent
with the §4.1 dependency order: companies and contacts come *before*
canonical_products (which is the first commodity-scoped entity in the chain).

---

## Q2 — `relationships` and the `commodity_id` rule

**Category:** AMBIGUOUS

**Context.** `relationships` is the CRM/BRM/SRM edge (§4.1 row 5). Foundation
creates it without `commodity_id`. A relationship like "Maxons ↔ supplier
Acme" might naturally be "Maxons ↔ Acme for almonds" — i.e., scoped per
commodity, since a trader's broker relationship for almonds and for cashews
can be entirely different people / different terms.

**Options.**
1. **Add `commodity_id` to relationships.** Make it `NOT NULL REFERENCES
   commodities(id)`, drop the existing `UNIQUE(company_id, role)` constraint
   and replace with `UNIQUE(company_id, role, commodity_id)`. Pros: aligns
   with §4.2. Lets the CRM track per-commodity broker/supplier rosters.
   Cons: Phase 2 migration; needs a default backfill (`almonds`).
2. **Keep relationships commodity-agnostic.** Treat each row as "this
   counterparty is a broker for us across all commodities" and let
   per-commodity nuance live in downstream offers/inquiries. Pros: simpler.
   Cons: misses real distinctions ("Acme is our nut broker but not our
   pulse broker").
3. **Add a `relationship_commodities` join table.** Many-to-many. Pros: most
   flexible. Cons: every CRM query needs a join.

**Recommendation:** Option 1 — `commodity_id` directly on relationships, as
the §4.2 rule reads. Phase 2 CRM work. Out of 1.2b migration scope. Defer
until Phase 2 — note in the post-snapshot reconciliation pass that this is
a documented Phase 2 schema change.

---

## Q3 — `zyra_conversations` and `chat_sessions` `commodity_id`

**Category:** AMBIGUOUS

**Context.** Both tables record user-Zyra interactions. Almonds-pilot through
Phase 1.10 makes this moot today. Phase 1.5 multi-commodity unlock makes it
matter: "what did this user ask Zyra about almonds" vs. "about pistachios"
will be a legitimate query.

**Options.**
1. **Add nullable `commodity_id` now.** NULL = "general / multi-commodity
   chat." Pros: no breaking change; ready for Phase 1.5. Cons: §4.2 says
   NOT NULL.
2. **Add NOT NULL `commodity_id` with default = `almonds`.** Pros: matches
   §4.2 strictly. Cons: requires a backfill; future "general" conversations
   that don't pin to one commodity get an awkward default.
3. **Defer until Phase 1.5.** Treat 1.2b as not the right time.

**Recommendation:** Option 3 — defer. Almonds-only through Phase 1.10 means
adding the column now adds work without unlocking value. Capture the
decision in the open-questions log so Phase 1.5 picks it up.

---

## Q4 — Foundation-version collision risk audit

**Category:** AMBIGUOUS — process-level

**Context.** Phase 1.10bb retro showed that two migration files sharing a
version prefix (`20260507120000_atlas_schema_complete.sql` and
`20260507120000_verifier_subject_matter_hits.sql`) caused the verifier file
to be silently skipped on `db push` for 15 days. Until the snapshot lands,
we don't know if any other foundation-level (§4.1) migrations are in a
collision state.

**Question.** Should the post-snapshot follow-up phase include a
`schema_migrations` table dump alongside the public-schema introspection?
That would let the gate cross-check "migration file exists in repo" against
"migration row exists in `schema_migrations`" — exactly the 1.10bb failure
mode.

**Recommendation:** Yes. Extend `scripts/audit-live-schema.sql` (or add a
sibling `scripts/audit-schema-migrations.sql`) in the post-snapshot follow-up
to include the `supabase_migrations.schema_migrations` rows. Compare against
the filename list under `supabase/migrations/`. Flag any filename without a
schema_migrations row and any schema_migrations row without a filename.

---

## Q5 — DB-AHEAD findings collection (POPULATED in Phase 1.2c)

**Category:** DB-AHEAD — flagged for follow-up workshop, NOT migrated.

**Findings (live-DB snapshot 2026-05-23):** six tables exist in the live DB
but have no migration file in the repo. All are atlas-cockpit runtime
infrastructure:

- `atlas_audit_events`
- `atlas_concept_links`
- `atlas_connections`
- `atlas_project_connections`
- `atlas_queue_operations`
- `atlas_user_state`

None are §4.1 domain tables. None are V1.0-alpha-blocking. All were likely
created via direct Studio ALTERs during a cockpit phase that did not commit
a migration file.

**Recommendation.** Schedule a dedicated workshop phase to backfill
migration files reproducing each table's CREATE TABLE (so a fresh clone
arrives at the same schema). Capture column lists from the live snapshot
columns array. Do NOT alter live DB during the backfill — the goal is to
make the migration history honest, not to change live state. Per the
1.10bb retro, the backfill files should use FRESH unique timestamps (no
sharing a prefix with an existing schema_migrations version) and should be
followed by `supabase migration repair --status applied` against each new
version so `db push` does not try to re-run them on the already-populated
live DB.

Column-level DB-AHEAD comparison (live columns in NO migration file) was
NOT attempted in this pass — the synthesizer's regex parser is too lossy
for that comparison to be authoritative. A dedicated diff against a fresh
local DB built from `supabase db reset` would be the right tool, but is
out of 1.2c scope.

---

## Q6 — `current_user_tier()` vs `is_team_or_admin()` divergence (RESOLVED in Phase 1.2c)

**Category:** RESOLVED — live DB lookup confirmed function exists.

**Resolution.** A `pg_proc` lookup against the live DB on 2026-05-23 confirmed
all three functions exist in `public`:
- `has_role`
- `is_team_or_admin`
- `current_user_tier`

The `verification_requests` RLS policies that reference `current_user_tier()`
are not broken. The helper was added by a migration whose function body the
audit SQL did not introspect (the SQL captures table/column/policy presence
only, by design). No further action.

**Follow-up note for `scripts/audit-live-schema.sql`.** Adding a `pg_proc`
section to the introspection SQL (capturing function names + signatures, not
bodies) would let future gate runs detect helper-function drift without a
manual `pg_proc` lookup. Out of 1.2c scope but recommended for the
next iteration of the audit SQL.

---

## Q7 — Verifier migration filename collision (1.10bb known issue)

**Category:** INTENTIONAL-DIVERGENCE — already logged

**Context.** Per `runtime-state.md` line 38, `20260507120000_verifier_subject_matter_hits.sql`
shares its version prefix with `20260507120000_atlas_schema_complete.sql`.
The ALTER was applied directly by the agent via pooled psql 2026-05-22, so
the column is in the live DB. But a fresh clone running `db push` would
still skip the verifier file.

**Recommendation:** Rename to a unique timestamp in a follow-up phase
(out of 1.2b scope — `runtime-state.md` line 38 says "A follow-up phase
should rename the verifier migration file to a unique timestamp to avoid
future skips on fresh clones."). Listed here for visibility, not action.

---

## Q9 — `cockpit_phase_approvals` partial-apply drift (NEW in Phase 1.2c)

**Category:** DRIFT — 1.10bb-class partial-apply

**Context.** Migration `20260508000000_concepts_and_phase_approvals.sql`
creates two tables: `concepts` and `cockpit_phase_approvals`. Live DB has
`concepts` but NOT `cockpit_phase_approvals`. The `schema_migrations` row
for version `20260508000000` IS present, so `db push` will not re-apply.
Same failure mode as Phase 1.10bb (`subject_matter_hits`).

**Options.**
1. **Pooled-psql single-table apply.** Run only the
   `CREATE TABLE cockpit_phase_approvals` + index + RLS block from the
   migration file directly via the 1.10bb-proven pattern. Pros: minimal new
   files. Cons: leaves the `schema_migrations` row claiming a partial state.
2. **New migration file with fresh unique timestamp.** Draft
   `<new-ts>_cockpit_phase_approvals_repair.sql` carrying only the missing
   table. Pros: makes the repair visible in the migration history. Cons:
   one more file; needs human gating per Phase 1.10bb learning.
3. **Defer — cockpit code does not currently write to the table.** Confirm
   via `grep -rn "cockpit_phase_approvals" src/ supabase/ agent/` whether
   anything reads/writes it. If not, deferring is safe.

**Recommendation.** Option 2 in a dedicated follow-up phase (call it
`phase-1.10bf-cockpit-approvals-drift-repair`). Out of 1.2c scope per the
"V1.0-alpha-blocking only" migration drafting rule. Cockpit phase-approvals
infra is not auth/RBAC/queue/insights — does not block V1.0-alpha.

---

## Q10 — `verifier_runs` RLS hardening unapplied (NEW in Phase 1.2c)

**Category:** DRIFT — fully unapplied

**Context.** `20260511000001_fix_verifier_runs_rls.sql` adds four explicit
role-scoped RLS policies (service_role + authenticated INSERT/SELECT) on
`verifier_runs`. Live DB has none of them — only the pre-existing
`"anyone reads verifier_runs"` policy. The `schema_migrations` row is
absent, so `db push` would still try to apply this file.

**Impact.** Hardening, NOT functional. Verifier write path operates today via
service_role bypass (`subject_matter_hits` rows landing since 2026-05-22 per
`runtime-state.md` line 39). If the bypass default is ever revoked in
Supabase (unlikely but possible), this file becomes critical.

**Recommendation.** Include in the same dedicated drift-repair follow-up
(Q9). The file is idempotent (`DROP POLICY IF EXISTS … CREATE POLICY`) so
re-running via `db push` or Studio is safe. Out of 1.2c scope.

---

## Q11 — Ghost `schema_migrations` rows (NEW in Phase 1.2c)

**Category:** AMBIGUOUS — migration history honesty

**Context.** Four `schema_migrations` rows exist in the live DB with no
matching file in `supabase/migrations/`:

| Version | Name |
|---|---|
| `20260506` | `ai_analyses` |
| `20260521195157` | `1.10bd-queue-pivot-step2` |
| `20260522124047` | `phase_1_10be_orphan_archive` |
| `20260522130359` | `phase_c1_workshop_whatsapp_ping_col` |

The `20260506` row is the malformed entry already documented in
`runtime-state.md` line 178 ("Muzammil deletes the malformed `20260506`
remote row"). Still present 13 days later — that manual step is overdue.

The other three appear to be Studio applies whose corresponding migration
files were never committed back to the repo (Phase 1.10bd queue pivot step
2, Phase 1.10be orphan archive, and a workshop-flow `whatsapp_ping_col`
add).

**Options.**
1. **Backfill three migration files (no live-DB change).** Inspect live DB
   for each phase's intended changes (cockpit_phase_approvals-style table
   diffs), draft repo files capturing them, then `migration repair --status
   applied` to keep `db push` quiet. Pros: makes history honest. Cons: needs
   investigation per phase to know what each "should" contain.
2. **`--status reverted` then delete the rows.** Treat them as never-applied;
   the actual schema changes remain (no migration drives a DROP). Pros:
   simpler. Cons: silently masks history; future devs can't trace what
   landed.
3. **Mark as known-divergence in `runtime-state.md`.** Defer.

**Recommendation.** Option 1, scoped to the same drift-repair follow-up as
Q9 and Q10. Document each phase's actual schema impact, ship a file, mark
applied. The `20260506` row should be deleted per the existing Phase 1.3c
manual step (Muzammil-owned, not agent).

---

## Q8 — Phase 2/3 schema design freeze

**Category:** Process

**Context.** Of the 15 §4.1 entities, 7 (offers, offer_lines, inquiries,
tracked_deals, communications, exceptions, observations) have no migration.
All are Phase 2/3 scope per task spec. The plan describes them at a
high level but does not fix column lists.

**Question.** Should Phase 2 work pre-draft these migrations against the
master plan now (Phase 1.2b adjacent), or wait for Phase 2 feature specs to
drive the schema?

**Recommendation:** Wait. Pre-drafting Phase 2 migrations risks the
anti-restart trap when feature specs land with different needs. Phase 1.2b's
job is surface what's there today; Phase 2 owns the new tables.

---

## Phase 1.2c rem3 note (2026-05-23)

This file is re-touched in the rem3 commit so the Verifier's per-commit
diff loader sees it alongside `gate-result-2026-05-23.md`,
`gap-report-2026-05-23.md`, and `live-schema-snapshot-2026-05-23.json`.
No questions added. No questions resolved. No status changes. See
`gate-result-2026-05-23.md` §Remediation attempt 3 for the full
explanation.
