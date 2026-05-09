---
phase: 1.10ba
title: Cockpit polish — visible action buttons + chat-style multi-turn wizard + workshop framing
status: planned
gate: in-progress count <= 2
order: 3-of-3 morning batch (parallel with V1 build)
estimated_builder_minutes: 30
estimated_cost_usd: 5
master_plan_section: 11.7 (Atlas internal infrastructure, Phase 2 territory but ships now for V1 productivity)
launch: infra
---

# Phase 1.10ba — Cockpit polish

## Why this exists

The cockpit (1.10aj) shipped 11 components — ConceptsPanel, PhaseWizard, PlanActionButtons, BuildRunnerModal, IdeaFileDrawer, PlanGraphView, PlanNodeDetail, PlanToolbar, PlanTree, PlanNodeActions, PhaseApprovalBanner. **All the infrastructure exists.** But on Muzammil's live dashboard (verified 2026-05-09 morning):

1. **Action buttons (Add/Modify/Follow/Revisit) are invisible until hover and look like tiny dots**, not actionable buttons. Users don't see they exist.
2. **The wizard hits a 500 error** ("wizard_sessions insert failed: Could not find the table") — fixed by Muzammil applying SQL manually 2026-05-09 morning, but UI is still single-pass form, not chat-style multi-turn that 1.10am engine code supports.
3. **No clear "this is a planning workshop" framing** — page reads as a read-only viewer.
4. **Concept-to-wizard handoff invisible** — saved concepts in panel don't visibly feed wizard.

This spec polishes the existing components into a real workshop UX. **No new components — just visibility, layout, and flow polish on what's shipped.**

This is Atlas internal tooling (master plan §11.7 is in Phase 2 territory), but it ships now because cockpit productivity drives every CropsIntel V1 spec going forward.

## The 5 rules check (V3-CODING-INSTRUCTIONS §0)

1. **Foundation-first.** Touches existing cockpit components only. wizard_sessions table foundation exists (Muzammil applied 2026-05-09).
2. **Anti-restart.** Polishes 6 existing files. Zero new components. Strict in-place fix.
3. **Multi-commodity from Day 1.** N/A — internal tool, no commodity tables touched.
4. **AI keys server-side only.** N/A — internal tool, the wizard's Claude call goes through Atlas's existing edge-function-equivalent (Atlas server-side only).
5. **Information walls.** This is admin-only tooling (`requireRole: 'admin'`). No customer/broker/supplier data exposure.

## Foundation-first check

- ✅ All 11 cockpit components exist
- ✅ wizard_sessions table exists (applied 2026-05-09 morning)
- ✅ Multi-turn wizard engine exists (1.10am)
- ✅ Idea file lives at `.agent/idea.md` (1.10al)
- ✅ GitHub repo reader (1.10ak)
- ✅ Concepts table populated (1.10aj + manual SQL 2026-05-09)
- ❓ Action buttons not surfaced — UI fix
- ❓ Wizard chat-style multi-turn UI — engine exists, UI doesn't fully expose it

## What ships

### 1. Always-visible action buttons (no hover required)

`src/components/atlas-plan/PlanActionButtons.tsx` — refactor:

**Current:** buttons appear on row hover as small icons, easy to miss.

**Polish:** render buttons inline next to phase title, always visible:

```
[1.3] Pilot commodity (almonds) and multi-commodity     [+ Add]  [✎ Modify]  [⚑ Follow]  [↺ Revisit]
```

- Use shadcn/ui Button with size="sm", explicit text labels
- Color-coded:
  - Add: `variant="ghost"` (subtle)
  - Modify: `variant="outline"` (visible)
  - Follow: `variant="default"` with emerald background (primary action — queues for build)
  - Revisit: `variant="outline"` with amber border (defer marker)
- Mobile (< 1024px): collapse to icon-only with tooltip — never go invisible
- Use `cn()` from `@/lib/utils` per V3 conventions

### 2. Workshop mode header

`src/components/atlas/tabs/AtlasPlanTab.tsx` — add framing strip at top:

```
┌─────────────────────────────────────────────────────────────────┐
│ 📐 Planning Workshop                                            │
│ Drop a concept, refine phases through the wizard, queue clean   │
│ builds. Atlas reads idea file + master plan + repo.             │
│                                                                 │
│ Steps:  ① Concept  →  ② Wizard  →  ③ Follow  →  ④ Build        │
└─────────────────────────────────────────────────────────────────┘
```

Below this strip, keep the existing filter pills + tree/graph toggle untouched.

The strip is collapsible — first visit it's expanded, user can collapse via "X" to a thin status bar.

### 3. Wizard chat-style multi-turn UI

`src/components/atlas-plan/PhaseWizard.tsx` — refactor modal:

**Current:** single-page form (or single-shot question modal).

**Polish:** chat-style modal that drives 1.10am's multi-turn engine:

```
┌─ Modify phase: 1.3 Pilot commodity (almonds)  ────────  ✕ ─┐
│                                                              │
│  Atlas: I've read the master plan + idea file + repo.       │
│         For this phase, what's the primary user role?        │
│                                                              │
│         ⚪ Customer    ⚪ Supplier    ⚪ Broker               │
│         ⚪ Other (free text)                                 │
│                                                              │
│  You:   Customer                                             │
│                                                              │
│  Atlas: For customers in your top 3 markets (Gulf, India,    │
│         Central Asia), do you want price-discovery first     │
│         or relationship-first onboarding?                     │
│                                                              │
│         ⚪ Price-first    ⚪ Relationship-first              │
│         ⚪ Both equally  ⚪ Other                            │
│                                                              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  Clarity: 73%                       │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │ Pick option above OR type your own answer...   │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│             [Skip]   [Generate spec when ready ✓]           │
└──────────────────────────────────────────────────────────────┘
```

