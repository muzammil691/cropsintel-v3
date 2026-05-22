# CropsIntel V3 — Master Plan v1.5

**Author:** Cowork — Muzammil Akhtar
**Date:** 2026-04-28
**Status:** v1.6 — execution in flight. WP-0 quality-gate fixes shipped 2026-05-07; UX polish queue + WP-1/2/3 sequence locked.
**Inputs (v1.0):** V3 handoff briefing, CropsIntel vision memory, V1 audit, V2 audit, V1 vs V2 comparative
**Inputs added in v1.1:** `MAXONS_Workflow_v1.docx`; user directive to remove "DNS rollback to V1"
**Inputs added in v1.2:** User clarification 2026-04-28 — V3 is **CropsIntel standalone**; the MAXONS workflow doc is **knowledge reference only**; MAXONS App and BC are adjacent systems Maxons builds/operates separately
**Inputs added in v1.3:** Round 2 polish — V3 frontend hosting = GitHub Pages (continuity with V2); V3 Supabase = brand-new project; Adela runtime host = Railway
**Inputs added in v1.4:** Round 3 polish — AI provider monthly budget caps $400/month total ($200/$50/$50/$100); verified-tier definition = manual review by Maxons team; Phase 1 Zyra modules = 13 (defensive 9 + behavioral 4: personality, navigation, proactive alerts, quality tracker)
**Inputs added in v1.6:** WP-0 quality-gate retro entry (2026-05-07); Claude Code build prompt with WP-1/2/3 sequence (2026-05-07); user UX requests for Plan tab progress intelligence, Queue card expansion, Chat conversation upgrade, Chat attachments (2026-05-07 evening session)
**Read time:** ~30 minutes
**Re-read cadence:** before every new V3 work session, even short ones

---

## 0. How to use this document

This is the contract. Every V3 work session — Cowork, Lovable, Claude.ai, a future agent, or Muzammil writing code by hand — starts by re-reading this plan. If the work being requested isn't aligned, two outcomes are allowed:

1. **Surface the misalignment and update this plan** (with explicit user approval, logged in section 17). The plan is editable, but only deliberately.
2. **Don't do the work.** The default response to "let's also fix this while we're in here" is no.

The pattern this plan exists to break: Muzammil has produced beautiful master plans in past Claude.ai sessions. They get designed, then shelved when an urgent thing breaks. **This is the last master plan.** Every change is incremental and sourced.

---

## 1. North star — what V3 is

### 1.1 V3 = CropsIntel, standalone

V3 is a clean rebuild of **CropsIntel** — a global almond market intelligence platform with CRM/BRM/SRM relationship graphs and an AI agent layer. Same product as V1 (almond-oracle) and V2 (CropsIntelV2) at the conceptual level — different scope and execution discipline.

