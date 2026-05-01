// Phase 1.10z — drAtlas client SDK
//
// Batched event logger consumable from any React component or library code.
// Mirrors V1's pattern (drAtlas.log, drAtlas.multi_brain, drAtlas.zyra_quality)
// so admin tooling rebuilds in V3 talk to the same shape.
//
// Behavior:
//   - Fire-and-forget: callers never await
//   - Batches up to MAX_BATCH_SIZE events into one Supabase insert
//   - Bounded queue (MAX_QUEUE_SIZE) — drops oldest if overrun
//   - Auto-flush on visibilitychange/pagehide so we don't lose tail events
//   - Strips PII-shaped fields from metadata before insert

import { supabase } from './supabase'

export type Severity = 'info' | 'warning' | 'error' | 'critical'
export type EventCategory = 'atlas' | 'ai' | 'ui' | 'data' | 'auth'
export type EventSource =
  | 'frontend'
  | 'brain_ai'
  | 'dr_atlas'
  | 'zyra'
  | 'edge_function'

export interface AtlasEventInput {
  event_type: string
  event_category: EventCategory
  source: EventSource
  description?: string
  severity?: Severity
  metadata?: Record<string, unknown>
}

const SESSION_KEY = 'cropsintel.atlas.session_id'
const FLUSH_INTERVAL_MS = 1000
const MAX_BATCH_SIZE = 25
const MAX_QUEUE_SIZE = 500

const PII_KEY_PATTERN = /(email|phone|password|token|secret|api[_-]?key|authorization|bearer|jwt)/i

let queue: AtlasEventInput[] = []
let flushing = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') {
    return crypto.randomUUID()
  }
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

// Drop any top-level metadata key whose name looks like PII. Keeps shape intact
// so admins still see "this event had a token field" without leaking the value.
function scrubMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(metadata)) {
    if (PII_KEY_PATTERN.test(k)) {
      out[k] = '[redacted]'
    } else {
      out[k] = v
    }
  }
  return out
}

async function flush() {
  if (flushing || queue.length === 0) return
  flushing = true
  try {
    const batch = queue.splice(0, MAX_BATCH_SIZE)
    const { data: { user } } = await supabase.auth.getUser()
    const rows = batch.map((e) => ({
      event_type: e.event_type,
      event_category: e.event_category,
      source: e.source,
      description: e.description ?? null,
      severity: e.severity ?? 'info',
      metadata: scrubMetadata(e.metadata),
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      page_path: typeof window !== 'undefined' ? window.location.pathname : null,
    }))
    // Cast: atlas_events ships in migration 20260501070000 — not in
    // generated types until `supabase gen types` is rerun post-deploy.
    const { error } = await (supabase as unknown as {
      from: (t: string) => { insert: (rows: unknown) => Promise<{ error: { message: string } | null }> }
    }).from('atlas_events').insert(rows)
    if (error) {
      console.warn('[drAtlas] flush failed:', error.message)
      // Re-queue, but bound the queue so a persistent failure can't OOM the tab
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
    queue.shift()
  }
  queue.push(event)
  scheduleFlush()
}

export const drAtlas = {
  log(
    event_type: string,
    event_category: EventCategory,
    description: string,
    options: Partial<Omit<AtlasEventInput, 'event_type' | 'event_category' | 'description'>> = {},
  ) {
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

  // Exposed for tests + the dr-atlas modal which wants to push tail events
  // before unmounting. Returns a promise so tests can await it.
  async _flush() {
    await flush()
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush())
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
}
