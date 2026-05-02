# Task: Phase 1.10at-rem — Atlas Workflow Tab Full Implementation

## Goal
Implement the complete workflow tab that was specced in phase-1.10at but never built. Zero implementation files were written — only the markdown doc shipped. This remediation delivers the full working implementation.

## Files to create / modify
- `atlas/src/lib/workflow-parser.ts` — parse docs/MAXONS_Workflow_v1.md into a ReactFlow-compatible graph (nodes = agents, edges = handoffs, status = live)
- `atlas/src/server.ts` — add `GET /atlas/workflow/graph` (cached 30s), `POST /atlas/workflow/refresh` (cache bust)
- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` — two-panel layout: left = agent pipeline diagram, right = detail panel; search bar; loading + error states
- `src/components/atlas/workflow/AgentPipeline.tsx` — live status wiring to `useAtlasStatus` hook, node colour = green/amber/red per agent health

## Success criteria
- `GET /atlas/workflow/graph` returns valid ReactFlow node+edge JSON within 500ms
- `AtlasWorkflowTab.tsx` renders without crash when workflow graph is empty
- `AgentPipeline.tsx` reflects live agent status from `useAtlasStatus`
- Search bar filters visible nodes in real time
- Error boundary present — tab never white-screens
- All 4 files present and non-stub (no TODO, no "coming soon")
- Verifier stub-detector passes clean

## Risks + mitigations
- Risk: ReactFlow not in package.json — mitigation: check existing deps first, use only what is already installed; if absent use plain SVG/CSS diagram
- Risk: workflow markdown format changes — mitigation: parser has a fallback static graph if parse fails
- Risk: useAtlasStatus shape mismatch — mitigation: read existing hook signature before wiring, add null guards

## NEVER list
- NEVER remove or alter existing Atlas tabs (Overview, Chat, Agents, PD, WhatsApp)
- NEVER add ReactFlow or any new npm package without confirming it is already in package.json
- NEVER hardcode agent status — always read from useAtlasStatus
- NEVER leave TODO, "coming soon", or placeholder text in any delivered file
- NEVER touch server routes unrelated to /atlas/workflow/*
