---
phase: 1.10aa
title: Plan tab progress intelligence
status: planned
gate: in-progress count <= 5 AND no spec stuck >2h
estimated_builder_minutes: 120
estimated_cost_usd: 4
master_plan_section: 11.3
---

# Phase 1.10aa — Plan tab progress intelligence

## Why this exists

Today's Plan tab reads the master plan and shows a phase tree, but visually it's a flat list. Muzammil wants the Plan tab to be the single dashboard view that answers, at a glance: *what was built, what's in progress, what's next, what % through each phase, and what's been added on top of the original plan today.* Right now he has to mentally cross-reference master-plan.md, the Queue tab, the done/ folder, and chat history. That's the gap this spec closes.

## Foundation-first check

- ✅ `.agent/master-plan.md` exists and is canonical (just bumped to v1.6 — read first).
- ✅ `atlas_plan_node_state` Supabase table exists (state overlay).
- ✅ `src/components/atlas-plan/PlanTree.tsx`, `PlanNodeDetail.tsx`, `PlanGraphView.tsx`, `PlanToolbar.tsx` exist.
- ✅ `atlas/src/lib/plan-server.ts` and `plan-state.ts` exist (backend data).
- ✅ `src/components/atlas/tabs/AtlasPlanTab.tsx` is the consumer.

We are extending these, not replacing.

## What ships

### 1. Plan parser upgrade (`atlas/src/lib/plan-parser.ts`)

The parser already extracts the section tree from master-plan.md. Extend it to also extract:

- **Per-node phase number** (e.g., `1.10aa`, `1.6c`, `1.3`) — already extracted; keep.
- **Per-node `gate`/`depends_on` fields** if present in spec front-matter — new; nullable.
- **Per-node `estimated_builder_minutes` / `estimated_cost_usd`** — new; nullable.
- **NEW SECTION: "11.3 Execution log"** — the parser must now read this section and produce a flat list of `{phase, title, what_it_does}` entries that overlay onto the tree.
- **Today's additional work** — surface specs in `done/` whose mtime is today (UTC for repo, but display in user's local TZ — Asia/Dubai). Tag as `added_today=true`.

### 2. State overlay enrichment (`atlas/src/lib/plan-state.ts`)

The state loader currently joins `atlas_plan_node_state` rows. Extend to also compute, per node:

- **`children_total`** — count of `done/` + `in-progress/` + `queued/` + `failed/` + `cancelled/` specs whose phase number is a prefix-child of this node.
- **`children_done`** — count of those that are in `done/`.
- **`percent_complete`** — `children_done / children_total * 100`, rounded to integer. Null if `children_total = 0`.
- **`active_child`** — name of the spec currently in `in-progress/` for this branch, if any.
- **`last_shipped_at`** — most recent `done/` spec's git-commit timestamp for this branch.

Cache these per-request; do not recompute on every API call. Use a 30-second TTL.

### 3. New API endpoint (`GET /atlas/plan?include=progress`)

Extend the existing `/atlas/plan` endpoint to accept `?include=progress`. When set, response includes the new fields per node. Backward compatible — existing callers without the flag get today's response shape.

### 4. PlanTree.tsx — visual upgrade

This is the meat. The tree currently renders nodes as flat rows with status pills. Upgrade to:

- **% ring** next to each node title — SVG progress ring, 24×24, stroke matches status color.
- **Color intensity by progress** — node row background uses `bg-emerald-50` at 0%, `bg-emerald-100` at 50%, `bg-emerald-200` at 100% (and equivalent slate/amber/rose ramps for queued/blocked/failed).
- **Active-child indicator** — if `active_child` is non-null, render a small pulsing green dot + the spec name as a sub-line under the node title.
- **"Added today" badge** — small amber pill `+ today` on nodes whose `added_today=true`.
- **Last shipped timestamp** — relative time (`2h ago`, `yesterday`) rendered subtly to the right.

Do NOT change the existing collapse/expand behavior, drag-to-reorder, or context menus. We're enriching, not redesigning.

### 5. AtlasPlanTab.tsx — three-section layout

The tab itself currently shows one tree. Restructure into three vertically stacked sections:

1. **Active right now** (auto-collapsed if empty) — flat list of every node where `active_child !== null`, with the active spec name and time-in-progress.
2. **Today's additional work** (auto-collapsed if empty) — flat list of every node with `added_today=true`, sorted newest first.
3. **Full plan tree** — the existing tree, with the new visual upgrades from step 4.

Sticky filter chips at top (Done / In progress / Queued / Future / All) — filters the full tree, doesn't affect sections 1 and 2.

### 6. Tests (`e2e/plan-tab.spec.ts`)

New Playwright spec. Three scenarios:

- (a) Empty repo state — tree renders, no errors, all sections empty-state messaged.
- (b) Mid-build state — fixture with 3 done specs, 1 in-progress, 2 queued. Assert % ring shows correct value, active-child badge appears, "added today" highlights specs from today.
- (c) Master plan mismatch — spec phase number not in master-plan.md. Assert it appears in "Today's additional work" but doesn't break the tree.

## Acceptance criteria

- `GET /atlas/plan?include=progress` returns enriched JSON; without the flag, response is identical to current.
- Plan tab loads in <1s on a 50-node tree (the cache works).
- Every node with at least one child spec shows a `%` value matching `children_done/children_total`.
- An "active" node shows pulse animation; once that spec moves to `done/`, animation stops within 30s.
- A spec written today (e.g., this very spec, once shipped) appears in "Today's additional work" tagged `+today`.
- `npm run build` passes with zero TS errors.
- `npx playwright test e2e/plan-tab.spec.ts` green.

## Information walls

The Plan tab is admin-tier only. The customer + verified tiers do NOT see this tab. Ensure `RouteGuard requires="admin"` wraps the tab route.

## Files touched (rough estimate, Builder may add more)

- `atlas/src/lib/plan-parser.ts` (extend)
- `atlas/src/lib/plan-state.ts` (extend)
- `atlas/src/server.ts` (route param)
- `src/components/atlas-plan/PlanTree.tsx` (visual upgrade)
- `src/components/atlas/tabs/AtlasPlanTab.tsx` (3-section layout)
- `src/components/atlas-plan/PlanProgressRing.tsx` (NEW)
- `src/components/atlas-plan/PlanTodaySection.tsx` (NEW)
- `src/components/atlas-plan/PlanActiveSection.tsx` (NEW)
- `e2e/plan-tab.spec.ts` (NEW)

## Out of scope

- Changing the master-plan.md format itself — the parser adapts to what's there.
- Editing plan nodes from the UI — that's a separate spec.
- Mobile responsive — the dashboard PWA already adapts, just verify it doesn't break.
- Gantt or kanban view — explicitly deferred (user picked phase tree).