**V3 is NOT:**
- The MAXONS App. That's a separate system Maxons builds for its own internal trading operations.
- Microsoft Business Central. BC is Maxons' financial system of record, integrated with MAXONS App, not with V3.
- A multi-tenant SaaS for trading houses. (That's a possible future v4 vision; not this scope.)

**Adjacent systems V3 may eventually integrate with (but not now):**

| System | Job | Status for V3 |
|---|---|---|
| **MAXONS App** | Maxons' internal trading operations system (executes Sale Contracts, Purchase Orders, shipments, payments) | Separate codebase. Future integration possible. NOT in V3 scope. |
| **Microsoft Business Central** | Financial system of record (GL, AP/AR, Customer/Vendor master, inventory ledger) | Live, integrated with MAXONS App. NOT in V3 scope. |

**The MAXONS Workflow doc is knowledge input, not blueprint.** V3's intelligence (Zyra, Atlas, market analytics, prescription engine) is grounded in real almond-trading process knowledge from that doc, but V3 does not execute trading workflows. CropsIntel users come to V3 for market intelligence and CRM-style features, not to issue Sale Contracts or post to GL.

### 1.2 Three operating models — used as intelligence dimension, not execution mode

Almond trading runs on three operating models (per the workflow doc):
- **Model A — Back-to-back trading** (customer-driven procurement)
- **Model B — Speculative position trading** (market-driven)
- **Model C — Local stock & distribute** (Dubai inventory)

V3 does not execute these models. V3 **understands** them — so when Zyra answers "should I buy now?" the answer is informed by which model the user is running. When the variance engine analyzes a deal a subscriber chooses to track in V3, it knows whether that deal is back-to-back vs speculative and applies the right computation.

**Where this shows up in V3:**
- Subscriber profile in the CRM has a `primary_models` field (any combination of A/B/C).
- Optional deal-tracking feature (Phase 2): subscribers can voluntarily log deals they're working on; each gets a `model` tag; V3 computes margin / position metrics based on model.
- Zyra's prescriptions reference model context.

### 1.3 Pilot commodity (almonds) and multi-commodity readiness from Day 1

Almonds is the wedge. Multi-commodity (cashews, pistachios, walnuts, dates, then expand) is built into the schema from migration #1 — every table that scopes to almonds today has a `commodity_id` foreign key. Adding pistachios is configuration, not a rewrite.

**Almond-specific context to encode in V3 (from workflow doc):**

- **Origin:** USA (predominantly California). Crop year, variety (Nonpareil, Carmel, Independence, Monterey), size grading, quality classification all materially affect price.
- **Form:** Inshell, shelled, blanched, sliced, slivered, diced — each with its own price ladder and customer segment.
- **Pricing convention:** USD / lb. 50 lb cartons, palletized, ~44,000 lb / 40' container.
- **Trade basis:** FAS / CIF / FOB / CFR / DAP.
- **Documentation by destination:** Phyto (USDA), COO, USDA Aflatoxin Cert, Halal (where applicable), Health Cert, Salmonella Cert (EU), BL, Packing List, Commercial Invoice. V3's compliance reference module knows which docs apply per destination.
- **Payment patterns:** several variants, all encoded in the prescription engine and Zyra's coaching layer.

### 1.4 Three relationship graphs (the spine)

V3 has three scoped, separately-permissioned relationship graphs. **The relationships are between CropsIntel and its industry subscribers** — not between Maxons and its trading counterparties. Maxons is one CropsIntel power-user; the platform serves the global almond chain.

- **CRM** — customers (importers/buyers across the world)
- **BRM** — brokers (intermediaries who connect buyers and sellers)
- **SRM** — suppliers (growers, hullers, processors, primarily US almond sources)

**Information walls (load-bearing):**
- Suppliers see: pricing/demand to maximize their profit.
- Brokers see: market intelligence + commission opportunities.
- Customers see: ONLY their own pricing (from offers admins post). Never supplier source, never broker source, never margin structure.

The AI enforces every wall autonomously. Any feature that breaches a wall is automatically out of scope.

### 1.5 The flywheel

1. Free/limited analytics attracts the global almond chain.
2. Registration captures the profile; verification certifies it.
3. Zyra deepens each profile through interaction.
4. Verified pool *organically* becomes the CRM/BRM/SRM relationship graph.
5. CRM-style features (offers, deal tracking, prescription engine) activate on verified relationships.

The analytics layer is valuable standalone — solves the marketplace cold-start problem.

### 1.6 Three named layers (stable, do not rename)

- **Adela** — the runtime nervous system. Cron-driven Node process. Monitors everything. Closest existing realization: V2's `runner.js`.
- **Atlas** — the self-development / project-management layer. Self-scraping, self-maintaining, self-knowing. Runs a council of 3-4 AI systems that *debate*. Closest existing realization: V1's `brain-ai` edge function + Atlas/AtlasBrain/MasterExecutionPlan pages.
- **Zyra** — customer-facing intelligence + sales coworker + trade lifecycle orchestrator. Closest existing realization: V1's 26-module `lib/zyra*` orchestration framework + `dr-atlas` edge function.

### 1.7 Multi-portal frontend

Every counterparty type logs into their own Cropsintel-branded portal:

- **Public** (everyone) — landing, market insight, news
- **Subscriber** (verified) — full dashboards, Zyra deep chat, prescription engine, deal tracking, alerts
- **Customer Portal** (CRM-side, Phase 3) — order tracking for subscribers who use CropsIntel-tracked offers
- **Broker Portal** (BRM-side, Phase 3) — deal pipeline, market notes submission, performance scorecard
- **Supplier Portal** (SRM-side, Phase 3) — RFQ response, performance scorecard, market visibility
- **Admin / CropsIntel team** (internal) — content management, user management, feature flags, Atlas / Master Execution Plan

V3 does NOT have separate portals for Maxons' 8 internal departments — those are MAXONS App's job. CropsIntel team members log into the admin surface.

### 1.8 Trade lifecycle — knowledge, not execution

The workflow doc's 15 workflows describe how almond deals actually flow. V3 uses this as **knowledge** to make Zyra and Atlas useful — not as **scope** to build.

V3 builds:
- An **understanding** of each workflow's stages, KPIs, exception types, common failure modes
- **Optional deal-tracking** for subscribers who want to log their own deals into V3 (lightweight, no BC posting, no contract issuance)
- **Margin scenario tools** — let a user model "if I buy at X and sell at Y, what's my landed margin given current freight and duties?"
- **Prescription engine** — Zyra recommends actions grounded in workflow knowledge

V3 does NOT build:
- Sale Contract issuance (Workflow 3 — MAXONS App's job)
- Purchase Contract issuance and back-to-back linking (Workflow 4 — MAXONS App's job)
- Shipping Instruction submission flow (Workflow 5 — MAXONS App + portals there)
- BC posting of any kind
- Bank document presentation, LC workflows, payment instruction APIs

### 1.9 Hyper-personalized prescription (not just data)

Each user gets directives, not dashboards. Example: "Bangladesh buyer, buy now at this price — supply shortage incoming, this is at/near the global year-low." Reasoning attached so they trust it.

The prescription engine's value depends on knowing the workflow doc's content — that's why the workflow doc is essential input.

### 1.10 Autonomous self-improvement (Phase 4)

Atlas reads its own plan, proposes changes, runs them by Muzammil in a controlled window, and ships them itself once approved.

**Hardened admin gate:** WhatsApp video + OTP. Only Muzammil can authorize.

#### 1.10bb — Verifier write-path unblock — apply migration drift fix (subject_matter_hits)

_launch tier: v1.0-alpha_

## Context

Verifier writes to `verifier_runs` (correct table) have been failing since 2026-05-07 with silent fallback to `writeUnknownVerifierRun()` stamping `unknown_reason='db_write_failed'`. 44 such rows accumulated; most recent 2026-05-22 13:39 UTC. Failing audit_run_id cited in workshop intake: `d2514552-9fe5-47f4-8354-95bf4b4efdd1`.

**Root cause (confirmed by live evidence):** This is Phase 1.3c migration drift manifesting again. Phase 1.10v (2026-05-07) added `subject_matter_hits` to the Verifier insert payload (`verifier/src/lib/audit.ts:11-48`) and produced migration file `supabase/migrations/20260507120000_verifier_subject_matter_hits.sql`. That migration was never applied to prod Supabase project `hzrnohsxigrqlmzegwlb`. Last applied verifier migration: `20260509085134_fix_verifier_runs_rls`. Every Verifier insert since has thrown on unknown column and fallen through to the unknown-row write path.

**This phase is the surgical fix only:** apply the existing migration. No code changes.

## In scope

- Apply migration `20260507120000_verifier_subject_matter_hits.sql` to prod Supabase project `hzrnohsxigrqlmzegwlb`.
- Pre-flight health check: confirm 7/7 Railway services healthy (Atlas conductor, Builder, Verifier, Designer, Adela, Council, Memory) per runtime-state.md §Atlas+agents, plus frontend deploy.
- Post-apply smoke test: trigger one real Verifier audit run and assert a row lands in `verifier_runs` with all NOT NULL fields populated (`task_id`, `task_spec_path`, `commit_sha`, `mode`, `ran_at`) AND `subject_matter_hits` column present and writable (NULL or integer, not erroring).
- Update `.agent/runtime-state.md` to reflect migration applied + Verifier write path restored.
- Mark `supabase_migrations.schema_migrations` row for `20260507120000` as applied (Supabase Studio applies this automatically when the SQL Editor records the migration; verify after run).

## Out of scope (deferred to follow-up phases)

- **Bug 2 (snapshot.ts silent corruption):** `atlas/src/cron/snapshot.ts:41-47` reads non-existent `.verdict` column and queries non-existent `created_at` (should be `ran_at`). Pass rate has been 0%/null since shipped. → defer to a follow-up phase (rename: `1.10bc` or equivalent).
- **Bug 3 (memory ingest silent corruption):** `memory/src/ingest/agent-history.ts:43,122,211` stamps every chunk as `verdict='unknown'` because field resolves to undefined. → defer to a separate follow-up phase.
- **Cleanup of 44 db_write_failed rows in `verifier_runs`:** decide delete vs archive vs leave. → defer to a separate follow-up phase.
- Any change to `verifier/src/lib/audit.ts` write payload (it is already correct).
- Any change to readers using `.passed` (they will work correctly post-migration).
- Any change to `audit_run_id` / `confidence` persistence (working as designed; HTTP-only fields, not DB columns).

## EXECUTION METHOD (non-negotiable)

1. Open Supabase Studio SQL Editor for project `hzrnohsxigrqlmzegwlb`.
2. Copy the SQL contents of `supabase/migrations/20260507120000_verifier_subject_matter_hits.sql` into the SQL Editor.
3. Run.
4. **DO NOT execute `supabase db push`** — that would attempt to apply all unapplied local migrations, including any further drift not scoped into this phase. Per runtime-state.md Open Issues #2, additional drift exists; running db push risks unintended side effects.
5. After successful run, manually insert a row into `supabase_migrations.schema_migrations` for version `20260507120000` if Studio did not record it automatically (verify via `SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260507120000'`).

## PRE-FLIGHT

- Confirm 7/7 Railway services healthy (Atlas conductor, Builder, Verifier, Designer, Adela, Council, Memory) plus frontend.
- If any service unhealthy, **defer the smoke test step until healthy** (the migration apply itself is independent and can proceed; only the post-apply Verifier smoke test depends on Verifier service health).

## Acceptance criteria

1. `SELECT column_name FROM information_schema.columns WHERE table_name='verifier_runs' AND column_name='subject_matter_hits'` returns exactly 1 row.
2. `SELECT version FROM supabase_migrations.schema_migrations WHERE version='20260507120000'` returns exactly 1 row.
3. Next real Verifier audit run after apply produces a row in `verifier_runs` with `unknown_reason IS NULL` and `passed IN (true, false)` — i.e., no longer falling through to `writeUnknownVerifierRun()`.
4. No new `unknown_reason='db_write_failed'` rows appear in `verifier_runs` after the apply timestamp.
5. `.agent/runtime-state.md` updated with apply timestamp + restored-status note.

## Owner

Muzammil (manual SQL apply via Supabase Studio — Builder/Atlas cannot apply DB migrations from CI per runtime-state.md Open Issues; CI lacks SUPABASE_ACCESS_TOKEN + direct DB access).

## Estimated effort

~15 minutes: 2 min SQL apply, 5 min smoke test, 5 min runtime-state.md update, 3 min buffer.

### 1.11 What V3 explicitly is NOT

- Not a Lovable app. V3 is local-first.
- **Not a "rebuild that defaults back to V1 if things go wrong."** V1 stays in its current Lovable preview state as a historical artifact ONLY. No DNS rollback.
- Not a parallel restart of V1. V3 inherits V1's depth and V2's scaffolding.
- Not a single-commodity build. Multi-commodity readiness is a Day 1 architectural constraint.
- Not the MAXONS App. Maxons builds that separately; V3 may integrate with it later.
- Not an accounting / payments / BC-replacement system.

---

## 2. The pattern V3 is breaking

This plan exists because the same anti-pattern has played out at every layer:

- V1 → V2 was a clean restart that lost most of V1's depth.
- Inside V1, `/zyra` and `/zyra-ai` are a clean restart inside the same codebase.
- Each Lovable session adds features (offers) before their dependencies (canonical_products) are properly wired.
- Past master plans get designed, then shelved when an urgent thing breaks.

**Three rules:**

### 2.1 Anti-restart rule

When something is broken, fix it in place. Do not start a parallel implementation next to the broken one. If a fresh restart is genuinely the only path, the master plan is updated and the old version is **deleted**, not parked.

### 2.2 Foundation-first rule

For any feature, the dependency graph must be satisfied before the feature ships. Scope Guardian's first job is to enforce this.

### 2.3 One-thing-at-a-time rule

One agent at a time, fully shipped, before the next. The phase you are in is the only phase being built.

---

## 3. Phase 0 — Stop the bleeding on V2 (this week, before V3 work starts)

V2 has two live security exposures and two unverified login flows. These cannot run in the background while V3 is built.

### 3.1 P0 work items (in order)

| # | Item | Owner | Approx time |
|---|---|---|---|
| P0.1 | ~~Rotate GitHub PAT~~ — **DEFERRED 2026-04-28** per user (local-Mac risk acceptable) | — | — |
| P0.2 | ~~Switch V2 git remote to SSH~~ — DEFERRED with P0.1 | — | — |
| P0.3-P0.6 | ~~Rotate 4 AI provider keys (Anthropic/OpenAI/Gemini/ElevenLabs)~~ — **DEFERRED to V3 launch 2026-04-28** per user. Math-based decision: spend caps ($400/mo total) bound damage; rotate during V3 cutover. **Mandatory mitigation: weekly billing dashboard check (calendar reminder).** | — | — |
| P0.7 | Check billing dashboards for unusual spend | Muzammil | DONE 2026-04-28 — no abuse |
| P0.8 | ~~Decide patch path~~ — DEFERRED with P0.3-P0.6 | — | — |
| P0.9 | ~~Patch V2 to move AI calls server-side~~ — DEFERRED to V3 launch | — | — |
| P0.10 | ~~Remove VITE_*KEY env vars~~ — DEFERRED with P0.9 | — | — |
| P0.11 | ~~Verify V2 dist bundle clean~~ — DEFERRED with P0.9 | — | — |
| P0.12 | ~~Deploy V2's `whatsapp-login` edge function~~ — **DEFERRED 2026-04-28** per user. V2 stays as-is until V3 cutover; Twilio shifts to V3 at launch. V3 will have clean WhatsApp from Day 1. | — | — |
| P0.13 | ~~E2E verify all 4 login methods on cropsintel.com~~ — DEFERRED with P0.12 | — | — |
| P0.14 | ~~Update V2 progress.json~~ — DEFERRED with P0.12; V2 progress.json freezes at current state until V3 cutover | — | — |
| P0.15 | Update active-security memory: deferrals logged | Cowork | DONE |
| P0.16 | ~~Make V1's GitLab repo private again~~ — **DEFERRED 2026-04-28** per user. Cowork flagged that this was Cowork-introduced exposure (audit clone). User accepts. Re-flag at V3 launch. | — | — |
| P0.17 | ~~Calendar reminder for weekly billing check~~ — **DEFERRED 2026-04-28** per user. Active-security memory updated: AI key deferral now relies on user remembering to check billing manually rather than calendar enforcement. | — | — |
| **PHASE 0 STATUS** | **CLOSED 2026-04-28.** All items deferred to V3 cutover except P0.7 (billing dashboard check, done — no abuse). User chose to skip P0 entirely and move to Phase 1 V3 work. Active risks logged in `cropsintel_security_active.md` memory. | — | — |

### 3.2 P0.9 path options

**Path A — Patch V2 in place (recommended):**
- Move all 4 AI provider calls from `src/lib/ai-engine.js` into a new Supabase edge function `v2-ai-call`. Keys live in Supabase secrets.
- Update `ZyraWidget.jsx` callers to invoke the edge function.
- Strip source maps from production build.
- 1 day of work. cropsintel.com stays on V2.

**Path B — Take cropsintel.com offline while patching:**
- Show maintenance page on cropsintel.com.
- Patch V2 in place per Path A while site is offline.
- Bring V2 back up clean.
- ~4-6 hours total downtime. Pick this only if billing dashboards show evidence of key abuse.

**No DNS rollback to V1.** V1 will not be reactivated as a customer-facing surface under any circumstance (per directive 2026-04-28).

**Until P0 closes, the V3 build sequence below is paused.**

---

## 4. Data foundation — the dependency graph

### 4.1 Core entity order (build in this order — nothing later before everything earlier)

```
1. commodities          (commodity master — almonds, pistachios, etc.)
   ↓
2. companies            (entity master — buyer companies, broker firms, supplier companies)
   ↓
3. contacts             (people inside companies)
   ↓
4. canonical_products   (variety + product_type + size + grade + aliases, scoped to commodity)
   ↓
5. relationships        (CRM/BRM/SRM edges with role + verification status)
   ↓
6. profiles             (user accounts → company contacts; user_role enum: customer/broker/supplier/admin/team)
   ↓
7. offers               (admin-posted offers shown to subscribers — V1's admin_sales_offers pattern)
   ↓
8. offer_lines          (per-product line items inside offers, FK to canonical_products)
   ↓
9. inquiries            (subscriber requests; "I want X amount of Nonpareil 23/25 by Y date")
   ↓
10. tracked_deals       (OPTIONAL: subscribers can log their own deals to use V3's margin/intelligence tools — no BC posting)
    ↓
11. positions           (Model B subscribers can log positions for the position book intelligence — voluntary, lightweight)
    ↓
12. market_intelligence (price curves, basis signals, news, scraped data)
    ↓
13. zyra_conversations  (every Zyra interaction)
    ↓
14. communications      (every touch point: in-app, WhatsApp, voice, email)
    ↓
15. exceptions / observations  (Atlas's data quality + market anomaly findings)
```

### 4.2 Multi-commodity readiness (Day 1 constraint)

Every domain table that scopes to almonds today has a `commodity_id` foreign key from migration #1.

```sql
CREATE TABLE commodities (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,        -- 'almonds', 'pistachios', 'pineapples', 'cashews'
  display_name text NOT NULL,
  trade_basis_options text[] NOT NULL DEFAULT ARRAY['FAS', 'CIF', 'FOB', 'CFR', 'DAP'],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO commodities (slug, display_name) VALUES ('almonds', 'Almonds');
```

### 4.3 Three operating models — schema-level support

Subscribers and tracked deals carry a `model` field:
```sql
ALTER TABLE profiles ADD COLUMN primary_models text[] NOT NULL DEFAULT '{}';  -- subset of {'A','B','C'}
ALTER TABLE tracked_deals ADD COLUMN model text NOT NULL CHECK (model IN ('A','B','C'));
```
Zyra and intelligence modules read these to choose computations.

### 4.4 The Scope Guardian's job (data side)

Before any feature touches an entity in 4.1, the Scope Guardian verifies:
1. The entity's table exists in V3's `supabase/migrations/`.
2. The entity's table has its dependency FKs.
3. RLS policies exist.
4. There are at least 3 seed rows in dev for testing.
5. The entity respects the multi-commodity + model constraints.

If any check fails, the feature work is rejected.

---

## 5. Functional departments and decision rights — knowledge reference (NOT V3 scope)

The MAXONS Workflow doc specifies 8 functional departments. **These are how almond trading houses are organized — they describe MAXONS App's user surface, not CropsIntel's.** V3 does not have 8 separate role surfaces for Maxons' internal departments.

V3 stores this knowledge so Zyra can reference it (e.g., "the Procurement Operations role typically owns purchase contract drafts" — Zyra knows this). V3 does NOT have routes / pages / workflows specifically for Trade Desk vs Procurement vs Logistics, etc.

**V3's actual user roles:**
- Public (anonymous, guest-mode)
- Subscriber (verified user — typically a trader, broker, or supplier from the global almond chain)
- Subscriber tier — Customer / Broker / Supplier (each gets their own portal in Phase 3)
- CropsIntel team (admin / analyst — internal, manages content + users + Atlas tooling)
- Maxons power-users (a special subset of subscribers; can be marked "team" tier for additional CropsIntel features)

**The 8 MAXONS departments live as knowledge data, not as user roles:**
- A `mx_departments` table seeds the 8 departments + their decision-rights matrix from the workflow doc.
- Zyra references this when answering operational questions.
- The data is admin-edited as MAXONS evolves (or other trading houses get encoded later).

---

## 6. The 15 canonical workflows — knowledge reference

The MAXONS Workflow doc specifies 15 end-to-end workflows. **V3 stores these as structured knowledge, not as executable code.** When a subscriber asks "what's the typical document set for a Pakistan almond shipment?" Zyra answers from this knowledge.

| # | Workflow | What V3 does with it |
|---|---|---|
| 1 | Price Discovery & Market Intelligence | **V3 BUILDS THIS.** It's the public market intelligence layer. Phase 1. |
| 2 | Customer Enquiry → Sale Quote | Zyra knows the workflow; can help subscribers draft enquiries. Optional CRM-style feature for admin to post offers and track inquiries. |
| 3 | Sale Contract Issuance | Knowledge-only. Maxons (and other subscribers) execute this in their own systems (BC + MAXONS App). |
| 4 | Purchase Contract + Back-to-Back Linking | Knowledge-only. |
| 5 | Shipping Instructions & Markings | Knowledge-only. Zyra can validate destination compliance based on stored rules. |
| 6 | Pre-Shipment Logistics (FAS) | Knowledge-only. |
| 7 | Pre-Shipment Logistics (CIF) | Knowledge-only. |
| 8 | Shipment Execution & In-Transit Tracking | Optional Phase 3 feature: subscribers can opt-in to share their shipment tracking with V3 for visibility/intelligence. Read-only display, not booking. |
| 9 | Document Flow & Bank Routing | Knowledge-only. V3 has destination-aware compliance reference (which doc is needed where) but doesn't manage docs. |
| 10 | Arrival, Customs Clearance, Delivery | Knowledge-only. |
| 11 | Payment Cycles | Knowledge-only. Zyra can advise on typical patterns. |
| 12 | Broker Commission Lifecycle | Knowledge-only. |
| 13 | Inventory Movement (Model C) | Knowledge-only. (V3 may surface aggregate / aging intelligence if subscribers log inventory voluntarily.) |
| 14 | Position Book & Exposure Mgmt (Model B) | **V3 BUILDS LIGHT VERSION.** Phase 2 optional feature: subscribers can log positions; V3 computes exposure metrics (mark-to-market, days held) — for the subscriber's own use. No multi-tenant aggregation. |
| 15 | Exception & Claims Mgmt | Knowledge-only. |

**The intelligence layer (Live Margin Engine, Position Book, Variance Engine, Counterparty Graph)** is the ONE thing V3 builds that touches workflow execution territory. But it's **as a tool for subscribers**, not as Maxons' transaction system.

---

## 7. The intelligence layer — what V3 actually builds

### 7.1 Live Margin Engine (subscriber tool)

A subscriber can open V3, type "if I buy Nonpareil 23/25 at $X FAS California and sell at $Y CIF Karachi, what's my landed margin?" — V3 computes:

- FOB / FAS / CIF supplier price
- Ocean freight (live API)
- Marine insurance estimate
- Destination port charges, THC, clearance estimate
- Duty (per destination tariff)
- Local logistics estimate
- Broker commission (if applicable)
- Cost of capital on advance payments
- Provision for demurrage risk
- FX impact

Three margin views: **Contracted** / **Mark-to-Market** / **Realized** (only realized makes sense if subscriber tracks the deal to closure).

**Phase shipped:** Contracted + scenario-margin in Phase 2; MtM in Phase 3.

### 7.2 Position Book — light version (subscriber tool)

A subscriber running Model B can voluntarily log open positions. V3 computes:
- Net long/short by item, grade, origin, crop year
- Weighted average cost basis
- Mark-to-market against latest market reference
- Unrealized P&L
- Days held
- Concentration risk

**Risk triggers** are per-subscriber alerts they configure. V3 does not aggregate across subscribers (information walls).

**Phase shipped:** Phase 3.

### 7.3 Counterparty Intelligence Graph

V3's most valuable institutional asset. Captures every interaction with every CropsIntel subscriber.

- **Customer profile:** lifetime engagement, product mix preferences, quote interactions, behavior score, seasonality, sensitivity to price changes
- **Supplier profile:** offer frequency, price competitiveness vs market, response speed
- **Broker profile:** deal introductions, conversion rate, market intelligence quality

**Phase shipped:** Phase 2 basic; Phase 3 full.

### 7.4 Market Price Intelligence

V3's external market view, structured.

- Every supplier offer logged
- Every broker market note logged
- Every customer indication logged
- Freight rate API ingestion per major lane
- USDA reports + ABC position reports
- Live price curve per origin / grade / size / form
- Implied basis (US price vs destination minus freight) — the arbitrage signal
- Volatility metrics
- AI commentary: weekly summary

**Phase shipped:** Phase 1.

### 7.5 Variance Engine — for tracked deals

For deals subscribers voluntarily track in V3, the engine compares contracted terms to actual outcomes.

- Quantity variance
- Quality variance (if subscriber logs test results)
- Shipment-window variance
- Document timeliness
- Payment timeliness
- Price variance

Output: per-deal scorecard + counterparty trend. Counterparty here = the supplier/customer the subscriber transacted with.

**Phase shipped:** Phase 3 (depends on tracked-deals adoption).

### 7.6 AI-assisted features

| Capability | Phase |
|---|---|
| Quote drafting assistant (subscriber types enquiry → V3 drafts) | Phase 2 |
| Document classification (subscriber uploads BL → V3 extracts vessel, ETA, qty, lot) | Phase 3 |
| Anomaly detection (price drift, freight drift, etc.) | Phase 3 |
| Conversational interface for operational queries | Phase 1 (basic), Phase 3 (full) |
| Predictive ETA (for opt-in shipment tracking) | Phase 3 |

---

## 8. External portals (subscriber portals, NOT MAXONS counterparty portals)

V3 ships three external portals from Phase 3. **They are CropsIntel subscriber portals — the audience is the global almond chain, not Maxons' specific counterparties.**

Shared architecture: SSO, MFA mandatory, granular role-based access, mobile-responsive, multi-language, full audit log, configurable notifications.

### 8.1 Customer Portal (importers / buyers)

**Capabilities:**
- Personalized market dashboards
- Document hub for offers/inquiries they've engaged with
- Quote requests (submit enquiries; view active CropsIntel-tracked offers from admins)
- Statement (their own transaction log within CropsIntel)
- Price alerts (subscribe to notifications when CropsIntel admin posts offers within target range)
- Optional shipping instruction submission (for opt-in shipment tracking)
- Communication log
- Claims & disputes (within CropsIntel-tracked transactions only)

**Visibility boundaries:** sees only their own data; never margin structure, never other subscribers' identities.

### 8.2 Supplier Portal (US growers / hullers / processors)

**Capabilities:**
- Active inquiry dashboard (RFQs from buyers visible to suppliers per relationship rules)
- Loading evidence upload (for opt-in shipment tracking)
- Document upload
- Quote submission (respond to RFQs)
- Performance scorecard (transparency drives improvement)

**Visibility boundaries:** sees their own contracts/RFQs; never customer identity unless explicitly disclosed; never other suppliers.

### 8.3 Broker Portal

**Capabilities:**
- Deal pipeline (deals broker is attached to, within CropsIntel-tracked transactions)
- Commission accruals (live view)
- Settlement statements
- Market notes submission (structured intelligence for the platform)
- Performance scorecard

**Visibility boundaries:** sees deals where they are the broker of record; never others.

---

## 9. Agent architecture

### 9.1 Dev-time agents (build V3, not part of the V3 product)

| # | Agent | Job | AI behind it | Phase |
|---|---|---|---|---|
| D1 | Research & Workflow Polish Agent | Walks Muzammil through every workflow; produces detailed scope docs per feature | Claude | Phase 1 prep |
| D2 | Scope Guardian | Reads every change. Rejects foundation skip / anti-restart violation / multi-commodity violation / scope creep beyond CropsIntel into MAXONS App territory | Claude | Phase 1 prep |
| D3 | Dev Loop Agent | Day-to-day driver. One task at a time | Claude (gen) + Gemini (sanity) + OpenAI (judge) | Phase 1 |
| D4 | Multi-Brain Code Writer | Ambiguous tasks → all three providers in parallel + synthesis | Claude+GPT+Gemini | Phase 1 |
| D5 | Industry Research Agent (always-on background) | Daily scrape of new ABC reports, USDA NASS, news, competitor activity | Gemini (extraction); Claude (summarization) | Phase 1 |

### 9.2 Runtime agents (ship inside V3 to users)

| # | Agent | Job | AI | Phase |
|---|---|---|---|---|
| R1 | Zyra (subscriber-facing) | Public chat. Answers report Qs, hyper-personalized prescriptions, voice via ElevenLabs. Tier-aware. **Knows the 15 workflows + 8 departments as background knowledge.** | Claude (V1's `dr-atlas` pattern, server-side) | Phase 1 |
| R2 | Adela (runtime nervous system) | Cron-driven Node process. Runs scrape pipeline, processes data, generates AI insights | Gemini default; Claude for monthly briefs | Phase 1 |
| R3 | Atlas (self-management) | Reads own data quality, surfaces gaps, AI council debates fixes, posts to admin for approval. Phase 4 ships own fixes. | Multi-Brain | Phase 2 |
| R4 | CRM Intelligence Agent | Inside admin and subscriber CRM views — priority outreach, next-best-action, drafts | Claude (nuance); Gemini (scoring) | Phase 2 |
| R5 | Quote Drafting Assistant | Drafts subscriber enquiries / drafts admin offer responses | Claude | Phase 2 |
| R6 | Document Classification & Extraction | Auto-classifies docs subscribers upload (BL, phyto, COO, invoices) | Gemini (vision + structured) | Phase 3 |
| R7 | Predictive ETA | Confidence band on arrival for opt-in tracked shipments | Gemini (small) + custom features | Phase 3 |
| R8 | Anomaly Detector | Silent quality decline, payment slippage, freight drift, margin erosion | Gemini (fast scan); Claude (root cause) | Phase 3 |
| R9 | Customer Service Backup | Human-like AI customer service for escalations | Claude | Phase 3 |
| R10 | Verified Social Network Agent | Inside Phase 4's verified-tier social network. Posts analytics, comments, takes corrections | Claude | Phase 4 |
| R11 | Self-Improvement Agent (Atlas-Pro) | Reads master plan, proposes plan updates, runs them by admin via WhatsApp video+OTP, ships approved changes itself | Multi-Brain | Phase 4 |

### 9.3 Agent rules (apply to every agent)

- Single responsibility. If two agents overlap, one is wrong.
- Every agent's actions write to `<agent>_audit_log`.
- Every agent has rate limits (V1's `zyra_rate_limits` pattern).
- Every customer-facing agent has prompt defense (V1's `zyraPromptDefense` + `zyraInputSanitizer`).
- Every agent that touches the relationship graph respects information walls (V1's `zyraTradeParity` pattern).
- Every agent emits a confidence score; below threshold → flag in `<agent>_escalation_queue`.

### 9.4 Scope Guardian's enforcement powers

1. **Block** — refuses change to land. Used for: foundation skip, anti-restart violation, multi-commodity violation, information-wall breach, **scope creep beyond CropsIntel into MAXONS App territory** (e.g., someone trying to add a "post Sale Contract to BC" feature).
2. **Flag** — lets it land but writes to `scope_violations`.
3. **Allow + log** — to `scope_decisions`.

---

## 10. AI routing rules — explicit, by capability

### 10.1 Provider strengths

| Provider | Use it for |
|---|---|
| **Claude** | Nuanced architecture, trading reasoning, multi-step plans, customer-facing chat (empathy), long-context analysis (full position report PDF), code generation with architecture-bearing diffs |
| **Gemini** | Fast structured extraction, large context, routine summarization, lightweight agent loops, document AI / vision |
| **OpenAI** | Embeddings (vector search), consensus-judging in Multi-Brain, tool-use where function-calling matters |
| **ElevenLabs** | Voice ONLY — TTS + STT |

### 10.2 Routing rules

| Capability | Default | Fallback | Rule |
|---|---|---|---|
| Customer chat (Zyra) | Claude (Sonnet 4) | Gemini Pro | Server-side only. Never client-side. |
| Voice TTS | ElevenLabs | none | Degrades to text |
| Voice STT | ElevenLabs | OpenAI Whisper | ElevenLabs primary |
| PDF parsing | Gemini Pro | Claude | Gemini default; Claude on miss |
| Document classification | Gemini (vision) | OpenAI | Gemini bulk; OpenAI second opinion |
| News summarization | Gemini Pro | Claude | Gemini default |
| Multi-Brain consensus (high-stakes) | Claude+GPT+Gemini | n/a | Three in parallel; GPT-4o judges |
| Embeddings / vector search | OpenAI text-embedding-3-large | n/a | OpenAI only |
| Quote drafting (R5) | Claude | Gemini | Claude generates, Gemini sanity-checks |
| Anomaly detection (R8) | Gemini → Claude | n/a | Two-stage |
| Predictive ETA (R7) | Gemini (small) + custom features | n/a | Hybrid |
| Code gen (Lovable / Cowork prompts) | Claude | Gemini | Claude generates, Gemini cross-checks |
| Prompt defense | Claude (Haiku) | n/a | Haiku for input sanitization classifier |
| Self-improvement debates (Phase 4) | Multi-Brain | n/a | Three-way |

### 10.3 Cost discipline rules

- **No production AI calls go directly from a browser.** Every call routes through a Supabase edge function holding the key in Supabase secrets.
- **Monthly spend caps per provider (locked v1.4):**
  - Anthropic: $200/month
  - OpenAI: $50/month
  - Gemini: $50/month
  - ElevenLabs: $100/month
  - **Total monthly AI budget: $400.** Plus Railway ~$10 + Supabase ~$25 = ~$435/month total infra at Phase 1 scale.
  - Re-evaluate after 6 months of real subscriber traffic.
- **Per-user rate limits** in Supabase (V1's `zyra_rate_limits` pattern). Unverified users get tighter limits than verified.
- **Multi-Brain is budgeted.** Council debates only on explicit request or scheduled weekly briefs.
- **Request-cost-estimator middleware** annotates every call before it runs; budget exceeded → automatic downgrade (Sonnet → Haiku, Pro → Flash).
- **Alerts at 80% of monthly cap** in each provider's dashboard. At 100%, requests fail closed (return a "budget reached, try again next month" message rather than silently incurring overage).

### 10.4 What is NOT AI-routed

- Auth, RLS, RBAC — pure code
- DNS / hosting / infrastructure — pure code, only Muzammil
- Information walls — pure SQL RLS policies
- Anything that posts to BC — out of scope (V3 doesn't post to BC)

---

## 11. V3 build sequence

### 11.1 Phase 0 — Stop the bleeding on V2

See section 3. P0.1-P0.16. **Done condition:** all 4 AI provider keys rotated and server-side; PAT rotated; V2 dist bundle clean; whatsapp-login edge function deployed; all 4 login methods E2E verified; active-security memory updated; V1 GitLab repo back to private.

### 11.2 Phase 1 — V3 Market Intelligence MVP

The MVP. The analytics layer that attracts the global almond chain. **What V1 already does, V3 does cleanly.**

| # | Item | Approx weeks |
|---|---|---|
| 1.1 | Local dev environment setup (section 13) | 0.5 |
| 1.2 | New V3 Supabase project; initial migration set: commodities, companies, contacts, canonical_products, relationships, profiles | 0.5 |
| 1.3 | Auth: 4 methods (V2 pattern), V1+V2 user migration bridge | 1 |
| 1.4 | 3-tier RBAC at route + DB + app, V1 pattern | 0.5 |
| 1.5 | Public landing + market-insight pages | 1 |
| 1.6 | Adela runtime: cron + 6 scrapers (ABC, Strata, news, etc.) ported from V2 to V3 — **hosted on Railway** (per Round 2 decision). **First deploy, not a migration** — V2's runner was never actually running (resolved 2026-04-28). Plan Adela's Day-1 monitoring carefully since there's no production track record. | 1.5 |
| 1.7 | Position reports ingestion + analytics layer (port V1's `positionReportAnalyticsLayer.ts`) | 1 |
| 1.8 | Market Price Intelligence (Workflow 1 — the only workflow V3 directly builds) | 2 |
| 1.9 | Dashboard with Phase-1 widget set (~10 widgets, configuration-driven) | 2 |
| 1.10 | Zyra customer chat (R1 — server-side via edge function, Claude default, ElevenLabs voice). **Loaded with workflow doc + 8-department knowledge as background context.** Phase 1 ships **13 Zyra modules** (defensive 9 + behavioral 4 per v1.4): zyraDataBoundary, zyraInputSanitizer, zyraPromptDefense, zyraRBAC, zyraRateLimiter, zyraAuditLogger, zyraTradeParity, zyraIntelligenceLayer, zyraMemoryEngine, zyraPersonalityEngine, zyraNavigationIntelligence, zyraProactiveAlerts, zyraQualityTracker | 3.5 |
| 1.11 | Hyper-personalized prescription engine v1 | 1 |
| 1.11b | **Verified-user review queue** (admin-side UI for Maxons team to manually approve verified-tier subscribers, per v1.4 verified definition) | 1 |
| 1.12 | i18n setup (EN + HI + ZH + AR + UR for launch) | 0.5 |
| 1.13 | PWA setup. **Note (2026-04-28):** `vite-plugin-pwa@1.2.0` does not support Vite 8 (Vite 8 was the scaffold's default). Either wait for vite-plugin-pwa to ship Vite 8 support OR pin Vite to ^7 in vite.config when adding PWA. Don't try `npm install vite-plugin-pwa` until one of those is true. | 0.5 |
| 1.14 | Playwright e2e for critical flows | 1 |
| 1.15 | DNS cutover to V3, V2 stays as readonly archive | 0.5 |

**Phase 1 explicitly DOES NOT include:**
- CRM admin features (offers, inquiries) — Phase 2
- Subscriber-facing CRM features — Phase 2
- Atlas self-management UI — Phase 2
- Variance engine — Phase 3
- External portals (Customer/Broker/Supplier) — Phase 3
- Multi-Brain on every chat (only on "Council Opinion" request)
- 3D widgets / Three.js (defer or skip)

**Phase 1 done condition:** cropsintel.com is V3, all V1+V2 users can log in, position reports + market intelligence rendering, Zyra responding via server-side edge function with no client-side AI keys, e2e passing.

**Realistic time:** 14-16 weeks at 10-20 hours/week (grew from 12-14 in v1.3 due to v1.4's choice of 13 Zyra modules instead of 9, plus the verified-review queue UI).

### 11.3 Phase 2 — CRM Intelligence + Atlas + tracked-deal scaffolding

Builds the relationship operating system + admin tools + the optional CRM-style features.

| # | Item | Approx weeks |
|---|---|---|
| 2.1 | Companies + contacts CRUD with verification statuses | 1 |
| 2.2 | Relationships table with role-scoped edges (CRM/BRM/SRM); admin verification flow | 1 |
| 2.3 | Offers admin (V1's `admin_sales_offers` pattern: admin posts offers; subscribers see role-appropriate views) | 1.5 |
| 2.4 | Offer lines (FK to canonical_products) + offer destinations | 1 |
| 2.5 | Inquiries + inquiry stages (subscribers can submit RFQs) | 1 |
| 2.6 | Customer Detail page (port V1's `CustomerDetail.tsx`) | 1 |
| 2.7 | Customer Lifecycle state machine (Prospect/Trial/Active/Strategic/At-Risk/Dormant/Lost) | 1 |
| 2.8 | Quote Drafting Assistant (R5) | 1.5 |
| 2.9 | CRM Intelligence Agent (R4) — priority outreach, next-best-action | 1.5 |
| 2.10 | Tracked-deals optional feature (subscribers log deals; V3 computes Contracted margin + scenario margin); NO BC posting | 2 |
| 2.11 | Atlas self-management UI: AtlasBrain, MasterExecutionPlan, DataAudit pages | 2 |
| 2.12 | Atlas runtime: data quality monitor + AI council debates + admin approval flow | 2 |
| 2.13 | Counterparty Intelligence Graph v1 (basic profiles) | 1 |

**Phase 2 explicitly DOES NOT include:**
- Sale Contract / Purchase Contract issuance (NEVER — that's MAXONS App)
- BC posting (NEVER — out of scope)
- Bank document presentation / LC workflow (NEVER)
- External portals (Phase 3)
- MtM live margin (Phase 3)
- Position book full (Phase 3)
- Variance engine (Phase 3)
- Predictive ETA (Phase 3)

**Phase 2 done condition:** admin can post offers, subscribers can submit inquiries, the CRM intelligence agent surfaces priority outreach, Atlas internal UI is operational, at least one tracked deal exists with Contracted margin computation working.

**Realistic time:** 14 weeks at 10-20 hours/week.

### 11.4 Phase 3 — External portals + position book + variance engine + advanced AI

| # | Item | Approx weeks |
|---|---|---|
| 3.1 | Customer Portal v1 | 2.5 |
| 3.2 | Supplier Portal v1 | 2 |
| 3.3 | Broker Portal v1 | 2 |
| 3.4 | Information-wall enforcement audit + RLS test suite | 1 |
| 3.5 | Position Book (Workflow 14, light version per section 7.2) — subscribers voluntarily log positions | 2 |
| 3.6 | Live Margin Engine — Mark-to-Market view | 1.5 |
| 3.7 | Variance Engine (for tracked deals) | 1.5 |
| 3.8 | Counterparty Intelligence Graph — full behavioral computation | 1.5 |
| 3.9 | Document Classification & Extraction (R6) | 1.5 |
| 3.10 | Predictive ETA (R7) for opt-in shipment tracking | 1.5 |
| 3.11 | Anomaly Detector (R8) | 1.5 |
| 3.12 | Customer Service Backup Agent (R9) | 1 |

**Phase 3 explicitly DOES NOT include:**
- BC integration (NEVER)
- Banking / payment instruction APIs (NEVER)
- E-signature platform (NEVER — not V3's job)
- Verified social network (Phase 4)
- Atlas-Pro self-shipping (Phase 4)
- Multi-commodity activation (Phase 4)

**Phase 3 done condition:** brokers, suppliers, customers actively use V3's portals; at least 5 subscribers using tracked-deals + Position Book; information walls verified by penetration test.

**Realistic time:** 12-14 weeks.

### 11.5 Phase 4 — Verified social network + autonomous self-improvement + multi-commodity

- Verified-tier social network (R10)
- Atlas-Pro self-improvement (R11) via WhatsApp video+OTP gate
- **Multi-commodity activation:** pistachios as the second commodity (configuration + content + scrapers)
- Begin Maxons-specific model fine-tuning

**Realistic time:** 16-24+ weeks. Open-ended.

### 11.6 NEVER built into V3

- Sale Contract / Purchase Contract execution (MAXONS App's job)
- BC integration (Maxons handles separately)
- Backend accounting (BC's job)
- Bank document presentation / LC workflows (MAXONS App + bank)
- Payment instruction APIs (MAXONS App + bank)
- E-signature platform (MAXONS App + DocuSign etc.)
- Carrier booking (MAXONS App + INTTRA etc.)
- Crypto / blockchain anything
- A second admin tier — only Muzammil authorizes self-improvement
- Public APIs without verification gates
- Any DNS rollback or fallback to V1

### 11.7 Execution log — what shipped, what's queued, what's next (live)

This sub-section is updated whenever the plan is bumped. It is the single source of truth for "where are we now" and replaces ad-hoc status reports.

#### Phase 1.10 — Atlas conductor + 7-agent fleet

**Shipped (`done/`):** 1.10a through 1.10z (30+ specs). Atlas itself, 6 specialist agents, multi-brain quorum, cost gate, invariants engine, voice TTS+STT, WhatsApp, dashboard, PWA. Production house operational.

**WP-0 quality-gate retro (2026-05-07, shipped):** four fixes bundled in `phase-1.10af-workflow-quality-gates-fix.md` plus follow-up fixes:
- Atlas trust-mode persists across redeploys (DB-backed, not env-only)
- `designer_runs` Supabase migration applied
- Verifier retro-audit on boot now opt-in via env var (default off)
- Atlas git operations serialized via mutex
- Verifier stub-detector whitelist for legitimate placeholders
- Verifier context loader prioritizes whole-file load for ≤2,000-line files

**Phase-1 cluster cleanup (2026-05-07 evening):** ~25 specs cancelled to break a Builder zombie pile-up; in-progress drain ongoing.

#### Phase 1.6 — Adela data scraper

**Status:** infrastructure shipped, scrapers cron-registered, but `/health` endpoint missing and several spec parts cancelled in tonight's drain. Re-queue plan: 1.6b (foundation), 1.6c (Supabase wrapper + ABC), 1.6d (Strata + news), 1.6e (`/health` server fix + AI analyst), 1.6f (Gemini-Claude pipeline).

#### NEW UX polish phases — to queue after in-progress drains to ≤5

| Phase | Title | What it does |
|---|---|---|
| 1.10aa | Plan tab progress intelligence | Phase tree with % rings, color intensity by progress, parses master plan, overlays live build state, shows "today's additional work" + "future additions" sections |
| 1.10ab | Queue card expansion + plain-English summary | Each queue card becomes click-to-expand. Shows what's being built in 3-5 plain bullets, current Builder thought, files changed so far, est. time, cost. |
| 1.10ac | Chat conversation upgrade (voice + tool-call display) | ElevenLabs duplex voice conversation mode in chat. Voice message recording + sending. Tool-call rows show "Calling builder.list_queue..." with progress and expandable real logs (replacing today's `tool_call → pending → null`). |
| 1.10ad | Chat attachments (paperclip) | Paperclip button. Supports image (jpg/png/heic) and PDF upload to Supabase Storage. Atlas reads via vision capability. MIME-validated, size-capped. |

**Gate condition:** these specs only dispatch when in-progress count ≤ 5 AND no spec has been in in-progress for >2 hours (zombie guard).

#### WP-1 / WP-2 / WP-3 — the customer-facing CropsIntel build

After 1.10aa-ad ship, the next runway is Phase 1.3 → 1.6/1.7/1.8 → 1.10 (Zyra) — these correspond to the Claude Code build prompt's WP-1, WP-2, WP-3:

- **WP-1 = Phase 1.3** — Auth + 3-tier RBAC (registered/verified/admin) + V1/V2 user bridge.
- **WP-2 = Phase 1.6 + 1.7 + 1.8** — Adela data spine fully connected to UI: position reports, Strata pricing, news, signals at `/insights`.
- **WP-3 = Phase 1.10za + CRM phases** — verified-tier inquiry → Zyra-drafted offer → Maxons review → customer accept. The value-delivery moment.

These do not start until 1.10aa-ad have shipped and stabilized.

#### Multi-commodity readiness reminder

Every spec from this point forward MUST honour the Day-1 constraint: `commodity_id UUID FK` on every domain row. Walnut and pistachio are configuration, not code branches. Auditing this is part of every Verifier audit going forward.

---

## 12. CRM deep dive — the strongest pillar

### 12.1 The three CRM layers (per workflow doc Part 8)

| Layer | Capabilities | Phase |
|---|---|---|
| **Layer 1 — Transactional** | Contact mgmt, account hierarchy, opportunity tracking, activity logging, pipeline view | Phase 2 |
| **Layer 2 — Intelligence (Counterparty Graph)** | Behavioral profiles from actual interaction history: engagement patterns, quote-to-inquiry ratios, seasonality, price sensitivity, decision-maker mapping | Phase 2 (basic) → Phase 3 (full) |
| **Layer 3 — Decision Support (Co-Pilot)** | Proactive recommendations: "Subscriber X hasn't engaged in 60 days; current US offer in their historical interest band; suggest reaching out today." | Phase 3 |

### 12.2 Customer Lifecycle state machine

| State | Goal | V3 trigger |
|---|---|---|
| Prospect | First engagement | Identified but not active |
| Trial | Prove value | First 1-3 interactions |
| Active | Grow engagement | Regular rhythm established |
| Strategic | Lock in long-term | High-engagement, deep relationship |
| At-Risk | Diagnose and recover | Engagement declining |
| Dormant | Re-activate or de-prioritize | No interaction in window |
| Lost | Post-mortem | Explicit churn or extended dormancy |

### 12.3 Why V3's CRM is strongest for a future huge-sized trader

1. **Structural capture of tacit knowledge.** When a trader leaves Maxons (or any CropsIntel subscriber organization), institutional knowledge stays.
2. **Scale-invariant architecture.** Same with 50 subscribers as 5,000.
3. **Cross-commodity reusability.** Profiles span commodities. Adding cashews, the CRM doesn't care.
4. **Embedded in operations, not adjacent.** CRM is the connective tissue across the platform.
5. **External portal extension.** CRM extends to subscribers themselves through the portals.

---

## 13. Local development setup — for someone with zero developer experience

### 13.1 One-time setup (do once, ever)

**Step 13.1.1 — Install Node.js**

1. Browser → `https://nodejs.org`. Click **LTS** (Node 22.x+).
2. Open `.pkg`. Install.
3. Terminal: `node -v` → `v22.x.x`. `npm -v` → `10.x.x`.

**Step 13.1.2 — Install VS Code**

1. `https://code.visualstudio.com/` → **Download for macOS**.
2. Drag to Applications.
3. `Shift + Cmd + P` → `Shell Command: Install 'code' command in PATH`.

**Step 13.1.3 — VS Code extensions**

Install: ESLint, Prettier, Tailwind CSS IntelliSense, GitLens, GitHub Pull Requests.

**Step 13.1.4 — Set up Git + SSH**

```
git config --global user.name "Muzammil Akhtar"
git config --global user.email "muzammil.akhtar@me.com"
ssh-keygen -t ed25519 -C "muzammil.akhtar@me.com"
pbcopy < ~/.ssh/id_ed25519.pub
```
GitHub → Settings → SSH Keys → **New** → paste → Add. Test: `ssh -T git@github.com`.

### 13.2 V3 project setup (do once when starting V3)

**Step 13.2.1 — Create V3 GitHub repo**

`https://github.com/new` → name `cropsintel-v3` → Private → Create. Copy SSH URL.

**Step 13.2.2 — Local folder**

```
cd ~/Documents/Claude/Projects
mkdir cropsintel-v3 && cd cropsintel-v3
git init
git remote add origin git@github.com:muzammil691/cropsintel-v3.git
```

**Step 13.2.3 — Scaffold Vite + React + TypeScript**

```
npm create vite@latest . -- --template react-ts
npm install
```

**Step 13.2.4 — V3 dependencies**

```
npm install @supabase/supabase-js @tanstack/react-query react-router-dom react-hook-form zod @hookform/resolvers zustand recharts lucide-react clsx class-variance-authority tailwind-merge tailwindcss-animate i18next react-i18next i18next-browser-languagedetector vite-plugin-pwa react-helmet-async
npm install -D tailwindcss postcss autoprefixer @types/node @playwright/test vitest @testing-library/react jsdom
npx tailwindcss init -p
```

**Step 13.2.5 — Add shadcn/ui**

```
npx shadcn-ui@latest init
npx shadcn-ui@latest add button input form dialog
```

**Step 13.2.6 — Install Supabase CLI**

```
brew install supabase/tap/supabase
supabase login
```

**Step 13.2.7 — First commit**

```
code .
```
In VS Code's terminal:
```
git add .
git commit -m "chore: scaffold V3 — Vite + React + TS + Tailwind + shadcn/ui"
git branch -M main
git push -u origin main
```

**Step 13.2.8 — GitHub Pages deployment (V2 pattern, continuity)**

V3 uses GitHub Pages (same as V2). Setup:

1. In your `cropsintel-v3` repo on GitHub: **Settings** → **Pages** → Source: **GitHub Actions**.
2. In your local repo, create `.github/workflows/deploy.yml`:
   ```yaml
   name: Deploy to GitHub Pages
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
         - run: npm ci
         - run: npm run build
           env:
             VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
             VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
         - uses: actions/upload-pages-artifact@v3
           with:
             path: dist
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```
3. In GitHub repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - **No `VITE_*KEY` for AI providers, ever** — those live in Supabase edge function secrets.
4. Add a `public/CNAME` file containing `cropsintel.com` (V2 pattern).
5. Push to main. Workflow runs. Deployment available at `https://muzammil691.github.io/cropsintel-v3` initially; flip to cropsintel.com at end of Phase 1.

**Why GitHub Pages over Vercel** (Round 2 decision): you already use GitHub Pages for V2; same workflow, no new account. Trade-off: no per-PR preview URLs, no built-in env-var UI (use repo secrets instead). Fine for V3.

**Step 13.2.9 — Railway setup for Adela (the always-on background worker)**

Adela is a separate Node.js process (not the Vite app). It runs scrapers, processes data, and generates AI insights on a schedule. Railway hosts it.

1. Create a separate GitHub repo: `cropsintel-v3-runner`. (Or a `runner/` folder in the main repo with its own Railway config.)
2. `https://railway.app/` → sign in with GitHub.
3. **New Project** → **Deploy from GitHub repo** → pick `cropsintel-v3-runner`.
4. Railway auto-detects Node. Set **Start Command** to `node src/runner.js` (or whatever your entry file is).
5. **Variables** tab → add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side, full DB access — Railway holds it, never goes to browser)
   - `STRATA_USERNAME`, `STRATA_PASSWORD`, `STRATA_BASE_URL`
   - `INTEL_EMAIL`, `INTEL_EMAIL_PASSWORD`, `INTEL_IMAP_HOST`, `INTEL_IMAP_PORT`, etc.
   - `MAXONS_MARGIN_PERCENT`
   - **NO Anthropic / OpenAI / Gemini keys here either** — Adela calls the Supabase edge function for AI work, just like the frontend does.
6. **Deploy**. Railway runs `runner.js` and keeps it alive.
7. Logs tab shows live output. Auto-restarts on crash.
8. Cost: ~$5-20/month depending on resource usage.

### 13.3 Daily commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server. `http://localhost:5173`. |
| `npm run build` | Production build. |
| `git status` / `git add .` / `git commit -m "..."` / `git push` | Standard git flow. |
| `npx supabase db push` | Apply migrations. |
| `npx playwright test` | Run e2e tests. |

---

## 14. Day-to-day workflow with Cowork

### 14.1 Morning (5-15 min)

1. Open Cowork.
2. "Resume V3 work — read master plan and tell me current phase + current task."
3. Cowork loads memory, opens master plan, opens current scope doc.
4. Cowork: "We are in Phase X. Current task is Y. Recommended next is W."
5. Accept / push back / ask question.

### 14.2 Work block (15 min - 4 hours)

1. Read scope doc.
2. Cowork generates Lovable-ready prompt OR makes edit directly.
3. Scope Guardian (D2) reviews → Block / Flag / Allow.
4. Execute. Commit + push.
5. Vercel auto-deploys preview URL.
6. Cowork verifies (Playwright, scripts/).
7. Mark task done.

### 14.3 Evening (5 min)

1. Cowork summarizes shipped today.
2. Decide tomorrow's first task.
3. Cowork updates memory if state changed.

### 14.4 Background work

- **Cowork only runs when invoked.** No polling.
- **Adela (V3's Node runner) runs in background** once V3 is in production.
- **The V3 build itself still requires Cowork invocation.**
- Path to closer-to-background: scheduled-tasks MCP, Twilio-via-WhatsApp pings, Phase 4's Atlas-Pro.

### 14.5 Cowork NEVER does without explicit approval

- Modify GitHub / GitLab visibility or permissions
- Rotate API keys
- Send WhatsApp messages to customers
- Make payments / transfers
- Change DNS records
- Approve self-improvement changes (Phase 4)
- Add scope creep into MAXONS App territory (e.g., "let's also add Sale Contract issuance to V3 while we're here") — Scope Guardian blocks

---

## 15. Realistic timeline

| Phase | Optimistic | Realistic | Pessimistic |
|---|---|---|---|
| Phase 0 (stop the bleeding) | 2 days | 1 week | 2 weeks |
| Phase 1 (V3 Market Intelligence MVP) | 10 weeks | **14-16 weeks** | 22 weeks |
| Phase 2 (CRM Intelligence + Atlas + tracked-deals) | 10 weeks | **14 weeks** | 22 weeks |
| Phase 3 (Portals + Position Book + Variance + advanced AI) | 10 weeks | **14 weeks** | 22 weeks |
| Phase 4 (social network + Atlas-Pro + multi-commodity) | 12 weeks | **20+ weeks** | open-ended |
| **Total to Phase 4** | ~10 months | **~15 months** | **~24+ months** |

**Why this shrinks vs v1.1:** v1.1 included BC integration + 11 workflow execution flows + bank document presentation. v1.2 removes all of that — V3 is CropsIntel only, not MAXONS App. Phase 2 + Phase 3 each shed roughly 8 weeks of scope.

**Honest, not pessimistic:**
- V1 took 6 weeks of heavy Lovable iteration to reach current state — V3 starts fresh and uses Cowork+Code, slower per change but more controlled.
- Muzammil is learning Node, Vite, Git, VS Code, npm — there's a learning curve in early Phase 1.
- 10-20 hours/week realistic alongside running Maxons.

---

## 16. Scope discipline — what we will NOT build

### 16.1 In Phase 1 we will NOT

- Build CRM admin features (offers, inquiries) — Phase 2
- Build subscriber CRM features — Phase 2
- Build Atlas self-management — Phase 2
- Build Variance engine — Phase 3
- Build external portals — Phase 3
- Run Multi-Brain on every chat
- Skip i18n, PWA, migrations, e2e tests
- Add a parallel restart inside V3

### 16.2 In every phase we will NOT

- Put AI provider keys in `VITE_*` env vars
- Ship source maps to production
- Skip RLS on a new table
- Add an offer/inquiry/deal without companies + contacts + canonical_products in place first
- Add a feature without multi-commodity-aware schema
- Add a feature without model-aware schema (A/B/C)
- Park a broken implementation next to a fresh restart
- Promise a date we don't believe
- Use Lovable for V3 production code
- Allow another admin tier
- Roll back to V1
- **Add ANY MAXONS App feature** — Sale Contract issuance, Purchase Contract issuance, BC posting, bank doc presentation, payment instruction APIs, e-signature, carrier booking. ALL of those are out of V3 scope forever. Scope Guardian blocks.

### 16.3 We will NEVER (across all phases)

- Build backend accounting ledgers
- Build crypto/blockchain anything
- Build public APIs without verification gates
- Allow customers to see broker source, supplier source, or margin structure
- Allow brokers to see customer-specific pricing
- Allow suppliers to see customer-specific pricing or margin
- Skip the WhatsApp video+OTP gate on self-improvement (Phase 4)
- Take a financial action on Muzammil's behalf
- Reactivate V1 as customer-facing surface
- Integrate with BC (it's MAXONS App's domain)
- Execute MAXONS App workflows (3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)

---

## 17. Master plan change log

| Date | Author | Version | Change | Reason |
|---|---|---|---|---|
| 2026-04-28 | Cowork | v1.0 | Initial creation | Synthesis of briefing + V1/V2 audits + comparative |
| 2026-04-28 | Cowork | v1.1 | (1) Integrated MAXONS_Workflow_v1.docx in full as scope. (2) Removed "DNS rollback to V1" from Phase 0. (3) Added BC integration architecture, 8 functional departments as V3 user surfaces, 15 workflows as V3 build scope. (4) Timeline grew from 14 → 20 months realistic. | User uploaded MAXONS_Workflow_v1.docx + directive: integrate workflow + remove V1 rollback + clean V3 rebuild |
| 2026-04-28 | Cowork | v1.2 | (1) Reframed: V3 = CropsIntel STANDALONE, not MAXONS App. (2) MAXONS Workflow doc is **knowledge reference**, not blueprint. (3) Removed BC integration as V3 component. (4) Removed 8 functional departments as V3 user surfaces. (5) Removed 11 workflow execution flows from V3. (6) Reframed 3 portals as CropsIntel subscriber portals. (7) Phase 2 + Phase 3 scope shrank significantly. (8) Timeline: ~20 months realistic → ~14 months realistic. (9) Removed O9, O10, O14, O15, O16 — all moot. | User clarified: "WE ARE BUILDING CROPSINTEL ... MAXONS DOCS ARE FOR KNOWING THE PROCESS ONLY" |
| 2026-04-28 | Cowork | v1.3 | Round 2 polish — (1) V3 frontend hosting = GitHub Pages. (2) V3 Supabase = brand-new project. (3) Adela runtime host = Railway. User initially picked Mac; Cowork pushed back honestly; user reconsidered. Updated section 13.2.8 to GitHub Pages workflow YAML. Added 13.2.9 Railway setup. (4) Resolved O3, O4, O5. | Round 2 polish |
| 2026-04-28 | Cowork | v1.4 | Round 3 polish — caps + verified-tier + 13 Zyra modules. Resolved O6, O7, O8. | Round 3 polish |
| 2026-04-28 | Cowork | **v1.5+execution corrections** | Plan locked, Phase 0 closed (deferred per user), Phase 1 execution started. Live corrections during Phase 1.2 scaffold: (a) **Tailwind 3.4 → Tailwind 4.** Master plan section 1.1 said "Tailwind 3.4" matching V1, but shadcn 4.6 (current as of 2026-04) requires Tailwind 4 with new CSS-based config. Migrated mid-scaffold: uninstalled tailwindcss + postcss + autoprefixer, installed `tailwindcss@^4` + `@tailwindcss/vite`, removed `tailwind.config.js` + `postcss.config.js`, updated `vite.config.ts` to use `@tailwindcss/vite` plugin, replaced `src/index.css` to use `@import "tailwindcss";`. (b) **Path aliases manually added** to `tsconfig.json` + `tsconfig.app.json` + `vite.config.ts` for `@/* → ./src/*` (shadcn requires this; Vite TS template doesn't ship with it). (c) **vite-plugin-pwa skipped from initial install** — incompatible with Vite 8; will add in Phase 1 sub-task 1.13 when compatible version exists or Vite is pinned. (d) **shadcn preset locked: Radix + Nova (Lucide + Geist).** | Live corrections during execution; original master plan was Tailwind-3-anchored which was incorrect for 2026 toolchain |

### v1.6 — 2026-05-07 (evening session, Dubai)

**Why bumped:** WP-0 quality-gate retro shipped today; user has explicit UX requests that need to be in the canonical plan before queueing; the Claude Code build prompt's WP-1/2/3 sequence needs to be reconciled with the existing Phase 1.3/1.6/1.7/1.8/1.10 numbering.

**What changed:**
- Status moved from "locked, execution begins" to "execution in flight."
- Section 11 gains sub-section 11.7 (live execution log; renumbered from spec's "11.3" to avoid collision with existing 11.3 = Phase 2 CRM).
- Phase 1.10aa-ad added (UX polish queue).
- WP-0 retro entry recorded.
- WP-1/WP-2/WP-3 explicitly mapped to existing phase numbering — no new phase numbers, just clarifying which existing phases are which work-package.

**What did NOT change:**
- Sections 1-10 (north star, foundation rules, data foundation, agent architecture, AI routing) untouched.
- The five immutable rules unchanged.
- Multi-commodity Day-1 constraint unchanged.
- Cost cap ($400/month) unchanged.
- All previously-shipped specs and decisions unchanged.

**Source of changes:**
- 2026-05-07 morning session — WP-0 fix work (Designer Anthropic key rotation, the 7-bug fix plan from `AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md`).
- 2026-05-07 evening session with Cowork (Claude.ai) — user requested Plan tab intelligence, Queue expansion, chat upgrade (voice + tool-call display), attachments. User explicitly approved 4-spec bundling and "write tonight, queue when safe" gate.

**Approved by:** Muzammil Akhtar, 2026-05-07 evening, via Cowork session.

---

## 18. Open questions to resolve before Phase 1 starts

After Round 1 of polishing, these remain (rounds 2-5 still to go):

| # | Question | Who answers | When |
|---|---|---|---|
| O1 | (RESOLVED 2026-04-28 in execution mode — V2's runner is NOT running anywhere. launchd / ps / cron / history all empty. The "Autonomous V2" tag is marketing only. V3 Adela on Railway is a first deploy, not a migration.) | — | — |
| O2 | Has anyone used the leaked AI keys yet? Any unusual spend in last 6 days? | Muzammil + provider dashboards | During P0 |
| O3 | (RESOLVED v1.3 — GitHub Pages) | — | — |
| O4 | (RESOLVED v1.3 — Railway, ~$5-20/month) | — | — |
| O5 | (RESOLVED v1.3 — brand-new V3 Supabase project) | — | — |
| O6 | (RESOLVED v1.4 — defensive 9 + behavioral 4 = 13 modules in Phase 1) | — | — |
| O7 | (RESOLVED v1.4 — $200/$50/$50/$100 = $400/month) | — | — |
| O8 | (RESOLVED v1.4 — manual review by Maxons team; verified-review queue UI in Phase 1.11b) | — | — |
| O9-O10 | (RESOLVED in v1.2 — BC live for MAXONS App, not V3 scope) | — | — |
| O11 | (RESOLVED in v1.2 — CropsIntel meta-platform parked to v4; V3 is standalone) | — | — |
| O12 | Headcounts per of 8 MAXONS departments — relevant only for the seed data of `mx_departments` reference table | Muzammil | Round 5 (low priority) |
| O13 | Decision-rights thresholds — same; reference data only | Muzammil | Round 5 (low priority) |
| O14-O16 | (RESOLVED in v1.2 — out of V3 scope) | — | — |

Round 1 resolved: O9, O10, O11, O14, O15, O16. Eight questions remain across Rounds 2-5.

---

## 19. The first week's concrete tasks

When you say "begin Step 1 of execution":

1. **P0.1-P0.7** — rotate keys, set spend limits, check billing.
2. **P0.16** — make V1's GitLab repo private again.
3. **P0.8** — decide Path A vs Path B from section 3.2.
4. **P0.9 implementation** of chosen path.
5. **P0.10-P0.15** — verify clean.
6. **13.1.1-13.1.4** — install Node, VS Code, set up Git on your Mac (parallel with P0).
7. **Resolve open questions O1-O8** (rounds 2-5 of polishing).
8. **THEN** Phase 1 sub-task 1.2 begins.

Until you say "begin Step 1 of execution," I do nothing further.

---

**End of master plan v1.2.**
