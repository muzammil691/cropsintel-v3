---
priority: 2
depends-on: [phase-1.10aj-atlas-auth-and-live-sync]
---

# Task: Phase 1.10ak — Atlas v2 knowledge authoring (master-plan tree, workflow diagram, multi-select queue)

**Master plan reference:** §1.10 "Atlas reads its own plan, proposes changes" + §1.8 almond-trade workflow.

**Context:** Atlas dashboard already has conversation, live status, artifact cards, voice I/O (shipped in 1.10a–1.10ae + 1.10w). What's MISSING is the authoring layer — the user can't upload a plan, can't see/edit the plan as a tree, can't visualize the workflow, and can't multi-select pending artifacts to bulk-queue them. This spec adds those.

**Estimated effort:** ~90 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Master-plan tree UI (`/atlas/plan`)

**New page:** `src/pages/atlas/AtlasPlan.tsx`

**Reads from:** existing `.agent/master-plan.md` in the repo (Atlas server already mounts the repo at `REPO_ROOT`). Add `GET /atlas/plan` endpoint returning the parsed tree.

**Parser:** `atlas/src/lib/plan-parser.ts` (NEW)
- Parses markdown headings into a tree: H1 → root, H2 → phase, H3 → sub-phase, H4 → task. Unknown → leaf with parent.
- Preserves source line numbers + raw markdown for round-trip writes.
- Returns `{ id, level, title, body, children, source: { line: number, raw: string } }`.

**Server route `GET /atlas/plan`:**
- Returns the parsed tree (auth required).
- Body shape: `{ updatedAt, sha, tree }` — `sha` is git HEAD so frontend can detect remote changes.

**Server route `POST /atlas/plan/upload`:**
- Body: `{ markdown: string, message?: string }`
- Replaces `.agent/master-plan.md` content (uses `withGitLock` from 1.10af), commits as `chore(plan): user-uploaded plan revision`, pushes.
- Server-side ALSO triggers a Council `/council` call to do gap analysis: "Compare new plan to old plan; what's been added/removed/reordered?" — write the diff summary to `atlas_plan_revisions` table.

**Server route `POST /atlas/plan/amend`:**
- Body: `{ instruction: string }` (e.g., "move Phase 1.8 before 1.7", "delete the i18n checkpoint", "rename phase 1.10 to 'Atlas perfection'")
- Calls Claude (opus-4-7) with the current plan + the instruction → returns updated markdown.
- Saves as a new commit. Returns the diff.

**Frontend tree component:** `src/components/atlas-plan/PlanTree.tsx`
- Uses `@dnd-kit/core` (already in deps if available, else shadcn-friendly fallback to up/down arrow buttons).
- Each node:
  - Title + collapse/expand chevron
  - Body preview (first 80 chars)
  - Inline action menu: Edit, Delete, Add child, Move up/down, **Build now** (queues a spec for this node)
  - Status badge: ✅ shipped / 🟡 queued / ⚪ planned / ❌ blocked (computed by matching node title against `done/`, `queued/`, `failed/` task IDs)
- Drag-reorder writes back via `POST /atlas/plan/reorder` with `{ moved_id, new_parent_id, new_index }`.

**Frontend `src/pages/atlas/AtlasPlan.tsx` layout:**
- Left: tree (60% width)
- Right: detail panel (40% width) showing:
  - Selected node body in a markdown editor (lazy-load `@uiw/react-md-editor` only if not in bundle yet)
  - "Save", "Cancel", "Build now", "Discuss with Atlas" buttons
  - "Discuss with Atlas" jumps the Atlas chat pane to a context-pre-filled message (uses existing chat URL pattern)
- Top toolbar:
  - Upload button (`<input type="file" accept=".md">` → POST `/atlas/plan/upload`)
  - "Amend by command" input + send button → POST `/atlas/plan/amend`
  - Multi-select toggle → reveals checkboxes on every node + bulk action buttons:
    - **Build all selected** → queues N specs in one push
    - **Discuss all selected** → opens chat with the N node bodies as context
    - **Move to Queue** → moves N nodes to a "queued / in-discussion" branch
- Add route `/atlas/plan` to `App.tsx` (under existing AuthGuard).

### Part B — Workflow diagram (`/atlas/workflow`)

**New page:** `src/pages/atlas/AtlasWorkflow.tsx`

**Renders the almond-trade workflow** described in the master plan (§1.8) as an interactive flowchart.

**Source of truth:** `docs/MAXONS_Workflow_v1.md` (already in repo per CLAUDE.md). Parse it into a node/edge graph.

**Library choice:** Use `reactflow` (mature, lightweight, fits shadcn aesthetic). Add to deps.

**Node types:**
- Department (8 — per master plan §1.8): rectangle with department name + active/inactive indicator
- Workflow (15 — per master plan): rounded card with workflow title + responsible department(s)
- Operating model (3): coloured pill (Direct/Broker/Agent)

