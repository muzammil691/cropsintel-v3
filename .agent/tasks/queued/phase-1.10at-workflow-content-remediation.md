---
priority: 1
---
# Task: Phase 1.10at-rem — Atlas Workflow Content Remediation

## Goal
Fully implement the Atlas workflow content layer that shipped as markdown-only with zero implementation files. Four files must be created from scratch.

## Files to create / modify
1. `atlas/src/lib/workflow-parser.ts` — parse `docs/MAXONS_Workflow_v1.md` into a ReactFlow-compatible graph (nodes + edges). Export `parseWorkflowDoc(): WorkflowGraph`.
2. `atlas/src/server.ts` — add three endpoints:
   - `GET /atlas/workflow/graph` → returns parsed graph, cached 60s in memory
   - `POST /atlas/workflow/refresh` → busts cache, re-parses, returns fresh graph
   - Cache layer: simple `Map<string, {graph, ts}>` — no Redis dependency
3. `src/components/atlas/tabs/AtlasWorkflowTab.tsx` — two-panel layout:
   - Left panel: ReactFlow canvas rendering the graph nodes/edges
   - Right panel: node detail drawer (name, description, status)
   - Search bar filtering nodes by name
   - Error state: "Workflow graph unavailable" with retry button
   - Loading state: spinner
4. `src/components/atlas/workflow/AgentPipeline.tsx` — live agent status bar wired to `useAtlasStatus` hook. Shows each agent (Atlas, Builder, Verifier, Council, Multi-Brain, Memory, Adela, Designer) with live status dot (green/red/grey).

## Success criteria
- `GET /atlas/workflow/graph` returns `{ nodes: [...], edges: [...] }` with at least 8 agent nodes
- `POST /atlas/workflow/refresh` returns 200 and busts cache
- `AtlasWorkflowTab.tsx` renders without errors when graph API returns data
- `AtlasWorkflowTab.tsx` renders error state when API returns 500
- `AgentPipeline.tsx` renders all 8 agents with status dots
- `workflow-parser.ts` exports `parseWorkflowDoc` and returns non-empty nodes + edges
- No TODO / coming soon / placeholder strings anywhere in the 4 files
- TypeScript compiles with zero errors on these files

## Risks + mitigations
- Risk: ReactFlow not in package.json → mitigation: check imports first; if absent use plain SVG/div layout, do NOT add new npm packages without checking package.json
- Risk: `docs/MAXONS_Workflow_v1.md` path wrong → mitigation: search repo root for workflow markdown before hardcoding path
- Risk: Server hot-reload breaks cache → mitigation: attach cache to module-level variable, not request scope
- Risk: `useAtlasStatus` hook absent → mitigation: if hook absent, create minimal stub returning static agent list with status: "unknown"

## NEVER list
- NEVER delete or modify existing Atlas tab components (AtlasOverviewTab, AtlasChatTab, AtlasPlanTab, AtlasAgentsTab)
- NEVER modify existing server routes already present in server.ts
- NEVER add npm packages not already in package.json
- NEVER hardcode fake data — all graph data must come from workflow-parser.ts parsing the actual doc
- NEVER use console.error as the only error handling — propagate to API response
- NEVER leave TODO, "coming soon", or placeholder strings in any file
