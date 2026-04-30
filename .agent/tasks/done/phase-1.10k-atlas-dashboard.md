# Task: Phase 1.10k — Atlas dashboard frontend (chat panel + status grid)

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §13 (dashboard frontend layout)
**Context:** This is Atlas's user interface — the page Muzammil opens to chat, see status, and approve/reject confirm-mode dispatches. Built with React + Tailwind + shadcn/ui, consistent with the rest of CropsIntel V3 frontend (which is mostly NotImplemented placeholders today; Atlas dashboard is one of the first real pages).
**Estimated effort:** ~3-4 hours of Builder time (largest single task in 1.10 series)
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Build a single React page at `src/pages/Atlas.tsx` that contains:
- **Left column** (~60% width on desktop): Chat panel — SSE-streaming conversation with Atlas
- **Right column** (~40% width): Live status grid — current phase, queue counts, verifier pass rate, cost burn, recent ships, open forks
- **Top bar**: Wizards — "Open Phase", "Review Audit", "Approve ADR", "Set Trust Mode"
- **Mobile**: Tabs (chat default) instead of two columns
- Add a route `/atlas` in `src/App.tsx`

## Files to create

```
src/pages/Atlas.tsx
src/components/atlas/ChatPanel.tsx          # left column — chat UI
src/components/atlas/StatusGrid.tsx         # right column — live status
src/components/atlas/WizardBar.tsx          # top — quick actions
src/components/atlas/TrustModeBadge.tsx     # current mode pill (passive/chat/confirm/auto/stopped)
src/components/atlas/CostMeter.tsx          # progress bar showing $today / $month / $400
src/components/atlas/ForkList.tsx           # open architectural forks awaiting decision
src/components/atlas/RecentShips.tsx        # last 10 verifier_runs / git commits
src/lib/atlas-client.ts                     # API client wrapping Atlas endpoints
src/hooks/useAtlasStatus.ts                 # subscribes to /atlas/status, polls every 5s
src/hooks/useAtlasChat.ts                   # SSE chat hook
```

## API client

### src/lib/atlas-client.ts

```ts
const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? 'https://courteous-simplicity-production.up.railway.app'
const ATLAS_TOKEN = import.meta.env.VITE_ATLAS_API_TOKEN  // see security note below

export async function fetchStatus() {
  const res = await fetch(`${ATLAS_URL}/atlas/status`, {
    headers: { 'Authorization': `Bearer ${ATLAS_TOKEN}` },
  })
  return res.json()
}

export async function fetchCosts() {
  const res = await fetch(`${ATLAS_URL}/atlas/costs`, {
    headers: { 'Authorization': `Bearer ${ATLAS_TOKEN}` },
  })
  return res.json()
}

export async function fetchMode() {
  const res = await fetch(`${ATLAS_URL}/atlas/mode`, {
    headers: { 'Authorization': `Bearer ${ATLAS_TOKEN}` },
  })
  return res.json()
}

export async function setMode(mode: string) {
  const res = await fetch(`${ATLAS_URL}/atlas/mode`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ATLAS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, setBy: 'web-ui' }),
  })
  return res.json()
}

// SSE chat — caller passes onEvent callback
export function streamChat(threadId: string, message: string, onEvent: (event: string, data: any) => void): () => void {
  const controller = new AbortController()
  fetch(`${ATLAS_URL}/atlas/chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ATLAS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId, channel: 'web', message }),
    signal: controller.signal,
  }).then(async res => {
    if (!res.ok || !res.body) {
      onEvent('error', { error: `HTTP ${res.status}` })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      let currentEvent = 'message'
      for (const line of lines) {
        if (line.startsWith('event: ')) currentEvent = line.slice(7).trim()
        else if (line.startsWith('data: ')) {
          try { onEvent(currentEvent, JSON.parse(line.slice(6))) } catch {}
        }
      }
    }
  }).catch(err => {
    if (err.name !== 'AbortError') onEvent('error', { error: String(err) })
  })
  return () => controller.abort()
}
```

**SECURITY NOTE — IMPORTANT:** Putting `VITE_ATLAS_API_TOKEN` in the client bundle violates master plan rule "no client-side AI keys" (it's not an AI key but it IS a server credential). This is a TEMPORARY arrangement for v0.1 since Atlas is single-user and the token is in the user's own bundle. **Better long-term solution: serve a magic-link auth flow or use Supabase Auth + RLS-protected proxy endpoint.** Document this clearly in `.agent/questions/phase-1.10k-q.md` and flag the trade-off.

## Layout

### src/pages/Atlas.tsx

```tsx
import { ChatPanel } from '@/components/atlas/ChatPanel'
import { StatusGrid } from '@/components/atlas/StatusGrid'
import { WizardBar } from '@/components/atlas/WizardBar'
import { TrustModeBadge } from '@/components/atlas/TrustModeBadge'
import { useAtlasStatus } from '@/hooks/useAtlasStatus'