Mechanics:
- Q/A bubbles render as chat messages (user-right, Atlas-left)
- Each Atlas question presents radio options + free-text fallback
- After answer: "Atlas is thinking..." for 1-2s, next question appears below
- Clarity bar progresses (driven by 1.10am engine's `current_clarity` field)
- "Generate spec when ready" enables when `clarity >= 90`
- Multi-turn engine code from 1.10am drives behavior — UI just renders the loop

Use existing UI primitives: `Dialog` from shadcn for modal, `RadioGroup`, `Textarea`, `Button`, `Progress` (Progress is already in shadcn — confirm or add).

### 4. Concept-to-wizard explicit handoff

`src/components/atlas-plan/ConceptsPanel.tsx` + wizard integration:

When concept card is hovered, show "Use in wizard" button.

When clicked WHILE wizard modal is open: concept content gets injected into wizard's history as a system context message:

```
[System context from concept "crops intel v1 clean build" (binance style):]
<concept content here>
```

Atlas's next question references the concept: *"You've saved a concept tagged 'binance style' about CropsIntel V1 — should this phase follow that style direction?"*

When clicked WHILE no wizard open: opens dropdown "Which phase to wizard with this concept?" → list of plan nodes → opens wizard for selected phase with concept pre-loaded as first context.

### 5. Build button context awareness

`src/components/atlas-plan/BuildRunnerModal.tsx` + the Build button at bottom:

**Current:** Build button always visible, opens modal even with empty queue.

**Polish:**
- When zero phases marked Follow: button disabled with helpful text "Click Follow on a phase to enable build"
- When ≥1 phases Follow: button shows count "Build (3 phases queued)"
- Click → BuildRunnerModal opens showing:
  - Phases in topological + launch-tier order (1.0-alpha first, etc.)
  - Per-phase Builder time estimate (calibrated)
  - Per-phase confirmation toggle: "Approve all" or "Confirm each"
  - "Pause after launch tier" option (1.0-alpha → pause for review → 1.0-beta)

WhatsApp + dashboard + chat hooks already exist in 1.10aj — verify they fire on each "approve" event.

### 6. Dashboard meta-fixes

Small things spotted during this session:

- "View vision" button at top of Plan tab should open `IdeaFileDrawer` — wire if not already wired
- Filter pill counts (All / Shipped / Queued / Planned / Blocked) should match real numbers — verify accuracy
- Hover state on plan rows should be subtle but present (visual feedback for clickability)

### 7. Tests

`e2e/cockpit-polish.spec.ts`:

- (a) Plan tab loads, Add/Modify/Follow/Revisit buttons visible without hover.
- (b) Click Add on Phase 1.3 → wizard modal opens with chat-style UI (not form).
- (c) Answer Q1 → Q2 appears below it in same modal, depends on Q1 answer.
- (d) Clarity bar advances each turn.
- (e) Click "Use in wizard" on a concept while wizard open → context injected, next question references concept.
- (f) "Generate spec when ready" enabled when `clarity >= 90`.
- (g) Click Follow on a phase → status updates, Build button shows count.
- (h) Click Build with 0 followed → button is disabled, tooltip explains.
- (i) Click Build with 3 followed → BuildRunnerModal shows 3 phases in order.
- (j) Workshop strip visible at top, collapsible.

## Acceptance criteria

- All 5 rules satisfied.
- Action buttons visible on every row without hover.
- Workshop mode header visible (and collapsible).
- Wizard runs chat-style multi-turn (not single-page form).
- Clarity bar visible and updates.
- Concept-to-wizard handoff works both ways (open wizard / no open wizard).
- Build button disabled when no Follow; enabled with count when Follow.
- BuildRunnerModal shows topological + launch-tier order.
- 10 e2e tests pass.
- `npm run build` clean.
- Spec lands in `done/`.

## Out of scope

- Building net-new components — work with existing 11 from 1.10aj/al/am/an.
- Voice input in wizard (defer).
- Multi-user collaborative wizard (single-user).
- Wizard for retrospective specs.
- Backend logic changes (1.10am's domain).
- Customer-facing UI changes (this is admin-only Atlas tooling).
- Mobile-optimized cockpit (cockpit is desktop tooling primarily).

## Files touched (estimate)

- `src/components/atlas-plan/PlanActionButtons.tsx` — visibility + labels (~50 lines refactored)
- `src/components/atlas/tabs/AtlasPlanTab.tsx` — workshop header + Build button states (~30 lines added)
- `src/components/atlas-plan/PhaseWizard.tsx` — chat-style UI (~80 lines refactored)
- `src/components/atlas-plan/ConceptsPanel.tsx` — Use-in-wizard handoff (~20 lines added)
- `src/components/atlas-plan/BuildRunnerModal.tsx` — order + tier-aware (~40 lines refactored)
- 1 e2e test file

Total: **~6 files**, all extends/refactors. **Zero new files** (per anti-restart rule).

## Realistic Builder time

UI-only spec on existing components. **25-35 min Builder**, ~5 min Verifier, ~5 min Designer (UI-heavy but small surface). Wall clock ~45 min. Cost ~$4-7.

## Dependencies

- 1.10aj cockpit shipped ✅
- 1.10am wizard engine shipped ✅
- 1.10al idea file shipped ✅
- 1.10ak GitHub reader shipped ✅
- 1.10az verifier db_write_failed fix shipped ✅
- wizard_sessions SQL applied ✅ (Muzammil 2026-05-09)
- concepts table populated ✅ (Muzammil 2026-05-09)
