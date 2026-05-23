# Phase 1.2b Gap Report — V3 Foundation vs. Master Plan §4.1

**Date:** 2026-05-23
**Source-of-truth refs:**
- Master plan §4.1 (15 core entities) — `.agent/master-plan.md` lines 286–355
- V1.0-alpha scope — `.agent/idea.md` line 20 ("auth + RBAC + verified queue + V2 user migration. Single product (almonds). Read-only insights at /insights.")
- V1.0-beta scope — `.agent/idea.md` line 21
- Phase 1.10bb migration-drift lesson — `.agent/runtime-state.md` lines 36–39

---

## ⚠ Caveat — what this report is and is not

This report compares **master plan §4.1 against committed `supabase/migrations/`
files**. It does **not** yet reconcile against the live DB schema.

The Snapshot Verification Gate is in `DEFERRED` state pending Muzammil's manual
Studio run of `scripts/audit-live-schema.sql` (see
`gate-result-2026-05-23.md`). When the snapshot lands, this report will be
re-issued with a "Live-DB" column populated and an explicit Migration-vs-Live
divergence column — that is where Phase 1.10bb-style drift surfaces (migration
file exists, but `schema_migrations` row was claimed by a colliding version
and the file was silently skipped on `db push`).

For now: the "Migration status" column reflects what the migrations *say*
should be in the DB; the "Live status" column is `UNKNOWN-PENDING-SNAPSHOT`.

---

## Categorization

- **PLAN-AHEAD** — plan describes a table/column missing from live DB.
  - V1.0-alpha-blocking → draft migration (in scope for 1.2b).
  - Phase 2/3 → report only (out of scope per task spec).
- **DB-AHEAD** — live DB has a table/column the plan doesn't mention. Flag
  for follow-up workshop. Do NOT migrate, do NOT update plan.
- **INTENTIONAL-DIVERGENCE** — divergence documented in follow-ups,
  runtime-state notes, V1/V2 legacy carry-over per framing. List with
  citation.
- **AMBIGUOUS** — divergence with no clear cause. Highest attention. Full
  context to `open-questions-2026-05-23.md`.

---

## §4.1 entities — one row per entity

Multi-commodity FK column semantics:
- **PASS** — `commodity_id uuid NOT NULL REFERENCES commodities(id)` is on the table.
- **FAIL** — the table exists but the column is missing or nullable or wrong target.
- **N-A-identity** — the table IS commodities, OR is a user/auth identity table where multi-commodity FK does not apply (per §4.2 the rule is "every domain table" — auth/identity tables are upstream of domains).
- **N-A-not-present** — table not yet created in migrations.

