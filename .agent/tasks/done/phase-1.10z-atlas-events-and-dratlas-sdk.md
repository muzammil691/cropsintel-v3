---
priority: 2
depends-on:
  - phase-1.10w-atlas-dashboard-rebuild
  - phase-1.10x-loop-intelligence-and-designer-always-on
---

# Task: Phase 1.10z — atlas_events + drAtlas client SDK + DrAtlasAssistant FAB

**Master plan reference:** §1.6 (Atlas named layer), §11.3 Phase 2.11 (Atlas UI brought forward to Phase 1.10 per user directive 2026-04-30); user directive 2026-05-01 morning: full V1 Atlas vision port with research-driven UI.
**Context:** V1's Atlas had pervasive instrumentation: every page mount, every AI call, every user action emitted to `atlas_events` (41,123 rows accumulated). The DrAtlasAssistant FAB sat on every Atlas surface and called the `dr-atlas` Supabase edge function (Claude Sonnet, 2,307 lines, hallucination-hardened). V3 has none of this. This spec ports the foundation: events table, client SDK, FAB component, and edge function.
**Estimated effort:** ~75 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. **`atlas_events` table** — append-only event stream from anywhere in the V3 product (frontend + edge functions + Railway services). Drives Atlas's project-wide observability.
2. **`drAtlas` client SDK** at `src/lib/drAtlas.ts` — batched event logger consumable from any React component. Mirrors V1's pattern (`drAtlas.log`, `drAtlas.multi_brain`, `drAtlas.zyra_quality`).
3. **`DrAtlasAssistant` FAB** at `src/components/atlas/DrAtlasAssistant.tsx` — floating bottom-right button on every authenticated page. Click → modal chat with Atlas via the `dr-atlas` edge function. Logs every interaction.
4. **`dr-atlas` Supabase edge function** at `supabase/functions/dr-atlas/index.ts` — Claude Sonnet 4.6, system prompt grounded in master plan + V3 codebase awareness. Tracks user pushback, escalates on ambiguity. Ports V1's interaction model + hallucination-hardening (verbatim quotes, no invention).
5. **Wire SDK into existing components** — every page mount calls `drAtlas.log('feature_mount', 'ui', '<page-name>')`. Every Supabase auth state change logs an event. Every error boundary catch logs an event.

## Schema

```sql
-- supabase/migrations/20260501050000_atlas_events.sql
CREATE TABLE IF NOT EXISTS public.atlas_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,         -- 'feature_mount' | 'ai_success' | 'ai_error' | 'user_action' | 'pushback' | 'escalation'
  event_category text NOT NULL,     -- 'atlas' | 'ai' | 'ui' | 'data' | 'auth'
  source text NOT NULL,             -- 'frontend' | 'brain_ai' | 'dr_atlas' | 'zyra' | 'edge_function'
  description text,
  severity text NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'error' | 'critical'
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid REFERENCES auth.users(id),
  session_id text,                  -- client-generated UUID per browser session
  page_path text,                   -- '/dashboard', '/atlas', etc.
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE atlas_events ENABLE ROW LEVEL SECURITY;

-- Insert open to authenticated users (instrumentation must work)
CREATE POLICY "atlas_events_insert_authed"
  ON atlas_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Read: admin only
CREATE POLICY "atlas_events_read_admin"
  ON atlas_events FOR SELECT
  USING (public.has_role(auth.uid(), 'team') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_atlas_events_created ON atlas_events (created_at DESC);
CREATE INDEX idx_atlas_events_type_category ON atlas_events (event_type, event_category, created_at DESC);
CREATE INDEX idx_atlas_events_user ON atlas_events (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_atlas_events_severity ON atlas_events (severity, created_at DESC) WHERE severity IN ('error', 'critical');
```

## drAtlas client SDK

```typescript
// src/lib/drAtlas.ts
import { supabase } from './supabase'

export type Severity = 'info' | 'warning' | 'error' | 'critical'

export interface AtlasEventInput {
  event_type: string
  event_category: 'atlas' | 'ai' | 'ui' | 'data' | 'auth'
  source: 'frontend' | 'brain_ai' | 'dr_atlas' | 'zyra' | 'edge_function'
  description?: string
  severity?: Severity
  metadata?: Record<string, unknown>
}

const SESSION_KEY = 'cropsintel.atlas.session_id'
const FLUSH_INTERVAL_MS = 1000
const MAX_BATCH_SIZE = 25
const MAX_QUEUE_SIZE = 500

let queue: AtlasEventInput[] = []
let flushing = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

async function flush() {
  if (flushing || queue.length === 0) return
  flushing = true
  try {
    const batch = queue.splice(0, MAX_BATCH_SIZE)
    const { data: { user } } = await supabase.auth.getUser()
    const rows = batch.map(e => ({
      ...e,
      severity: e.severity ?? 'info',
      metadata: e.metadata ?? {},
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      page_path: window.location.pathname,
    }))
    const { error } = await supabase.from('atlas_events').insert(rows)
    if (error) {
      console.warn('[drAtlas] flush failed:', error.message)
      // Re-queue — but bound the queue to avoid OOM
      if (queue.length + batch.length < MAX_QUEUE_SIZE) {
        queue.unshift(...batch)
      }
    }
  } finally {
    flushing = false
    if (queue.length > 0) scheduleFlush()
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
}

function enqueue(event: AtlasEventInput) {
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift() // drop oldest
  }
  queue.push(event)
  scheduleFlush()
}

export const drAtlas = {
  log(event_type: string, event_category: AtlasEventInput['event_category'], description: string, options: Partial<AtlasEventInput> = {}) {
    enqueue({
      event_type,
      event_category,
      source: options.source ?? 'frontend',
      description,
      severity: options.severity,
      metadata: options.metadata,
    })
  },
  multi_brain(action: string, node_key: string, success: boolean, models: string[]) {
    enqueue({
      event_type: success ? 'ai_success' : 'ai_error',
      event_category: 'ai',
      source: 'brain_ai',
      description: `Multi-Brain ${action} on ${node_key}: ${success ? 'success' : 'failed'} (${models.join(', ')})`,
      severity: success ? 'info' : 'error',
    })
  },
  zyra_quality(query: string, helpful: boolean, asked_again: boolean) {
    if (helpful && !asked_again) return
    enqueue({
      event_type: 'ai_error',
      event_category: 'ai',
      source: 'zyra',
      description: `Zyra quality issue: ${query.slice(0, 80)}`,
      severity: 'warning',
      metadata: { helpful, asked_again },
    })
  },
  pushback(reason: string, context: Record<string, unknown> = {}) {
    enqueue({
      event_type: 'pushback',
      event_category: 'atlas',
      source: 'dr_atlas',
      description: reason,
      severity: 'warning',
      metadata: context,
    })
  },
}

// Auto-flush on page hide (sendBeacon would be better; fallback for now)
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush())
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
}
```

