---
priority: 3
depends-on:
  - phase-1.10aa-brain-tables-and-edge-function
---

# Task: Phase 1.10ab — /atlas-brain page (Multi-Brain debate UI, research-driven)

**Master plan reference:** §1.6 Atlas; §11.3 Phase 2.11 brought forward; user directive 2026-05-01: research-driven UI, full V1 vision.
**Context:** With 1.10aa shipping the brain tables + brain-ai edge function backend, this spec adds the visual surface — a `/atlas-brain` route where admins can see, run, and audit Multi-Brain debates. Must be research-driven (named references) and pass Designer audit.
**Estimated effort:** ~120 min Builder time (large, UI heavy)
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

A `/atlas-brain` admin page that:

1. Lists all `brain_nodes` (left rail) with score badges (color-coded), category filter, search.
2. Right pane: selected node detail — current score, history sparkline (from `brain_node_history`), latest discussion thread with all 4 voices (Claude / GPT / Gemini / Consensus), score-trend line.
3. Action buttons: "Run Multi-Brain debate" (calls `brain-ai` edge fn with `action=debate`); "Run Consensus" (re-judges existing thread); "Manual score adjust" (admin-only override with reason).
4. Debate streaming: while debate runs, the thread panel streams in opinions as they arrive (use SSE). Each opinion appears in its own colored card (Claude purple / GPT green / Gemini blue / Consensus gold).
5. Cost meter at bottom: shows running cost-of-debate + monthly burn (uses existing `atlas_cost_log` aggregation).
6. RBAC-gated: admin or team role only. Use existing `<RouteGuard requires="admin">` (extend if needed).

## Research phase (MANDATORY before coding)

Builder MUST commit `docs/atlas-brain-ui-research.md` BEFORE any TSX. Study:

- **Cursor IDE composer pane** — multi-LLM diff comparison; which one to apply
- **OpenAI Playground side-by-side compare** — prompt run across multiple models in columns
- **Anthropic Workbench** — model selection + diff
- **Replit AI Modify** — agent reasoning panel
- **Linear AI suggestions** — quiet integration of AI-generated content
- **Notion AI** — inline reasoning + accept/reject
- **Vercel v0** — multi-iteration generation log

Write 1 paragraph per reference: what works for showing multi-model debates, what to borrow, what to avoid.

## Architecture

```
src/
├── pages/
│   └── AtlasBrain.tsx                  (NEW — research-driven layout)
├── components/
│   └── atlas-brain/
│       ├── BrainNodeList.tsx           (NEW — left rail with search + filter)
│       ├── BrainNodeDetail.tsx         (NEW — right pane container)
│       ├── BrainScoreBadge.tsx         (NEW — color-coded 0..100)
│       ├── BrainScoreSparkline.tsx     (NEW — recharts line)
│       ├── DebateThread.tsx            (NEW — chronological multi-author thread)
│       ├── DebateMessageCard.tsx       (NEW — colored card per author)
│       ├── RunDebateButton.tsx         (NEW — opens prompt modal, kicks off SSE)
│       ├── ScoreAdjustDialog.tsx       (NEW — manual override)
│       └── CostFooter.tsx              (NEW — debate cost + monthly meter)
├── hooks/
│   ├── useBrainNodes.ts                (NEW — supabase query + realtime)
│   ├── useBrainDebate.ts               (NEW — invokes edge fn, streams SSE)
│   └── useBrainHistory.ts              (NEW — score history per node)
└── lib/
    └── brain-client.ts                 (NEW — supabase fns invocation wrapper)
```

## Layout (proposed)