| # | Entity | Master plan ref | Migration status | Multi-commodity FK | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `commodities` | §4.1 row 1, §4.2 | Present — `20260428000001_v3_foundation` lines 83–108. Seeded with `almonds`. | N-A-identity | Yes (foundation) | INTENTIONAL — table is the multi-commodity master itself | — |
| 2 | `companies` | §4.1 row 2 | Present — foundation lines 113–158. Includes `verification_status`, `company_type`. | FAIL — no commodity_id (companies span commodities by design) | No (Phase 2 CRM) | INTENTIONAL-DIVERGENCE | A `companies × commodities` join table is the natural §4.2 expression (per V3-CODING-INSTRUCTIONS rule #3 "every query that scopes to almonds must scope through that FK"). Identity-bearing tables (companies, contacts, profiles) carry commodity context via `relationships` and downstream domain rows, not directly. Flagged for open-questions confirmation. |
| 3 | `contacts` | §4.1 row 3 | Present — foundation lines 163–190. | FAIL — no commodity_id (people span commodities) | No (Phase 2 CRM) | INTENTIONAL-DIVERGENCE | Same reasoning as `companies`. Per §4.2 contacts join via companies → relationships → commodity-scoped domain rows. Flagged for open-questions confirmation. |
| 4 | `canonical_products` | §4.1 row 4 | Present — foundation lines 195–246. Seeded with 9 almond varieties. | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` line 199. | No (foundation, already shipped) | INTENTIONAL | — |
| 5 | `relationships` | §4.1 row 5 | Present — foundation lines 327–353. Includes `role` enum (crm_customer/brm_broker/srm_supplier). | FAIL — no commodity_id | No (Phase 2 CRM) | AMBIGUOUS | §4.2 says "every domain table" has commodity_id. relationships IS a domain table (CRM/BRM/SRM edges), not identity. Either (a) the foundation missed this, or (b) the plan intends a `relationship × commodity` join. Either way it does NOT block V1.0-alpha. Flagged AMBIGUOUS → `open-questions-2026-05-23.md`. |
| 6 | `profiles` | §4.1 row 6 | Present — foundation lines 253–298, extended in `20260509100000_phase_1_3a_auth_foundation` lines 19–39 with verification_state, geography_*, business_type, etc. | N-A-identity | Yes (auth foundation) | INTENTIONAL | Profiles is the auth identity table. Multi-commodity context lives in the user's relationships → company → commodity-scoped rows. |
| 7 | `offers` | §4.1 row 7 | **Not present** — no migration file creates `public.offers`. | N-A-not-present | No (Phase 2) | PLAN-AHEAD — report only | Phase 2 CRM scope per task spec out-of-scope list. No migration drafted in 1.2b. |
| 8 | `offer_lines` | §4.1 row 8 | **Not present** | N-A-not-present | No (Phase 2) | PLAN-AHEAD — report only | Same as offers. Should FK to canonical_products + offers when drafted. |
| 9 | `inquiries` | §4.1 row 9 | **Not present** | N-A-not-present | No (Phase 2) | PLAN-AHEAD — report only | Phase 2 scope. |
| 10 | `tracked_deals` | §4.1 row 10 | **Not present** | N-A-not-present | No (Phase 2 optional) | PLAN-AHEAD — report only | Plan marks tracked_deals as OPTIONAL (§4.1 row 10 parenthetical). Phase 2 scope. |
| 11 | `positions` | §4.1 row 11 | Present — `20260501060000_adela_tables` lines 65–99. | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` line 67. | No (Phase 1.6 Adela / V1.0-beta) | INTENTIONAL — early ship for Adela | Plan says Model B subscribers log positions voluntarily (§4.1 row 11). The Adela scraper writes Strata positions to this table; user-logged positions would re-use the same table with a `source` discriminator. |
| 12 | `market_intelligence` | §4.1 row 12 | Present — foundation lines 364–406. | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` line 366. | Yes (V1.0-alpha /insights surface — idea.md line 20) | INTENTIONAL | Backing store for the read-only /insights page per V1.0-alpha. |
| 13 | `zyra_conversations` | §4.1 row 13 | Present — foundation lines 410–442. | FAIL — no commodity_id | No (Zyra is single-commodity-pilot in Phase 1.10) | AMBIGUOUS | Plan §4.2 says every domain table carries commodity_id. zyra_conversations IS a domain table (user-Zyra interactions). The almonds-pilot makes this temporarily moot, but multi-commodity Phase 1.5 will require it. Flagged AMBIGUOUS → open-questions. |
| 14 | `communications` | §4.1 row 14 | **Not present** | N-A-not-present | No (Phase 2 CRM) | PLAN-AHEAD — report only | "Every touch point: in-app, WhatsApp, voice, email" (§4.1 row 14). Phase 2 scope. |
| 15 | `exceptions / observations` | §4.1 row 15 | **Not present** — no migration creates `public.exceptions` or `public.observations`. (Note: `scope_violations` from foundation lines 498–520 is a different concern — Scope Guardian writes, not data-quality observations.) | N-A-not-present | No (Phase 3 Atlas) | PLAN-AHEAD — report only | Atlas's data-quality + market-anomaly findings. Phase 3 scope (per master plan agent table row R3 + R8). |

---

## Phase 1.3a/b extensions — one row per

| # | Entity | Migration status | Multi-commodity FK | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|---|
| 16 | `verification_requests` | Present — created in `20260501050000_verification_requests` lines 3–19, extended in `20260509100000_phase_1_3a_auth_foundation` lines 47–69 with structured background-check + multi-reviewer assignment. | N-A-identity (per-user verification queue, not a commodity-scoped artifact) | Yes (verified queue is V1.0-alpha) | INTENTIONAL | Verification is identity-state work, upstream of commodity scoping. |
| 17 | `guest_sessions` | Present — `20260509100000_phase_1_3a_auth_foundation` lines 125–151. | N-A-identity | Yes (anonymous gating for /insights) | INTENTIONAL | — |
| 18 | `auth_bridge_log` | Present — `20260509100000_phase_1_3a_auth_foundation` lines 156–187. | N-A-identity | Yes (V2 user migration is V1.0-alpha) | INTENTIONAL | — |
| 19 | `chat_sessions` | Present — `20260509110000_phase_1_3b_chat_sessions`. | FAIL — no commodity_id | No (Phase 1.10 Zyra-pilot scope) | AMBIGUOUS | Same shape concern as zyra_conversations. Flagged → open-questions. |

---

## V1.0-alpha read-only `/insights` surface — one row per

| # | Entity | Migration status | Multi-commodity FK | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|---|
| 20 | `news_items` | Present — `20260501060000_adela_tables` lines 105–138. UNIQUE on (source, source_url). | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` line 107. | Yes (idea.md line 20: read-only /insights) | INTENTIONAL | — |
| 21 | `prices` | Present — `20260501060000_adela_tables` lines 22–59. | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` line 24. | Yes (idea.md line 20: read-only /insights) | INTENTIONAL | — |

---

## V1.0-beta scope — one row per (out of 1.2b migration scope per task spec)

| # | Entity | Migration status | Multi-commodity FK | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|---|
| 22 | `position_reports` | Present — `20260429100000_adela_foundation` lines 7–38. UNIQUE on (source, report_date, commodity_id). | PASS — `commodity_id uuid NOT NULL REFERENCES commodities(id)` line 9. | No (V1.0-beta — idea.md line 21 / runtime-state.md §Next up Phase 1.6) | INTENTIONAL-DIVERGENCE — V1 carry-over per task spec out-of-scope rules ("If present → INTENTIONAL-DIVERGENCE, V1 carry-over, identify-only"). | — |

---

## RBAC + legacy bridge — one row per

| # | Entity | Migration status | Multi-commodity FK | V1.0-alpha-blocking? | Category | Notes |
|---|---|---|---|---|---|---|
| 23 | `user_roles` | Present — foundation lines 30–39. Has `app_role` enum (auth/team/admin). RLS fixed in `20260428000002_fix_user_roles_rls`. | N-A-identity | Yes (RBAC is V1.0-alpha) | INTENTIONAL | — |
| 24 | `legacy_users` | Present — `20260430200000_legacy_users` lines 9–35. | N-A-identity (V1/V2 user snapshot for auth_bridge) | Yes (V2 user migration is V1.0-alpha) | INTENTIONAL | RLS enabled with no client policies (service_role bypass only). |

---

## Multi-commodity FK summary

Per §4.2 the rule is "every domain table that scopes to almonds today has a
`commodity_id` foreign key from migration #1."

| Outcome | Entities |
|---|---|
| PASS | canonical_products, market_intelligence, positions, news_items, prices, position_reports |
| FAIL — needs review | companies, contacts, relationships, zyra_conversations, chat_sessions |
| N-A-identity | commodities, profiles, user_roles, legacy_users, verification_requests, guest_sessions, auth_bridge_log |
| N-A-not-present | offers, offer_lines, inquiries, tracked_deals, communications, exceptions, observations |

Of the FAIL row:
- **companies / contacts** — argued INTENTIONAL by identity-vs-domain
  framing. Open-questions confirmation requested.
- **relationships, zyra_conversations, chat_sessions** — true AMBIGUOUS.
  Plan reads as if they should carry `commodity_id`. Open-questions decision
  required. None block V1.0-alpha.

Per task spec: "Missing `commodity_id` on a Phase 2/3 table flagged
PLAN-AHEAD but NOT migrated in this phase." All FAIL-row entities are
Phase 2/3 except zyra_conversations and chat_sessions, which are pilot-only
through Phase 1.10. No 1.2b migrations are required to fix these.

---

## V1.0-alpha-blocking PLAN-AHEAD gaps — migration drafting target

Per task spec the allowed subset is:
**{commodities-extensions, news_items, market_intelligence-extensions, prices,
profiles-extensions, user_roles-extensions, verification_requests-extensions,
auth_bridge_log-extensions}**

Cross-checking against migration files:

| Subset member | Migration present | V1.0-alpha-blocking gap at migration-file level? |
|---|---|---|
| commodities-extensions | Foundation lines 83–108 cover all plan-required columns. No extension needed at migration level. | None |
| news_items | `20260501060000_adela_tables` lines 105–138. | None |
| market_intelligence-extensions | Foundation lines 364–406 cover all plan-required columns including `confidence`, `is_active`, `ingested_at`. | None |
| prices | `20260501060000_adela_tables` lines 22–59. | None |
| profiles-extensions | Foundation + `20260509100000_phase_1_3a_auth_foundation` cover verification_state, geography_*, business_type, annual_volume, referral_source. | None |
| user_roles-extensions | Foundation lines 30–39 + RLS fix in `20260428000002_fix_user_roles_rls`. No extension needed. | None |
| verification_requests-extensions | `20260501050000_verification_requests` + `20260509100000_phase_1_3a_auth_foundation` cover structured background-check + multi-reviewer assignment. | None |
| auth_bridge_log-extensions | `20260509100000_phase_1_3a_auth_foundation` lines 156–187. | None |

**Result at migration-file level: ZERO V1.0-alpha-blocking PLAN-AHEAD gaps
require migrations in this pass.**

This is consistent with the V1.0-alpha-foundations-shipped status in
`runtime-state.md` (Phase 1.1, 1.2, 1.3a, 1.3b, 1.3c all listed as ✅).

**What this report cannot rule out:** Phase 1.10bb-style migration drift —
a migration file present in the repo but not actually landed in the live DB
because of a `schema_migrations` version collision or a `db push` skip. The
Snapshot Verification Gate is exactly the mechanism designed to catch this.
**That check is deferred until Muzammil's Studio snapshot run lands.**

If the snapshot reveals any of the eight subset members are absent or
shape-incorrect in the live DB, the post-snapshot follow-up will draft a
corrective migration per the §"Migration file template" rules in the task
spec (timestamp-unique, commodity_id-aware, RLS-enabled, ≥1 policy,
NOT-applied, human-gated Studio apply).

---

## Migrations drafted in 1.2b

**None.** Drafting "just in case" migrations against unknown live-DB state
would violate the anti-restart rule (creating parallel implementations next
to potentially-already-applied migrations). The post-snapshot follow-up
will draft migrations where drift is concretely surfaced.

---

## DB-AHEAD findings

Cannot be enumerated without the live snapshot. Many cockpit/atlas tables
(brain_*, atlas_*, designer_runs, verifier_runs, pd_*, concepts,
wizard_sessions, etc.) exist in migrations and are not in master plan §4.1
because they are runtime-agent infrastructure rather than §4.1 data
entities — these are expected and not DB-AHEAD findings. True DB-AHEAD
findings (tables in live DB but in NEITHER migrations NOR plan) require the
snapshot to surface.

---

## Citations used in this report

- Master plan §4.1 — `.agent/master-plan.md` lines 286–355
- V3-CODING-INSTRUCTIONS rule #3 (multi-commodity FK) — see task spec
- idea.md line 20 (V1.0-alpha scope) + line 21 (V1.0-beta scope)
- runtime-state.md §Next up (Phase 1.6 Adela data spine is V1.0-beta)
- Phase 1.10bb lesson (migration drift detection requires live-DB inspection) — runtime-state.md lines 36–39
- Task spec out-of-scope list (Phase 2/3 entities + position_reports + V1/V2 legacy + DB-AHEAD non-migration)
