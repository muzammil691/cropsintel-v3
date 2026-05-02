---
priority: 1
depends-on: []
---

# Task: Phase 1.10ap — Wire dead Atlas tabs (Workflows / Audit / Queue)

**Master plan reference:** §1.10 Atlas cockpit completion.

**Context:** The cockpit shell shipped in 1.10an with 7 tabs. Plan and Team are wired. Workflows, Audit, and Queue are still "Coming soon" placeholders even though the backend data + components exist:

- **Workflows** — `src/components/atlas-workflow/WorkflowGraph.tsx` shipped in 1.10ak with reactflow-style nodes/edges. Tab just renders a placeholder.
- **Audit** — `verifier_runs` (1199+ rows) and `designer_runs` tables full of data. Tab shows nothing.
- **Queue** — `builder.list_queue` tool works. Tab shows nothing.

This spec wires each tab to its real data + adds the minimum action buttons users need.

**Estimated effort:** ~30 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Workflows tab (`src/components/atlas/tabs/AtlasWorkflowTab.tsx`)

Replace the placeholder with a two-panel layout:

**Top panel: Agent pipeline diagram** (always visible, ~280px tall)
- Horizontal flow: `Atlas → Builder → Verifier → Designer → Council → Memory → Adela`
- Each node is a rounded card showing:
  - Agent name
  - Status dot (🟢 SUCCESS / 🟡 DEPLOYING / 🔴 FAILED) — derived from existing `useAtlasStatus()` hook's per-agent data
  - Last activity timestamp
- Edges between nodes show data flow direction with small arrowheads
- Click a node → scroll the Agents tab into view (use existing `setActiveTab('agents')` handler)

**Bottom panel: Commodity trade workflow graph** (fills remaining space)
- Render the existing `WorkflowGraph` component from `src/components/atlas-workflow/WorkflowGraph.tsx`
- Wire `fetchWorkflowGraph()` from `atlas-client.ts` (which calls `GET /atlas/workflow/graph`)
- If the call fails (endpoint not yet returning data), render a placeholder list: "Master plan §1.8 specifies 15 workflows × 8 departments — graph data pending"
- Search input above the graph filters node titles

**Files:**
- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` (replace placeholder)
- `src/components/atlas/workflow/AgentPipeline.tsx` (NEW — the 7-node agent flow component)

### Part B — Audit tab (`src/components/atlas/tabs/AtlasAuditTab.tsx`)

Replace the placeholder with a verifier+designer activity feed.

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│ AUDIT                              [Verifier] [Designer] [All]│
│ Live audit feed across the build pipeline.                    │
├──────────────────────────────────────────────────────────────┤
│ 🟢 19:54 verifier · phase-1.10ao   passed (gate)              │
│         commit c65d7e1 · 2 min                                │
│         [view gaps] [open commit ↗]                           │
├──────────────────────────────────────────────────────────────┤
│ 🔴 19:42 verifier · phase-1.10an   failed (3 gaps)            │
│         [Diagnose] [Discuss] [Copy CC Prompt]                 │
│ ...                                                           │
└──────────────────────────────────────────────────────────────┘
```

**Data:**
- Use existing `verifierRecentRuns(50)` from `atlas-client.ts` for verifier rows
- Add `fetchRecentDesignerRuns(50)` calling `GET /atlas/designer/runs` (NEW endpoint — server-side wraps `designer_runs` query, ordered by `created_at desc`, returns `id, task_id, verdict, ai_judgment, created_at`)

**Filter chips:** All / Verifier / Designer toggle which source is shown.

**Each row:**
- Status icon (✅ pass / ❌ fail / ⚠️ unknown / 🟡 partial)
- Timestamp (relative: "2 min ago", "1h ago")
- Source agent + task_id
- Verdict + gap count summary
- Action buttons (only on failed rows): `[Diagnose] [Discuss] [Copy CC Prompt]` — these stub for now (button click → toast "diagnose flow ships in Phase B"). The button placement matters for Phase B which wires the actual logic.

**Files:**
- `src/components/atlas/tabs/AtlasAuditTab.tsx` (replace placeholder)
- `src/components/atlas/audit/AuditRow.tsx` (NEW)
- `src/lib/atlas-client.ts` (add `fetchRecentDesignerRuns`)
- `atlas/src/server.ts` (add `GET /atlas/designer/runs` endpoint, role: viewer+)

