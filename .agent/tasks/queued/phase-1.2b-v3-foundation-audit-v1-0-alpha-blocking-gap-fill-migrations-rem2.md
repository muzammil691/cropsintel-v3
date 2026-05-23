---
priority: 1
remediation: true
remediation-attempt: 2
---
# 1.2b: V3 Foundation Audit & V1.0-alpha-blocking gap-fill migrations

_launch tier: v1.0-alpha_

## Context

Phase 1.2 shipped the 12-table foundation (`20260428000001_v3_foundation`). Phases 1.3a/1.3b/1.10bb extended it. The live Supabase project `hzrnohsxigrqlmzegwlb` now contains ~80 tables — a mix of V3 foundation, Phase 1.3a/b extensions, cockpit/atlas infrastructure, and V1/V2 legacy carry-over that was never cleaned up. Before Phase 1.3c manual steps complete and Phase 1.4 (RBAC audit) begins, V3 needs an explicit, evidence-based audit of which §4.1 entities are present, correctly shaped, and which gaps block V1.0-alpha shipping.

Phase 1.10bb's retro is the proximate driver: undetected migration drift silently broke the Verifier write path for 15 days. The same failure mode (plan vs. live-DB divergence with no surfacing mechanism) likely exists across other §4.1 entities. This phase produces the surfacing mechanism.

## In scope

**Audit scope (full visibility):** All 15 entities in master plan §4.1 — commodities, companies, contacts, canonical_products, relationships, profiles, offers, offer_lines, inquiries, tracked_deals, positions, market_intelligence, zyra_conversations, communications, exceptions/observations. Plus Phase 1.3a/b extensions (verification_requests, guest_sessions, auth_bridge_log, chat_sessions) and the universal multi-commodity FK rule (`commodity_id uuid NOT NULL REFERENCES commodities(id)`) on every domain table.

**Migration drafting scope (narrow, V1.0-alpha-blocking only):** A gap is V1.0-alpha-blocking iff it prevents shipping auth (signup/login/OTP), RBAC (Tier 1/2/3), verified-user queue, V2 user migration via auth_bridge_log, or the read-only `/insights` surface (commodities, news_items, market_intelligence, prices). Per idea.md Tier 1 row + runtime-state.md §Next up.

**Gap categorization (universal, applied to all 15 entities):**
- PLAN-AHEAD — plan describes table/column missing from live DB. V1.0-alpha-blocking → draft migration. Phase 2/3 → report only.
- DB-AHEAD — live DB has table/column the plan doesn't mention. Flag for follow-up workshop, do NOT migrate, do NOT update plan.
- INTENTIONAL-DIVERGENCE — divergence documented in follow-ups, runtime-state notes, or V1/V2 legacy carry-over per framing. List with citation.
- AMBIGUOUS — divergence with no clear cause. Highest-attention. Full context to open-questions doc.

**Multi-commodity FK check:** Universal. Applied to all 15 entities regardless of phase. Missing `commodity_id` on a Phase 2/3 table flagged PLAN-AHEAD but NOT migrated in this phase.

## EXECUTION METHOD (non-negotiable)

**5-step Snapshot Verification Gate flow:**

1. **Agent drafts introspection SQL** → commits to `scripts/audit-live-schema.sql`. Read-only queries against `information_schema` and `pg_catalog` only. NO queries against user data tables. Idempotent. Outputs structured JSON or CSV covering: table list, column list per table (name, type, nullable, default), FK constraints, indexes, RLS policy presence (existence + table coverage, NOT contents). One file, reviewable in one read.

2. **Muzammil runs** `scripts/audit-live-schema.sql` in Supabase Studio SQL Editor for project `hzrnohsxigrqlmzegwlb`. Saves output as `.agent/audit/live-schema-snapshot-YYYY-MM-DD.json`.

3. **Muzammil commits snapshot** to git. Single small commit.

4. **Agent runs Snapshot Verification Gate** (automated sanity checks, code-level, NOT human round-trip):
   - Snapshot covers expected ~80 tables (count check vs. `information_schema` row count returned in snapshot itself)
   - Every entity in master plan §4.1 either appears in snapshot OR has explicit "not present" row
   - RLS policy enumeration succeeded for every table with RLS enabled (no silent permission failures)
   - Multi-commodity FK check returned data for all domain tables (no nulls swallowed)
   - **If ANY check fails:** agent writes `".agent/audit/snapshot-incomplete-YYYY-MM-DD.md"` listing required snapshot adjustments. Stops. Does NOT proceed to step 5.
   - **If ALL checks pass:** agent proceeds to step 5.

5. **Agent drafts outputs:**
   - `.agent/audit/gap-report-YYYY-MM-DD.md` — every §4.1 entity categorized PLAN-AHEAD / DB-AHEAD / INTENTIONAL-DIVERGENCE / AMBIGUOUS with citations.
   - **Migration files** for V1.0-alpha-blocking PLAN-AHEAD gaps only. One file per gap. Timestamp-unique at minute resolution, generated via `date -u +%Y%m%d%H%M%S` at draft time, checked against existing `supabase/migrations/` filenames for collision BEFORE writing.
   - `.agent/audit/open-questions-YYYY-MM-DD.md` — DB-AHEAD + AMBIGUOUS items for follow-up workshop.
   - `docs/phase-1.2b-manual-steps.md` — apply instructions (see template below).

## Migration file template (mandatory for every drafted file)

