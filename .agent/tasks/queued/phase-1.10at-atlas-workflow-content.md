---
priority: 2
depends-on: []
---

# Task: Phase 1.10at — Workflow tab content (commodity flowcharts + agent pipeline diagrams)

**Master plan reference:** §1.8 almond-trade workflows; §1.10 Atlas conductor; user vision discussion 2026-05-02 ("commodity trade workflows shown as clickable visual flowcharts" + "agent pipeline diagram: Atlas → Builder → Verifier → Designer → Council → Adela").

**Context:** `AtlasWorkflowTab.tsx` was wired in Phase A (1.10ap) and renders an `AgentPipeline` component + a `WorkflowGraph` placeholder. The pipeline shows the 7-agent flow with status dots — that part works. The commodity-trade workflow graph is empty because `GET /atlas/workflow/graph` either returns no data or hasn't been seeded with real workflow content from the master plan.

This spec ships the actual workflow content + improves the agent-pipeline diagram with live status from `useAtlasStatus`.

**Estimated effort:** ~60 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Server endpoint returns the parsed almond-trade workflow

`docs/MAXONS_Workflow_v1.md` is in the repo (per CLAUDE.md). It documents the 15 workflows × 8 departments × 3 operating models that drive the CropsIntel domain.

**`atlas/src/lib/workflow-parser.ts`** (NEW):
- Read `docs/MAXONS_Workflow_v1.md` from disk.
- Parse it into a `{ nodes, edges }` structure suitable for `reactflow`:
  - Department headers → `kind: 'department'` nodes
  - Workflow titles under each department → `kind: 'workflow'` nodes with edges back to their owning department
  - Operating-model annotations (Direct/Broker/Agent) → `kind: 'operating_model'` nodes with edges to all workflows they apply to
- If the doc isn't parseable cleanly, fall back to a hardcoded baseline derived from §1.8 of the master plan (15 workflow names, 8 department names — listed in the master plan and easy to inline).

**`GET /atlas/workflow/graph`** (already exists from 1.10ak — extend if needed):
- Auth: viewer+
- Returns `{ nodes: [...], edges: [...], updated_at }` where `updated_at` reflects the last commit that touched `docs/MAXONS_Workflow_v1.md`.
- Cache the parsed graph in memory for 60s to avoid re-parsing on every fetch.

### Part B — Frontend renders both diagrams

`src/components/atlas/tabs/AtlasWorkflowTab.tsx` (extend):

Two-panel layout, top-down:

**Top: Agent Pipeline** (~280px tall, fixed)

Already rendered by `AgentPipeline.tsx` from 1.10ap. Verify it:
- Shows 7 nodes: Atlas, Builder, Verifier, Designer, Council, Memory, Adela
- Each node has a status dot (🟢 / 🟡 / 🔴) derived from `useAtlasStatus()` per-agent state
- Last activity timestamp under the node (e.g., "Builder · 4 min ago")
- Edges between nodes show data flow direction
- Clicking a node → cockpit jumps to Agents tab

If `AgentPipeline.tsx` is missing the live-status integration, add it: read agent statuses from `useAtlasStatus()` (already polls every 5s) and the most-recent activity from `verifier_runs` / `designer_runs` / `atlas_events`.

**Bottom: Commodity Trade Workflow Graph** (fills remaining height)

Render via existing `WorkflowGraph.tsx` (from 1.10ak) using the data from `GET /atlas/workflow/graph`.
- Node colors by kind: department=slate, workflow=emerald, operating_model=amber
- Click a workflow node → opens `NodeDetailDrawer` (already exists from 1.10ak) with:
  - Workflow title + description
  - Linked done specs (fuzzy-match on title)
  - Linked queued specs
  - Two action buttons: `[Build this]` (queues a spec for this workflow) + `[Discuss this]` (sends `chat_seed` to chat)

### Part C — Search bar above the graph

A small search input above the diagrams: filters node titles in real-time. Matches highlight in emerald, non-matches dim to 30% opacity. Clear button (X) when input has text.

### Part D — Empty / error state

If the workflow doc doesn't parse and the fallback baseline also fails, show:

```
🚧 Workflow data unavailable
Atlas couldn't parse docs/MAXONS_Workflow_v1.md. The agent pipeline above
still works. Re-run the parser via /atlas/workflow/refresh or open the
master plan to verify the workflow doc is intact.
[Open master plan ↗]  [Retry parse]
```

`POST /atlas/workflow/refresh` (NEW endpoint, owner-only): clears the in-memory cache and re-parses on next GET.

## Files

- `atlas/src/lib/workflow-parser.ts` (NEW)
- `atlas/src/server.ts` (extend — refresh endpoint, parser cache)
- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` (extend — search input, empty/error state)
- `src/components/atlas/workflow/AgentPipeline.tsx` (verify/extend — wire live status)

## Success criteria

- `npm run build` clean
- Workflow tab shows agent pipeline with live status dots that update every 5s
- Commodity workflow graph renders ≥10 workflow nodes derived from `MAXONS_Workflow_v1.md` (or the §1.8 baseline)
- Click a workflow node → drawer with linked specs and Build/Discuss buttons
- Search input filters node visibility
- Refresh endpoint clears parser cache and re-renders updated graph

## Risks + mitigations

- **Risk:** `MAXONS_Workflow_v1.md` format is brittle. **Mitigation:** baseline fallback from master plan §1.8 ensures graph never empty.
- **Risk:** reactflow re-renders on every status update cause flicker. **Mitigation:** `useMemo` the nodes/edges arrays; only re-compute when graph data changes.
- **Risk:** Bundle bloat from reactflow. **Mitigation:** already lazy-loaded behind `/atlas?tab=workflows`.

## NEVER list

- Never write to `docs/MAXONS_Workflow_v1.md` from this tab — read-only display.
- Never block the agent pipeline rendering on the workflow graph fetch — they're independent.
