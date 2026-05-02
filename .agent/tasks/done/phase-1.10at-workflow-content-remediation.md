# Task: Phase 1.10at-rem — Atlas Workflow Tab Full Implementation Remediation

## Goal
Fully implement the Atlas Workflow Tab which shipped as documentation-only with zero implementation files. Four files must be created: workflow-parser.ts, AtlasWorkflowTab.tsx, AgentPipeline.tsx, and server.ts extensions.

## Background
phase-1.10at-atlas-workflow-content shipped only the markdown doc. Zero implementation files were written. Verifier o3 confirmed: workflow-parser.ts absent, server routes absent, AtlasWorkflowTab.tsx absent, AgentPipeline.tsx absent.

## Files To Create / Modify

### 1. atlas/src/lib/workflow-parser.ts (CREATE)
- Parse docs/MAXONS_Workflow_v1.md into a ReactFlow-compatible node/edge graph
- Export: `parseWorkflowDoc(): { nodes: Node[], edges: Edge[] }`
- Export: `getAgentStatus(agentId: string): AgentStatus`
- Cache parsed result in memory, refresh on demand
- Handle parse errors gracefully — return empty graph, log error

### 2. atlas/src/server.ts (EXTEND)
- Add `GET /atlas/workflow/graph` → returns `{ nodes, edges, lastUpdated }`
- Add `POST /atlas/workflow/refresh` → clears cache, re-parses, returns fresh graph
- Cache with 5-minute TTL
- Auth: same middleware as existing /atlas routes

### 3. src/components/atlas/tabs/AtlasWorkflowTab.tsx (CREATE)
- Two-panel layout: left = agent pipeline diagram, right = selected node detail
- Search bar filtering nodes by agent name
- Loading skeleton while graph fetches
- Error state with retry button
- Wire to GET /atlas/workflow/graph on mount
- Wire POST /atlas/workflow/refresh to a "Refresh" button

### 4. src/components/atlas/workflow/AgentPipeline.tsx (CREATE)
- ReactFlow diagram rendering nodes and edges from workflow-parser output
- Live status dots wired to useAtlasStatus hook (green=healthy, red=down, yellow=degraded)
- Node click → emits selected node to parent AtlasWorkflowTab
- Fit view on load
- Read-only (no drag/edit)

## Success Criteria
- [ ] `atlas/src/lib/workflow-parser.ts` exists and exports parseWorkflowDoc + getAgentStatus
- [ ] `GET /atlas/workflow/graph` returns 200 with nodes + edges array
- [ ] `POST /atlas/workflow/refresh` clears cache and returns fresh graph
- [ ] `AtlasWorkflowTab.tsx` renders without crash, shows loading + error states
- [ ] `AgentPipeline.tsx` renders ReactFlow diagram with live status dots
- [ ] Search bar filters nodes correctly
- [ ] No TypeScript errors
- [ ] No placeholder/stub text ("coming soon", "TODO", "placeholder")

## Risks + Mitigations
- Risk: ReactFlow not in package.json → Mitigation: check package.json first, use existing graph lib if present, only add reactflow if already a dependency
- Risk: MAXONS_Workflow_v1.md format changes → Mitigation: parser uses regex + section detection, not hardcoded line numbers
- Risk: useAtlasStatus hook shape mismatch → Mitigation: read existing hook signature before wiring, use optional chaining
- Risk: Server route conflicts → Mitigation: check existing /atlas routes before adding, use unique path segments

## NEVER List
- NEVER delete or modify AtlasOverviewTab, AtlasChatTab, AtlasBrainTab
- NEVER modify shell layout, routing config, or nav structure
- NEVER hardcode agent status — always read from useAtlasStatus
- NEVER fabricate API responses or mock data in production code
- NEVER add ReactFlow if it is not already in package.json — use alternative
- NEVER modify existing /atlas server routes
- NEVER throw unhandled errors from workflow-parser — always catch and return empty graph