### Part C — Queue tab (`src/components/atlas/tabs/AtlasQueueTab.tsx`)

Replace the placeholder with the queue manager.

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│ QUEUE                                          [Refresh ↻]    │
│ 4 specs queued · Builder is on phase-1.10ap (3 min in)        │
├──────────────────────────────────────────────────────────────┤
│ ⏳ phase-1.10ap-atlas-wire-dead-tabs           IN-PROGRESS    │
│    Builder · 3 min · ETA ~10 min                              │
│    [view spec ↗] [view live log ↗]                            │
├──────────────────────────────────────────────────────────────┤
│ ① phase-1.10aq-atlas-memory-summary             prio 1        │
│    [▲ priority] [▼ priority] [📝 edit] [🗑 cancel]            │
├──────────────────────────────────────────────────────────────┤
│ ② phase-1.11-position-reports                   prio 2        │
│    ...                                                        │
└──────────────────────────────────────────────────────────────┘
```

**Data:**
- `fetchBuilderQueue()` from `atlas-client.ts` (calls `builder.list_queue`)
- Builder's current task from `useAtlasStatus()` (`status.in_flight_specs[0]` if exists)

**Action buttons (only owner+admin role can use):**
- Priority up/down → calls `builder.set_priority` tool
- Cancel → calls `builder.cancel_task` (with confirm dialog)
- Edit → opens chat with prefill: "Atlas, edit the spec at .agent/tasks/queued/<file> — change <ask>"

**Files:**
- `src/components/atlas/tabs/AtlasQueueTab.tsx` (replace placeholder)
- `src/components/atlas/queue/QueueRow.tsx` (NEW)

### Part D — Tab badges live-update

After each tab is wired, ensure the badges in `AtlasTabBar.tsx` reflect:
- Workflows: never has a count (decorative)
- Audit: count of failed verifier_runs in last 24h
- Queue: count of queued specs (already wired)

These should already work via `useAtlasStatus` + `useArtifacts`; verify not regressed.

## Files

- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` (replace)
- `src/components/atlas/tabs/AtlasAuditTab.tsx` (replace)
- `src/components/atlas/tabs/AtlasQueueTab.tsx` (replace)
- `src/components/atlas/workflow/AgentPipeline.tsx` (NEW)
- `src/components/atlas/audit/AuditRow.tsx` (NEW)
- `src/components/atlas/queue/QueueRow.tsx` (NEW)
- `src/lib/atlas-client.ts` (extend — `fetchRecentDesignerRuns`)
- `atlas/src/server.ts` (extend — `GET /atlas/designer/runs`)

## Success criteria

- `npm run build` clean
- Workflows tab: opens the cockpit, scrolls to Workflows → renders both panels (agent pipeline always visible, commodity graph below). No "Coming soon" copy anywhere.
- Audit tab: shows ≥ 5 recent verifier runs and ≥ 5 recent designer runs. Filter chips switch correctly.
- Queue tab: shows the live queue. The currently in-progress spec is highlighted at top.
- Each row in audit/queue has the action button row in the right place (clicks just toast for now).
- Failed audit rows show `[Diagnose] [Discuss] [Copy CC Prompt]` buttons (logic wired in Phase B).

## Risks + mitigations

- **Risk:** `WorkflowGraph` component requires reactflow CSS that may not be imported. **Mitigation:** Audit imports; add `import 'reactflow/dist/style.css'` if missing.
- **Risk:** `GET /atlas/designer/runs` endpoint doesn't exist yet. **Mitigation:** Spec adds it explicitly under Part B with role gate.
- **Risk:** `builder.set_priority` and `builder.cancel_task` tools may have role gates that reject viewer. **Mitigation:** Render priority/cancel buttons only when `useAuthMe().role === 'owner' || 'admin'`.
- **Risk:** Tab content doesn't reuse the existing `TabFrame` shell exported from `AtlasPlanTab.tsx`. **Mitigation:** Each new tab imports `TabFrame` and wraps content per the Plan tab pattern.

## NEVER list

- Never replace the existing Plan or Team tabs (already shipped).
- Never gate read-only views (Audit, Workflows display) by role — viewers must see them.
- Never call destructive tools (cancel_task) without an explicit confirm dialog.
- Never block the build on missing reactflow data — fall back to a list.