```
┌─────────────────────────────────────────────────────────────────────┐
│  /atlas-brain    [search input]    [category filter ▾]   [+ node]   │
├─────────────────────────┬─────────────────────────────────────────┤
│  Brain Nodes (rail)      │  <selected>  Atlas conductor quality     │
│  ────────────            │  Score: 70 / 100  ▲ +5 (last debate)     │
│  agent-quality      70   │  ─────────────────────────────────────   │
│  verifier-strict    80   │  [Sparkline 30d]                         │
│  designer-tokens    50   │                                          │
│  memory-recall      65   │  Latest debate (2h ago)                  │
│  adela-freshness     0   │  ┌──────────────────────────────────┐   │
│  rls-walls          75   │  │ 🟣 Claude: ...                   │   │
│  build-throughput   85   │  ├──────────────────────────────────┤   │
│  cost-discipline    95   │  │ 🟢 GPT-4o: ...                   │   │
│                          │  ├──────────────────────────────────┤   │
│                          │  │ 🔵 Gemini: ...                   │   │
│                          │  ├──────────────────────────────────┤   │
│                          │  │ 🟡 Consensus: ...                │   │
│                          │  └──────────────────────────────────┘   │
│                          │                                          │
│                          │  [Run Multi-Brain]  [Re-Consensus]       │
│                          │  [Manual Adjust]                         │
├─────────────────────────┴─────────────────────────────────────────┤
│  Today: $1.23   Month: $14.78 / $400 cap         (last debate $0.34) │
└─────────────────────────────────────────────────────────────────────┘
```

Mobile: tabbed (List → Detail → Debate). Designer audit MUST cover mobile.

## Design tokens (locked, Designer enforces)

- Score badges: green-600 (≥80), amber-500 (50-79), red-500 (<50), gray (no score yet)
- Author cards: Claude purple-600, GPT emerald-600, Gemini blue-600, Consensus amber-500
- All radii / shadows / spacing per existing design system
- `prefers-reduced-motion` respected (no fade-in if reduced)

## Data layer

`src/lib/brain-client.ts`:
```typescript
export async function listBrainNodes(filters?: { category?: string; status?: string }) {
  let q = supabase.from('brain_nodes').select('*').order('label')
  if (filters?.category) q = q.eq('category', filters.category)
  return q
}

export async function listDiscussionsByThread(threadId: string) {
  return supabase.from('brain_discussions').select('*').eq('thread_id', threadId).order('created_at')
}

export async function startDebate(nodeId: string, prompt: string, onEvent: (e: BrainEvent) => void) {
  // POST to /functions/v1/brain-ai with action=debate; consume SSE
}
```

## Wiring with drAtlas (1.10z)

Every action on this page logs an event:
- Page mount: `drAtlas.log('feature_mount', 'ui', 'atlas-brain')`
- Run debate: `drAtlas.multi_brain('debate', node_key, success, models)`
- Score adjust: `drAtlas.log('score_adjust', 'atlas', `Score for ${node_key} changed from ${before} to ${after}`)`

## Files

- `docs/atlas-brain-ui-research.md` (NEW — committed BEFORE TSX, separate commit)
- `src/pages/AtlasBrain.tsx` (NEW)
- `src/components/atlas-brain/*.tsx` (9 new files per arch)
- `src/hooks/useBrainNodes.ts`, `useBrainDebate.ts`, `useBrainHistory.ts` (NEW)
- `src/lib/brain-client.ts` (NEW)
- `src/App.tsx` (extend — add `/atlas-brain` route under existing admin RouteGuard)
- `src/lib/nav-config.ts` (extend if exists from 1.7b — add `/atlas-brain` entry)

## Success criteria

- `docs/atlas-brain-ui-research.md` committed as a SEPARATE commit before TSX work
- `/atlas-brain` renders for admin users; redirect for non-admins
- Brain nodes list populates from real `brain_nodes` rows
- Click a node → detail pane updates
- Click "Run Multi-Brain debate" → modal asks for prompt → SSE stream → 4 cards arrive sequentially → score updates
- Mobile: tabs work; layout responsive
- Lighthouse mobile ≥80, desktop ≥90, accessibility ≥95
- Designer agent audit verdict ≥ 0.7
- drAtlas events captured for every interaction

## Risks + mitigations

- **Risk:** Long debates (30s+) feel frozen. **Mitigation:** SSE shows opinions as they arrive; "Atlas is thinking…" indicator with model emojis lighting up one-by-one.
- **Risk:** Concurrent edits race. **Mitigation:** optimistic UI on score-adjust; reconcile from realtime subscription on `brain_nodes`.
- **Risk:** Massive thread (100+ messages) chokes render. **Mitigation:** virtualize via `react-virtuoso` or simple windowing; show 20 most recent + "Load older" button.

## NEVER list

- Never run a debate without admin/team role (RBAC strict)
- Never expose API keys to client bundle (all model calls go through brain-ai edge fn)
- Never bypass cost budget — debate refuses if monthly cap hit
- Never write a manual score adjust without a `reason` (logged to brain_node_history)
