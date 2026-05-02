# Task: Phase 1.10at — Workflow Content Remediation

## Goal
Fully implement the Atlas Workflow tab. Currently zero implementation files exist — only the markdown doc shipped. Builder must create all 4 missing files from scratch.

## Files to create / extend
- `atlas/src/lib/workflow-parser.ts` — parse `docs/MAXONS_Workflow_v1.md` into ReactFlow graph nodes/edges. Pure function, no LLM calls, deterministic.
- `atlas/src/server.ts` — extend with: `GET /atlas/workflow/graph` (returns parsed graph JSON, 60s cache), `POST /atlas/workflow/refresh` (busts cache, re-parses)
- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` — two-panel layout: left panel = agent pipeline diagram (ReactFlow), right panel = step detail. Search bar filters nodes. Full error + loading states.
- `src/components/atlas/workflow/AgentPipeline.tsx` — live agent status wiring via `useAtlasStatus` hook. Each agent node shows: name, current status (idle/active/error), last-active timestamp.

## Success criteria
- `GET /atlas/workflow/graph` returns 200 with valid `{nodes[], edges[]}` JSON
- `POST /atlas/workflow/refresh` busts cache and returns fresh parse
- `AtlasWorkflowTab.tsx` renders without error when workflow graph loads
- `AgentPipeline.tsx` reflects live agent status from `useAtlasStatus`
- Search bar filters nodes by name substring match
- Error state shown when `/atlas/workflow/graph` returns non-200
- Loading spinner shown while graph is fetching
- No placeholder text, no TODOs, no "coming soon" strings anywhere in these 4 files

## Risks + mitigations
- Risk: ReactFlow not in package.json → mitigation: check package.json first; if absent use plain SVG/div layout instead, do not add new npm dependencies without confirming
- Risk: `docs/MAXONS_Workflow_v1.md` absent → mitigation: parser returns empty graph with error message, does not throw
- Risk: `useAtlasStatus` hook shape mismatch → mitigation: read existing hook definition before wiring, do not assume shape
- Risk: Server cache layer causes stale data → mitigation: cache key includes file mtime, auto-busted on file change

## NEVER list
- NEVER delete or modify existing Atlas tab files (AtlasOverviewTab, AtlasChatTab, AtlasPlanTab, AtlasAgentsTab)
- NEVER add third-party npm packages not already in package.json
- NEVER hardcode agent status data — must wire to live useAtlasStatus
- NEVER use LLM calls inside workflow-parser.ts
- NEVER throw unhandled errors from workflow-parser.ts — always return {nodes:[], edges:[], error: string} on failure
- NEVER touch existing server.ts routes — only append new ones