export default function Atlas() {
  const { status, loading, error } = useAtlasStatus()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Atlas</h1>
          <TrustModeBadge mode={status?.trust_mode ?? 'passive'} />
        </div>
        <WizardBar />
      </header>

      <main className="grid md:grid-cols-[1.5fr_1fr] gap-4 p-4 max-w-screen-2xl mx-auto">
        <section className="md:order-1 order-2">
          <ChatPanel />
        </section>
        <aside className="md:order-2 order-1">
          <StatusGrid status={status} loading={loading} error={error} />
        </aside>
      </main>
    </div>
  )
}
```

### Status grid (right column)

Shows the latest snapshot data from `/atlas/status`:
- Current phase (large heading)
- 4 KPI cards: queued, in-flight, done (24h), failed (24h)
- CostMeter component
- Verifier pass rate sparkline (last 24h)
- ForkList (open forks; each is clickable to open a decision modal)
- RecentShips (last 10 commits + verifier verdicts)

Use shadcn/ui Card component for each section. Tailwind for layout.

### Chat panel (left column)

- Scrollable message history (loaded on mount via paginated fetch — fetch last 50 messages from `atlas_conversations` for current thread)
- Input at bottom (textarea + Send button)
- During SSE stream: show "Atlas is thinking..." indicator; render text events as they arrive
- Render `tool_call` events as collapsible chips ("🔍 memory.search → ...")
- Render `tool_result` events inline under the corresponding tool_call
- Markdown rendering for Atlas messages (use `react-markdown` library)

### Wizard bar

Buttons that pre-fill the chat input with templated prompts:
- **Open Phase** → "Open Phase X.Y" (input prompts which phase)
- **Review Audit** → "Show me the most recent failed audit and what should we do?"
- **Approve ADR** → opens modal listing pending atlas_decisions; user clicks one to approve
- **Set Trust Mode** → dropdown with passive/chat/confirm/auto/stopped; calls `/atlas/mode`

## Hooks

### src/hooks/useAtlasStatus.ts

Polls `/atlas/status` every 5s. Returns `{ status, loading, error }`.

### src/hooks/useAtlasChat.ts

Manages chat state (messages array, isStreaming flag, send function). Wraps `streamChat` from atlas-client.

## Routing

In `src/App.tsx`, add the route:
```tsx
<Route path="/atlas" element={<Atlas />} />
```

Also add a navigation link if there's a sidebar or header.

## Acceptance criteria

After this task ships:

1. Navigate to `https://muzammil691.github.io/cropsintel-v3/atlas` → page loads.
2. Status grid shows non-zero values for memory_chunk_count, queued_specs.
3. Type "What's the queue?" in chat → see SSE events stream → final reply renders correctly.
4. Tool_call events render as collapsed chips; clicking expands to show args + result.
5. Cost meter shows progress bar reflecting today / month-to-date.
6. Setting trust mode via dropdown → page state updates within 5s.
7. Mobile responsive: at < 768px, columns stack with chat on top.

## Required env vars (Vite — these go in cropsintel-v3/.env or GitHub Pages secrets)

```
VITE_ATLAS_URL=https://courteous-simplicity-production.up.railway.app
VITE_ATLAS_API_TOKEN=cropsintel-atlas-token-2026-04-30
```

These get baked into the client bundle. **This is the security trade-off documented above** — for single-user v0.1, acceptable. Replace with Supabase Auth-gated proxy in a follow-up.

## Out of scope

- Multi-user support (treat as single-user Muzammil for v0.1)
- Conversation export
- Threaded conversations (one default thread for now)
- Search across past conversations
- Light/dark theme toggle (use system preference)
- Real-time updates via Supabase realtime (poll every 5s for v0.1)

## Notes

- Use existing CropsIntel V3 React stack — don't introduce new UI libraries beyond what's already in package.json.
- shadcn/ui is preferred — components like Card, Button, Input, Dialog should already be available.
- For SSE, use plain fetch + ReadableStream (no eventsource library; eventsource doesn't support custom headers well).
- Dashboard is a single page route — keep it simple. Don't build a multi-page admin UI.
- This task is large (~3-4 hours Builder time). Consider failing gracefully if Builder runs out of context — the spec is structured so partial implementation (status grid only, no chat) still ships something useful.
