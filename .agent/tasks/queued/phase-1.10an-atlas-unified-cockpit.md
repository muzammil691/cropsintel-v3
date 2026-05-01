---
priority: 1
depends-on: [phase-1.10aj-atlas-auth-and-live-sync]
---

# Task: Phase 1.10an — Atlas v2 unified cockpit (split-pane shell + slash commands + artifact-cards-in-chat)

**Master plan reference:** §1.10 Atlas as nerve centre.

**Context:** This is the **shell** spec that ties 1.10ak (knowledge authoring), 1.10al (smart diagnosis), and 1.10am (rich chat) together into one coherent UI. Without this shell, those three specs ship as scattered pages; with this shell, they ship as tabs in one always-on cockpit where chat is permanent on the left and tooling tabs on the right.

This spec ships the SKELETON. The 1.10ak/al/am specs ship the CONTENT for each tab. They can ship in either order — this shell renders empty tabs gracefully if a child spec hasn't shipped yet.

**Estimated effort:** ~60 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Layout shell

**Replace `src/pages/Atlas.tsx`** with a unified split-pane cockpit. The current AtlasShell.tsx (1.10w) is a good starting point but needs restructuring around persistent chat + tabbed right pane.

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│ ATLAS HEADER (48px, fixed)                                   │
│ [logo] Atlas Conductor · status pill · trust mode · cost     │
│ · agent health dots · [⚙ settings]                           │
├─────────────────────────┬────────────────────────────────────┤
│ LEFT (380px, fixed)     │ RIGHT (flex)                       │
│ ─────────────────────── │ Tab bar:                           │
│                         │ [Plan] [Queue] [Agents] [Audit]    │
│ ATLAS CHAT              │ [Workflows] [Artifacts]            │
│ (persistent)            │                                    │
│                         │ <Active tab content (scroll)>      │
│                         │                                    │
└─────────────────────────┴────────────────────────────────────┘
```

**Mobile (<768px):** chat collapses into a bottom sheet (drag-up to expand); tabs become a bottom tab bar; selected tab content fills the viewport.

**Tablet (768-1280px):** left pane shrinks to 320px; tab bar wraps if needed.

**Files:**

- `src/components/atlas/AtlasCockpit.tsx` (NEW — replaces AtlasShell as the top-level container; wraps existing AtlasChat + new AtlasTabs)
- `src/components/atlas/AtlasHeader.tsx` (NEW — status pills, agent health, cost, settings)
- `src/components/atlas/AtlasTabBar.tsx` (NEW — shadcn Tabs primitive, tab labels with badges)
- `src/components/atlas/tabs/AtlasPlanTab.tsx` (NEW — empty wrapper that renders 1.10ak's PlanTree)
- `src/components/atlas/tabs/AtlasQueueTab.tsx` (NEW — queue list with multi-select, priority editor)
- `src/components/atlas/tabs/AtlasAgentsTab.tsx` (NEW — 7 agent cards with health/logs/restart buttons)
- `src/components/atlas/tabs/AtlasAuditTab.tsx` (NEW — verifier_runs + designer_runs timeline)
- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` (NEW — empty wrapper that renders 1.10ak's WorkflowGraph)
- `src/components/atlas/tabs/AtlasArtifactsTab.tsx` (NEW — extracts + extends 1.10w's ArtifactsPane with multi-select from 1.10ak)

Each tab component MUST gracefully render even if its content spec hasn't shipped yet — show a skeleton + "coming soon" line so the cockpit isn't broken on day-1.

**Tab badges:**
- Plan: ⚪ if no plan loaded
- Queue: number of queued specs (e.g., "Queue 3")
- Agents: red dot if any service status≠SUCCESS
- Audit: number of failed verifier runs in last 24h
- Workflows: ⚪ static
- Artifacts: number of pending artifacts

### Part B — Slash command system in chat

**`src/components/atlas/SlashCommandMenu.tsx` (NEW):**

When user types `/` at the start of a chat message, show a popover with the available commands:

| Command | Description | Triggers |
|---|---|---|
| `/fix <error>` | Diagnose + fix an error | calls `/atlas/artifacts/diagnose` (1.10al) |
| `/spec <phase>` | Queue a new spec | calls `builder.queue_spec` |
| `/status` | Status snapshot | calls `status.snapshot` |
| `/queue` | Show queued specs | calls `builder.list_queue` |
| `/done` | Show shipped specs (last 20) | calls `builder.list_done` |
| `/agents` | Show agent health | calls `status.snapshot` + agent ping |
| `/cost` | Cost today + MTD | calls `status.snapshot` |
| `/priority <task> <1-10>` | Set spec priority | calls `builder.set_priority` |
| `/depends <task> <on>` | Set depends-on | calls `builder.set_dependencies` |
| `/plan` | Open Plan tab | navigates to tab |
| `/workflow` | Open Workflow tab | navigates to tab |
| `/help` | Show all commands | renders this list |

**Implementation:**
- Detect `/` at position 0 of input → show popover
- Type to filter (e.g., `/qu` filters to `/queue`)
- Up/Down to navigate, Enter to select, Esc to close
- On select, the command syntax expands inline (e.g., `/spec ` with cursor positioned for the phase argument)
- On submit, the chat handler parses leading `/word` and dispatches to the appropriate tool BEFORE calling Claude. Result is shown both as a tool result AND as a chat message ("Here's the queue: ...").

**`@` mentions:**
- Type `@` → popover shows: Atlas, Builder, Verifier, Designer, Council, Memory, Adela, Designer
- Selecting an agent inserts `@<name>` into the input as a routable token
- Backend uses the mention to address that specific agent (e.g., `@builder restart` → calls Railway redeploy)

### Part C — Inline artifact cards in chat

When a chat message includes a tool call result, render it as an **artifact card** (collapsible) right inside the message bubble — not in a separate pane.

**Component: `src/components/atlas/ArtifactCardInChat.tsx` (NEW)**

Card layout:
```
┌─────────────────────────────────────────────────────┐
│ 🔧 builder.queue_spec                               │
│ Status: ✅ success                                  │
│ Result: phase-1.8-market-price.md queued            │
│ [View full ▼] [Copy as JSON] [Re-run]              │
└─────────────────────────────────────────────────────┘
```

For an ERROR result:
```
┌─────────────────────────────────────────────────────┐
│ ❌ verifier.recent_runs                             │
│ Error: column "created_at" does not exist           │
│ Diagnosis: schema mismatch in tools.ts              │
│ [🔍 Diagnose] [📋 Copy Fix Prompt] [🔄 Retry]       │
└─────────────────────────────────────────────────────┘
```

**Diagnose button** calls 1.10al's `/atlas/artifacts/diagnose` with the tool result as input. The diagnosis result renders in a child card.

**Copy Fix Prompt button:** if diagnosis bucket = `claude-code`, copy the full prompt to clipboard with a toast "Prompt copied — paste in VS Code Claude Code".

**Retry button:** re-executes the same tool call.

This pattern means EVERY error in chat carries its own fix path — the user is never stuck staring at a raw error.

### Part D — Header + agent health dots

**`AtlasHeader.tsx` content:**

Left side:
- Atlas logo (existing emerald icon)
- "Atlas Conductor" title
- Status pill: `🟢 All systems` / `🟡 Degraded` / `🔴 Issue` (computed from latest status_snapshot)
- Trust mode badge: clickable, opens trust mode dialog (passive/chat/confirm/auto)

Right side:
- Cost-today pill: `$4.73` (links to cost detail dialog)
- 7 agent dots in a row (Atlas, Builder, Verifier, Designer, Memory, Council, Adela). Each dot:
  - 🟢 if latest deploy SUCCESS + last heartbeat <5min
  - 🟡 if SUCCESS but heartbeat 5-15min stale
  - 🔴 if FAILED or heartbeat >15min
  - Tooltip on hover shows: service name + last deploy time + last heartbeat + click to open Agents tab
- Settings gear → opens a side drawer with: theme, voice settings, recovery codes, logout

### Part E — Persistent state + URL routing

- Active tab persists in URL: `/atlas?tab=plan` (so the user can bookmark a specific tab)
- Chat thread is always `web-default` (single-user system per 1.10aj)
- Chat panel collapse state persists in localStorage (mobile only)
- Tab badges poll every 5s via existing `/atlas/status` endpoint (no new poll added)

## Files

- `src/pages/Atlas.tsx` (replace — render `<AtlasCockpit />`)
- `src/components/atlas/AtlasCockpit.tsx` (NEW)
- `src/components/atlas/AtlasHeader.tsx` (NEW)
- `src/components/atlas/AtlasTabBar.tsx` (NEW)
- `src/components/atlas/tabs/*Tab.tsx` (NEW × 6)
- `src/components/atlas/SlashCommandMenu.tsx` (NEW)
- `src/components/atlas/MentionMenu.tsx` (NEW)
- `src/components/atlas/ArtifactCardInChat.tsx` (NEW)
- `src/components/atlas/AtlasShell.tsx` (deprecate — re-export from AtlasCockpit for back-compat)
- `src/lib/atlas-slash-commands.ts` (NEW — command registry + parser)

## Success criteria

- `npm run build` clean
- `/atlas` renders the split-pane shell on desktop, bottom-sheet shell on mobile (test viewports 1440px, 768px, 375px)
- Tab clicks update URL `?tab=plan` and back/forward buttons work
- Tab badges show real numbers (queue depth, pending artifacts) within 5s of page load
- Type `/` in chat → command menu appears within 100ms
- `/queue` command shows queue list as both a tool card AND a synthesized text response
- Type `@builder restart` → cockpit confirms before issuing the Railway redeploy
- Trigger an artifact-card error (e.g., call a broken tool) → card renders inline with `[🔍 Diagnose]` button → click → diagnosis shows in child card within 5s
- Tab badges live-update when state changes (e.g., queue a spec → Queue tab badge increments without refresh)
- Header agent dots reflect actual Railway service statuses (verified by Railway CLI cross-check)
- Trust mode badge click → dialog opens → flip to confirm → badge updates → persists across page refresh

## Risks + mitigations

- **Risk:** Tabs are heavy and bundle balloons. **Mitigation:** Lazy-load each tab via `React.lazy(() => import('./tabs/AtlasPlanTab'))`. Initial cockpit bundle stays under 100KB gzipped.
- **Risk:** Slash command menu collides with the user typing literal `/` (e.g., file paths). **Mitigation:** Only trigger if `/` is at position 0 of input AND followed by a letter; otherwise don't show menu.
- **Risk:** Mobile chat-as-bottom-sheet pattern can feel cramped. **Mitigation:** When sheet is collapsed, show a peek bar with the latest message + a "Tap to expand" affordance.
- **Risk:** Existing AtlasShell.tsx imports from many places. **Mitigation:** Keep AtlasShell.tsx as a barrel re-export pointing at AtlasCockpit so callers don't break.

## NEVER list

- Never break the existing chat URL pattern — `web-default` thread persists.
- Never force the user out of the cockpit on a tab error — render an inline error boundary inside the failing tab so the rest of the cockpit (especially chat) keeps working.
- Never auto-execute a slash command that has destructive effects (e.g., `/restart` an agent) without explicit confirmation dialog.
- Never assume the 1.10ak/al/am child specs have shipped — render skeletons gracefully.
