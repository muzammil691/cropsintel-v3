---
phase: 1.10an
title: Cockpit v1.4 — Launch level metadata (V1.0 alpha / V1.0 beta / V1.5 / V2.0 tagging)
status: planned
gate: in-progress count <= 2 AND phase 1.10am shipped
order: 4-of-4 cockpit upgrade bundle
estimated_builder_minutes: 20
estimated_cost_usd: 3
master_plan_section: 11.7
---

# Phase 1.10an — Cockpit v1.4: Launch level metadata

## Why this exists

Master plan today has 85+ phases (1.1, 1.2, 1.3, ..., 1.10ak, etc.). They're sequenced but **not bucketed into launch milestones.** User can't see "everything in V1.0 alpha" or "what's needed for V1.0 beta launch" at a glance.

Without launch buckets:
- Cockpit's Build runner can't respect launch tier (it would queue all `follow` phases together regardless of milestone).
- User can't say "ship everything for V1.0 alpha tonight" or "save V2.0 features for next quarter."
- The "Bloomberg-for-almonds" vision splits across V1.0 / V1.5 / V2.0 with no metadata to track which phase serves which.

This spec adds launch level tagging on phases + filters in cockpit + Build runner respect for launch tier.

## Foundation-first check

- ✅ Master plan parser exists in `atlas/src/lib/plan-parser.ts`.
- ✅ Plan tab tree in `src/components/atlas-plan/PlanTree.tsx` shipped (1.10aj).
- ✅ Build runner shipped (1.10aj, in `atlas/src/lib/build-runner.ts`).
- ✅ Idea file from 1.10al has launch order section already.
- ❓ No launch-level field exists today on phase nodes.

## What ships

### 1. Launch level taxonomy

Five values, defined here (matches idea file):

| Tag | Meaning |
|---|---|
| `v1.0-alpha` | Internal Maxons-only build. Auth + RBAC + verified queue + V2 migration + read-only insights. Almonds only. |
| `v1.0-beta` | First external trader access. Adela data spine + inquiry/offer/contract flow. |
| `v1.5` | Multi-commodity (walnut, pistachio enabled). Multi-portal frontend. Reports library. |
| `v2.0` | Prescriptions, AI-driven matching, audit-trail compliance. |
| `infra` | Atlas/cockpit infrastructure — never user-facing, ships on its own track. |

Default: phases without a tag are treated as `v1.0-alpha` until explicitly tagged.

### 2. Master plan parser update

Extend `atlas/src/lib/plan-parser.ts` to read a `launch:` field from phase headers in the master plan:

```markdown
## 1.3 Auth + 3-tier RBAC + V1/V2 user bridge
launch: v1.0-alpha
[...]
```

If field absent → default `v1.0-alpha`.

### 3. Atlas auto-tagging on existing phases

Builder runs a one-shot script during this spec's execution that reads ALL existing master plan phases, infers launch level from content + idea file, and writes the launch tag inline:

- Phases mentioning auth, profile, RBAC, verification queue, V2 migration → `v1.0-alpha`
- Phases mentioning Adela, inquiry/offer/contract, real-time data → `v1.0-beta`
- Phases mentioning multi-commodity, multi-portal, reports library → `v1.5`
- Phases mentioning prescriptions, AI matching, compliance → `v2.0`
- Phases under section 1.10 (Atlas infrastructure) → `infra`

This is a one-time backfill commit. User can edit any tag manually in master plan markdown.

### 4. Cockpit UI — launch filter

Add to Plan tab top bar (near existing All / Shipped / Queued / Planned / Blocked filters):

- Launch tier dropdown: "All launches" | "v1.0-alpha" | "v1.0-beta" | "v1.5" | "v2.0" | "infra"
- Default selection: "v1.0-alpha" (most active launch tier today).
- Selecting a tier filters the tree to only show phases at that launch level.
- Each phase node shows a small launch badge (color-coded):
  - v1.0-alpha = emerald
  - v1.0-beta = blue
  - v1.5 = purple
  - v2.0 = amber
  - infra = slate

### 5. Build runner respects launch tier

Extend `atlas/src/lib/build-runner.ts`:

- When user clicks Build, runner queues phases in launch order: `v1.0-alpha` first (all of them), then `v1.0-beta`, then `v1.5`, then `v2.0`. `infra` is interleaved per priority.
- New build option in confirmation modal: "Stop after v1.0-alpha completes?" [yes / no]
- If yes → runner pauses after the last v1.0-alpha phase ships; user must approve to proceed to v1.0-beta.

This is the launch-gate mechanic. User can build to a milestone, validate, then continue.

### 6. New API endpoints

- `GET /atlas/plan/by-launch/:tier` — returns all phases at a launch tier.
- `GET /atlas/plan/launch-progress` — returns progress per tier:
  ```json
  {
    "v1.0-alpha": { "total": 16, "shipped": 5, "queued": 2, "planned": 9 },
    "v1.0-beta":  { "total": 14, "shipped": 0, ... },
    ...
  }
  ```
- `POST /atlas/plan/retag` — admin-only, manually retag a phase.

### 7. Master plan v1.7 update

After this spec ships, master plan becomes v1.7 with launch tags backfilled. Atomic commit.

### 8. Tests

`e2e/launch-levels.spec.ts`:

- (a) Master plan parser → assert launch field is read correctly when present, defaults to `v1.0-alpha` when absent.
- (b) Backfill script → assert it correctly tags Phase 1.3 as `v1.0-alpha` and Phase 1.6 (multi-commodity) as `v1.5`.
- (c) Cockpit launch filter → assert selecting "v1.0-alpha" hides v1.5 and v2.0 phases.
- (d) Build runner with "stop after v1.0-alpha" → assert runner pauses at the boundary, user must explicitly resume.
- (e) `GET /atlas/plan/launch-progress` → assert returns correct shipped/queued/planned counts per tier.

## Acceptance criteria

- Launch field readable from master plan phase headers.
- Backfill script tags all existing phases.
- Master plan bumps to v1.7.
- Cockpit filter dropdown works.
- Launch badges visible on phase nodes.
- Build runner queues in launch order.
- Build runner can pause at launch boundary.
- 5 e2e tests pass.
- Spec lands in `done/`.

## Out of scope

- Per-user launch preferences (single shared launch tier active at a time).
- Launch-tier-specific RBAC (a v2.0 phase still needs admin to ship — same access rules).
- Dependency graphs across launch tiers (linear order only).
- Auto-shipping when launch tier is "ready" (still requires user click on Build).

## Realistic time estimate

- Plan parser update: ~3 min
- Backfill script + run: ~5 min
- UI filter + badges: ~5 min
- Build runner extension: ~4 min
- API endpoints: ~3 min
- Tests: ~3 min
- Master plan v1.7 commit: ~1 min
- **Builder total: ~20 min**

## Dependencies

- 1.10ak shipped (repo reader for backfill script)
- 1.10al shipped (idea file as source of launch definitions)
- 1.10am shipped (deep wizard so phases can be created with launch tags)
- 1.10aj shipped (cockpit base for launch filter UI)