**Interactions:**
- Click a node → side drawer shows full description + linked specs (queued/done) for that workflow + buttons "Build this", "Discuss this"
- Drag to pan, scroll to zoom (reactflow defaults)
- Mini-map bottom-right
- Search bar top: filters nodes by title

**Server route `GET /atlas/workflow/graph`:**
- Returns `{ nodes: [...], edges: [...] }` from parsing `docs/MAXONS_Workflow_v1.md` server-side (since the file is in the repo on Atlas's clone).

### Part C — Multi-select queue actions on Active Artifacts

**Existing component:** `src/components/atlas/ArtifactsPane.tsx`

**Add:**
- "Multi-select" toggle button at the top
- When active: each artifact card shows a checkbox
- Bulk action bar at bottom of the pane:
  - **Queue all** (queues each as a Builder spec)
  - **Dismiss all**
  - **Discuss all** (opens chat with all selected artifacts as context — Atlas summarises them and asks "what do you want to do?")
  - **Move to Discussion Queue** (a new state: artifact is parked, awaiting human decision; visible in a new "Discussion" tab in the pane)

**New table `atlas_discussion_queue`** (migration `supabase/migrations/20260501140000_atlas_discussion_queue.sql`):
```sql
CREATE TABLE IF NOT EXISTS public.atlas_discussion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_kind text NOT NULL,         -- 'design_audit' | 'open_fork' | 'pending_spec' | 'plan_node'
  artifact_ref text NOT NULL,          -- the source ID (commit_sha, fork_id, etc.)
  context jsonb NOT NULL,              -- snapshot of artifact at time of move
  notes text,                          -- user-attached note
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolution text                      -- 'queued' | 'dismissed' | 'forked' (set when user acts later)
);
ALTER TABLE public.atlas_discussion_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discussion_queue_service" ON public.atlas_discussion_queue
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

**Server routes:**
- `POST /atlas/artifacts/move-to-discussion` — body `{ items: [{kind, ref, context}] }`
- `GET /atlas/artifacts/discussion-queue` — returns unresolved items
- `POST /atlas/artifacts/discussion/:id/resolve` — body `{ resolution }`

## Files

- `atlas/src/lib/plan-parser.ts` (NEW)
- `atlas/src/server.ts` (extend — 5 new routes)
- `src/pages/atlas/AtlasPlan.tsx` (NEW)
- `src/components/atlas-plan/PlanTree.tsx` (NEW)
- `src/components/atlas-plan/PlanNodeDetail.tsx` (NEW)
- `src/components/atlas-plan/PlanToolbar.tsx` (NEW)
- `src/pages/atlas/AtlasWorkflow.tsx` (NEW)
- `src/components/atlas-workflow/WorkflowGraph.tsx` (NEW)
- `src/components/atlas-workflow/NodeDetailDrawer.tsx` (NEW)
- `src/components/atlas/ArtifactsPane.tsx` (extend — multi-select bar)
- `supabase/migrations/20260501140000_atlas_discussion_queue.sql` (NEW)
- `src/App.tsx` (extend — `/atlas/plan` and `/atlas/workflow` routes)
- `package.json` (add `reactflow`, `@uiw/react-md-editor` if needed)

## Success criteria

- `npm run build` clean
- Upload a 50KB master-plan.md → page renders the tree within 1s
- Drag a node → commit appears in `git log` with `chore(plan): reorder ...`
- Type "move 1.8 before 1.7" → tree visibly reorders + commit lands
- Workflow diagram renders 15 workflows + 8 departments without overlap on desktop (>=1280px)
- Click a workflow node → drawer shows linked queued/done specs (cross-referenced by title fuzzy-match)
- Multi-select 3 artifacts → "Queue all" pushes 3 commits to main with new spec files in `.agent/tasks/queued/`
- Discussion queue persists across browser refresh (data in `atlas_discussion_queue`)

## Risks + mitigations

- **Risk:** Parsing master-plan.md is brittle if format changes. **Mitigation:** Keep parser tolerant — anything unparseable becomes a leaf node with raw markdown body; never throw.
- **Risk:** `@dnd-kit` adds bundle weight. **Mitigation:** Lazy-load only on `/atlas/plan` route via React.lazy.
- **Risk:** `POST /atlas/plan/amend` calls Claude on every keystroke if user mashes the input. **Mitigation:** Submit on explicit button press only; debounce input change.
- **Risk:** Workflow diagram on mobile is unusable at small sizes. **Mitigation:** Fall back to a list view on `<sm` breakpoint (still clickable, just no visual graph).

## NEVER list

- Never mutate master-plan.md without committing — every change is a git commit so the history is auditable.
- Never skip the `withGitLock` wrap on plan writes — the conductor cron also touches git.
- Never make the workflow diagram interactive at the cost of accessibility — keyboard navigation must work (tab through nodes, Enter to open drawer).