## DrAtlasAssistant FAB component

`src/components/atlas/DrAtlasAssistant.tsx` — floating bottom-right button. On click, opens a modal panel with chat thread. Calls `dr-atlas` edge function. Renders messages with markdown + tool chips. Each user message + assistant reply logs to `atlas_events` via drAtlas.log. Mobile: full-screen modal; desktop: 400px-wide right-side sheet.

Mount inside `src/App.tsx` so it's globally available, but only renders when authenticated. Use existing `useAuth()` hook.

## dr-atlas edge function

`supabase/functions/dr-atlas/index.ts` — Deno runtime. POST handler accepting `{ thread_id, message, page_path }`. Calls Claude Sonnet 4.6 with a system prompt that:
- Names Atlas's role: "You are Dr. Atlas — the helper assistant inside CropsIntel V3."
- Includes V3 master plan summary (§1.6 layers, NEVER list, key invariants).
- Includes the user's current page context.
- Instructs honesty rules from 1.10q (no fabrication; surface tool calls; verified footer).
- Responds with markdown.

Reply streamed via SSE. CORS headers for V3 frontend domain.

```typescript
// supabase/functions/dr-atlas/index.ts (sketch)
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.40.0"

const SYSTEM_PROMPT = `You are Dr. Atlas, a helper assistant inside CropsIntel V3. Speak concisely and never fabricate. ...`

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  // Auth: verify Supabase JWT
  const auth = req.headers.get('Authorization')
  if (!auth) return new Response('unauthorized', { status: 401 })
  // ...stream Claude reply via SSE...
})
```

Secrets needed in Supabase: `ANTHROPIC_API_KEY` (already configured for V3).

## Wiring into existing components

- `src/App.tsx` — render `<DrAtlasAssistant />` inside the routed Suspense, only when `useAuth().user` is present.
- `src/pages/*.tsx` — each page component calls `useEffect(() => drAtlas.log('feature_mount', 'ui', '<page-name>'), [])` once.
- `src/components/ErrorBoundary.tsx` — extend `componentDidCatch` to call `drAtlas.log('error', 'ui', error.message, { severity: 'error', metadata: { stack: errorInfo.componentStack } })`.

## Files

- `supabase/migrations/20260501050000_atlas_events.sql` (NEW)
- `src/lib/drAtlas.ts` (NEW)
- `src/components/atlas/DrAtlasAssistant.tsx` (NEW)
- `src/components/atlas/DrAtlasModal.tsx` (NEW — modal wrapper, splits the FAB cleanly)
- `supabase/functions/dr-atlas/index.ts` (NEW)
- `src/App.tsx` (extend — render FAB)
- `src/components/ErrorBoundary.tsx` (extend — log to drAtlas)
- `src/pages/{Atlas,Dashboard,Welcome,Auth}.tsx` (extend — feature_mount log on each)

## Success criteria

- `npm run build` clean
- After deploy + login, navigating between pages produces rows in `atlas_events` (verify via Supabase SQL)
- DrAtlasAssistant FAB visible bottom-right on all authenticated pages, hidden when unauthenticated
- Click FAB → modal opens → chat with dr-atlas works → reply streams → both messages logged
- Lighthouse mobile ≥85, accessibility ≥95
- Designer agent post-audit verdict ≥ 0.7 (per 1.10x — Designer is now always-on for UI commits)
- No `console.error`s during normal use
- Network panel shows batched insert calls (multiple events bundled into one Supabase request, not 1-per-event)

## Risks + mitigations

- **Risk:** atlas_events grows huge (V1 had 41k rows). **Mitigation:** index on `created_at DESC`; add Supabase scheduled function in 1.10ad to aggregate + archive rows older than 30 d.
- **Risk:** drAtlas leaks user PII into `metadata`. **Mitigation:** SDK strips fields matching common-PII regex (`email`, `phone`, `password`, `token`) from metadata before insert.
- **Risk:** dr-atlas edge function rate-limits / cost spikes. **Mitigation:** rate-limit per-user-per-minute (5 messages); cost log per call to `atlas_cost_log`.
- **Risk:** FAB visual conflicts with PWA install prompt or other floating UI. **Mitigation:** z-index hierarchy doc in `src/lib/z-indexes.ts`; FAB at z-40, PWA prompt at z-30.

## NEVER list

- Never log API keys, passwords, or auth tokens to atlas_events
- Never store full message bodies in metadata (descriptions only — keeps PII contained)
- Never expose `dr-atlas` edge fn URL/key to client bundle (uses Supabase function invocation pattern)
- Never block UI on event flush (always async, fire-and-forget)
