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

## Q5 — DB-AHEAD findings collection

**Category:** Process — placeholder

**Context.** The task spec asks for DB-AHEAD items in this doc, but DB-AHEAD
items require the live snapshot to be identified. None can be listed in
this pass. Many cockpit/atlas tables (brain_*, atlas_*, designer_runs,
verifier_runs, pd_*, concepts, wizard_sessions) exist in migrations and are
not in §4.1 because they are runtime-agent infrastructure rather than §4.1
data entities — these are not DB-AHEAD findings.

**Recommendation:** When the snapshot lands, the post-snapshot pass will
populate this section with: (a) tables in live DB not in any migration file,
(b) columns in live DB not in any migration's CREATE/ALTER, and (c) RLS
policies in live DB not in any migration. These are the true DB-AHEAD
findings the spec wants flagged.

---

## Q6 — `current_user_tier()` vs `is_team_or_admin()` divergence

**Category:** AMBIGUOUS — visible from migrations alone

**Context.** Two parallel RBAC helper functions exist in migrations:
- `public.has_role(user_id, role)` + `public.is_team_or_admin(user_id)` —
  defined in foundation, used by foundation-era policies.
- `public.current_user_tier()` — referenced in
  `20260501050000_verification_requests.sql` lines 33, 37 ("maxons reads all
  requests" policy). The function definition is not visible in the §4.1
  foundation; if it's not in a later migration, the verification_requests
  RLS policies may be broken (function not found → policy fails → maxons
  can't read the queue).

**Question.** Is `current_user_tier()` defined in a migration I missed, in
a hand-applied SQL pre-foundation, or is it broken?

**Recommendation:** The post-snapshot pass should explicitly check whether
`current_user_tier()` exists in the live DB via `pg_proc`. Add to
`scripts/audit-live-schema.sql` (Q4 follow-up).

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
