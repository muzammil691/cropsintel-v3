# Master Plan v1.6 — incremental update (2026-05-07)

This document is the **diff** to append to `.agent/master-plan.md` to bring it to v1.6. It follows Section 17 (change log) discipline: every change is incremental and sourced.

---

## Steps to apply (Muzammil + Claude Code)

1. Open `.agent/master-plan.md` in VS Code.
2. Find the line near the top: `**Status:** v1.5 — locked. Polish phase complete. Execution begins.`
3. Replace it with: `**Status:** v1.6 — execution in flight. WP-0 quality-gate fixes shipped 2026-05-07; UX polish queue + WP-1/2/3 sequence locked.`
4. Find the line: `**Inputs added in v1.4:** ...`
5. Add this new line directly after it:
   ```
   **Inputs added in v1.6:** WP-0 quality-gate retro entry (2026-05-07); Claude Code build prompt with WP-1/2/3 sequence (2026-05-07); user UX requests for Plan tab progress intelligence, Queue card expansion, Chat conversation upgrade, Chat attachments (2026-05-07 evening session)
   ```
6. Find Section 11 (`## 11. V3 build sequence`).
7. Append the new sub-section below at the end of Section 11.
8. Find Section 17 (`## 17. Master plan change log`) and append the new change log entries shown below.
9. Save, commit with message: `docs(plan): bump master plan to v1.6 — WP-0 retro, WP-1/2/3 sequence, UX polish queue`.

---

## NEW SUB-SECTION — append at end of Section 11

### 11.3 Execution log — what shipped, what's queued, what's next (live)

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

## NEW CHANGE LOG ENTRIES — append at end of Section 17

### v1.6 — 2026-05-07 (evening session, Dubai)

**Why bumped:** WP-0 quality-gate retro shipped today; user has explicit UX requests that need to be in the canonical plan before queueing; the Claude Code build prompt's WP-1/2/3 sequence needs to be reconciled with the existing Phase 1.3/1.6/1.7/1.8/1.10 numbering.

**What changed:**
- Status moved from "locked, execution begins" to "execution in flight."
- Section 11 gains sub-section 11.3 (live execution log).
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