Every new domain table MUST include:
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `commodity_id uuid NOT NULL REFERENCES commodities(id)` (V3-CODING-INSTRUCTIONS rule #3)
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;`
- At least one RLS policy (Scope Guardian §4.4 item 3)
- Filename timestamp > max(existing supabase/migrations/ timestamps)
- Migration drafted but NOT applied (human-gated Studio apply per Phase 1.10bb learning — `supabase db push` forbidden)

## docs/phase-1.2b-manual-steps.md required structure

1. **Apply order** with dependency reasoning per step (e.g., Step 1: news_items — no FK deps; Step 2: prices — depends on commodities already shipped)
2. **Full SQL contents INLINE per step** — Muzammil should not need to open any other file to copy SQL into Studio
3. **Per-step verification SQL** — short `SELECT` against `information_schema` confirming each migration landed (e.g., `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='news_items' ORDER BY ordinal_position`)
4. **Per-step failure-recovery note** — if step fails, what's the rollback?

## Out of scope (deferred)

- **Phase 2/3 entity migrations:** tracked_deals, positions, communications, exceptions/observations, offers, offer_lines, inquiries, companies, contacts, relationships. Audited for visibility + multi-commodity FK presence; NOT migrated in 1.2b.
- **position_reports:** V1.0-beta scope per idea.md line 21 + runtime-state.md §Next up (Phase 1.6 Adela data spine). If missing → PLAN-AHEAD (no draft). If present → INTENTIONAL-DIVERGENCE (V1 carry-over, identify-only).
- **Orphaned V1/V2 table cleanup:** identify only, do NOT drop (per framing). Cleanup is a separate future phase with its own approval gate.
- **Plan updates from DB-AHEAD findings:** open-questions doc only; no plan edits from this phase.
- **Applying any drafted migration:** human-gated via Supabase Studio per Phase 1.10bb learning. `supabase db push` forbidden.
- **Granting Builder direct prod DB read access:** rejected per Turn 2 (preserves 1.10bb human-gated DB access principle).

## PRE-FLIGHT

- Confirm 7/7 Railway services healthy (Atlas, Builder, Verifier, Designer, Adela, Council, Memory) plus frontend.
- Confirm `scripts/audit-live-schema.sql` is committed before Muzammil runs in Studio.
- Confirm no existing `supabase/migrations/` filename collisions before drafting any new migration.

## Acceptance criteria

1. `scripts/audit-live-schema.sql` committed; read-only against `information_schema`/`pg_catalog` only; idempotent (running twice produces identical output).
2. `.agent/audit/live-schema-snapshot-YYYY-MM-DD.json` committed by Muzammil after Studio run.
3. Snapshot Verification Gate PASS recorded in `.agent/audit/gate-result-YYYY-MM-DD.md`. If FAIL, snapshot-incomplete doc exists and no gap report drafted.
4. `.agent/audit/gap-report-YYYY-MM-DD.md` categorizes all 15 §4.1 entities + Phase 1.3a/b extensions as PLAN-AHEAD / DB-AHEAD / INTENTIONAL-DIVERGENCE / AMBIGUOUS with citations to master plan §, idea.md line, runtime-state.md section, or framing.
5. Multi-commodity FK presence reported for all 15 §4.1 entities (PASS/FAIL/N-A-identity per entity).
6. Drafted migration files (if any) restricted to V1.0-alpha-blocking PLAN-AHEAD gaps only: subset of {commodities-extensions, news_items, market_intelligence-extensions, prices, profiles-extensions, user_roles-extensions, verification_requests-extensions, auth_bridge_log-extensions}.
7. Every drafted migration: timestamp-unique vs. existing files, includes commodity_id FK (if domain), includes created_at + updated_at, includes RLS enable + ≥1 policy, NOT applied.
8. `docs/phase-1.2b-manual-steps.md` exists with inline SQL, per-step verification SQL, per-step failure-recovery notes.
9. `.agent/audit/open-questions-YYYY-MM-DD.md` lists every DB-AHEAD and AMBIGUOUS finding for follow-up workshop.
10. `.agent/runtime-state.md` updated with audit completion timestamp + gap report path + list of drafted-but-not-applied migration filenames.

## Owner

Builder (autonomous: draft introspection SQL, run Snapshot Verification Gate, draft gap report + open-questions + migration files + manual-steps doc). Muzammil (manual: run SQL in Studio, commit snapshot, later apply migrations one-by-one in Studio per manual-steps doc).

## Estimated effort

~2-3 hours Builder autonomous (SQL drafting + snapshot processing + gap report + migration drafting + manual-steps doc). ~15 minutes Muzammil for Studio snapshot run + commit. Migration apply time deferred to follow-up (1 file × ~3 min Studio apply + verify each).

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-1.2b-v3-foundation-audit-v1-0-alpha-blocking-gap-fill-migrations` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: .agent/audit/live-schema-snapshot-YYYY-MM-DD.json exists
- Actual: .agent/audit/live-schema-snapshot-YYYY-MM-DD.json is missing
- Remediation: Create .agent/audit/live-schema-snapshot-YYYY-MM-DD.json per task spec

### Gap 2: files-exist
- Severity: `fail`
- Expected: .agent/audit/gap-report-YYYY-MM-DD.md exists
- Actual: .agent/audit/gap-report-YYYY-MM-DD.md is missing
- Remediation: Create .agent/audit/gap-report-YYYY-MM-DD.md per task spec

### Gap 3: files-exist
- Severity: `fail`
- Expected: .agent/audit/open-questions-YYYY-MM-DD.md exists
- Actual: .agent/audit/open-questions-YYYY-MM-DD.md is missing
- Remediation: Create .agent/audit/open-questions-YYYY-MM-DD.md per task spec

### Gap 4: files-exist
- Severity: `fail`
- Expected: .agent/audit/gate-result-YYYY-MM-DD.md exists
- Actual: .agent/audit/gate-result-YYYY-MM-DD.md is missing
- Remediation: Create .agent/audit/gate-result-YYYY-MM-DD.md per task spec

