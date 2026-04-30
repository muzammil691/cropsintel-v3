# Task: Phase 1.10d — Atlas tool registry + dispatcher

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §7 (tool registry)
**Context:** Atlas's brain decides what to do next; the tool registry is HOW it does anything. Each tool is a typed function that calls Memory's /search, Council's endpoints, the file system (queue Builder specs), Verifier's /audit, etc. The dispatcher executes a chosen tool with arguments, logs to atlas_dispatches, returns the result.
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Implement `atlas/src/lib/tools.ts` (the registry) and `atlas/src/lib/dispatch.ts` (the executor that wraps each call with logging + cost tracking + trust-mode gating).

## Tools to implement

Mirror the master spec §7 exactly. Each tool is an async function with a typed input/output. Group by domain.

### atlas/src/lib/tools.ts

```ts
import { getSupabaseClient } from './supabase'
import { writeFile, readdir, rename } from 'fs/promises'
import { resolve } from 'path'

const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
const MEMORY_URL = process.env.MEMORY_URL ?? 'https://cooperative-rejoicing-production.up.railway.app'
const MEMORY_TOKEN = process.env.MEMORY_API_TOKEN
const VERIFIER_URL = process.env.VERIFIER_URL ?? 'https://rare-happiness-production.up.railway.app'
const VERIFIER_TOKEN = process.env.VERIFIER_API_TOKEN
const COUNCIL_URL = process.env.COUNCIL_URL ?? 'https://just-reflection-production.up.railway.app'
const COUNCIL_TOKEN = process.env.COUNCIL_API_TOKEN
const ADELA_URL = process.env.ADELA_URL ?? 'https://believable-warmth-production.up.railway.app'
const ADELA_TOKEN = process.env.ADELA_API_TOKEN
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+12345622692'  // Maxons; will swap when Atlas has dedicated number

// ─── Memory ─────────────────────────────────────────────────────────────────

export async function memorySearch(query: string, opts?: { limit?: number; sources?: string[] }): Promise<unknown> {
  const res = await fetch(`${MEMORY_URL}/search`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MEMORY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: opts?.limit ?? 10, sources: opts?.sources }),
  })
  if (!res.ok) throw new Error(`memory.search failed: ${res.status}`)
  return res.json()
}

export async function memoryIngest(source: string): Promise<unknown> {
  const res = await fetch(`${MEMORY_URL}/ingest`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MEMORY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  if (!res.ok) throw new Error(`memory.ingest failed: ${res.status}`)
  return res.json()
}

// ─── Builder (file-system based) ────────────────────────────────────────────

export async function builderQueueSpec(filename: string, body: string): Promise<{ path: string }> {
  if (!filename.endsWith('.md')) throw new Error('builder.queue_spec: filename must end in .md')
  if (!filename.startsWith('phase-')) throw new Error('builder.queue_spec: filename must start with "phase-"')
  const path = resolve(REPO_ROOT, '.agent/tasks/queued', filename)
  await writeFile(path, body, 'utf-8')
  return { path }
}

export async function builderListQueue(): Promise<{ specs: string[] }> {
  const dir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const files = await readdir(dir)
  return { specs: files.filter(f => f.endsWith('.md') && f !== '_template.md') }
}

export async function builderCancelTask(taskId: string): Promise<{ moved_to: string }> {
  const fromPath = resolve(REPO_ROOT, '.agent/tasks/queued', `${taskId}.md`)
  const toPath = resolve(REPO_ROOT, '.agent/tasks/cancelled', `${taskId}.md`)
  await rename(fromPath, toPath)
  return { moved_to: toPath }
}

// ─── Verifier ───────────────────────────────────────────────────────────────

export async function verifierAudit(taskId: string, headBefore?: string, headAfter?: string): Promise<unknown> {
  const res = await fetch(`${VERIFIER_URL}/audit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VERIFIER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, head_before: headBefore, head_after: headAfter }),
  })
  return res.json()
}

export async function verifierRecentRuns(limit = 10): Promise<unknown> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('verifier_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return { runs: data ?? [] }
}

// ─── Council ────────────────────────────────────────────────────────────────

export async function councilWriteSpec(phase: string, context?: string): Promise<unknown> {
  const res = await fetch(`${COUNCIL_URL}/write-spec`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${COUNCIL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase, context }),
  })
  return res.json()
}

// ─── Adela ──────────────────────────────────────────────────────────────────

export async function adelaTriggerScrape(source: string): Promise<unknown> {
  const res = await fetch(`${ADELA_URL}/scrape`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADELA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  return res.json()
}

// ─── Notification (WhatsApp via Twilio direct API) ──────────────────────────

export async function whatsappSend(to: string, body: string): Promise<{ sid: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) throw new Error('whatsapp.send: Twilio creds not set')
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM_NUMBER}`,
    To: `whatsapp:${to}`,
    Body: body,
  })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`whatsapp.send failed: ${res.status}`)
  const data = await res.json() as { sid: string }
  return { sid: data.sid }
}

// ─── Status (computed locally, no external call) ────────────────────────────

export async function statusSnapshot(): Promise<unknown> {
  const sb = getSupabaseClient()
  // Compute counts from filesystem + DB
  const queuedDir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const inProgressDir = resolve(REPO_ROOT, '.agent/tasks/in-progress')
  const doneDir = resolve(REPO_ROOT, '.agent/tasks/done')
  const failedDir = resolve(REPO_ROOT, '.agent/tasks/failed')

  const [queued, inProgress, doneList, failedList] = await Promise.all([
    readdir(queuedDir).catch(() => []),
    readdir(inProgressDir).catch(() => []),
    readdir(doneDir).catch(() => []),
    readdir(failedDir).catch(() => []),
  ])

  const filterMd = (files: string[]) => files.filter(f => f.endsWith('.md') && f !== '_template.md')

  const { count: chunkCount } = await sb.from('memory_chunks').select('*', { count: 'exact', head: true })
  const { data: costToday } = await sb.from('atlas_cost_today').select('cost_usd').single()
  const { data: costMonth } = await sb.rpc('sum', { table: 'atlas_cost_month_to_date', col: 'cost_usd' }).maybeSingle().catch(() => ({ data: null }))

  return {
    takenAt: new Date().toISOString(),
    queuedSpecs: filterMd(queued).length,
    inFlightSpecs: filterMd(inProgress).length,
    doneSpecsTotal: filterMd(doneList).length,
    failedSpecsTotal: filterMd(failedList).length,
    memoryChunkCount: chunkCount ?? 0,
    costTodayUsd: (costToday as { cost_usd: number })?.cost_usd ?? 0,
  }
}

// ─── Tool registry (for LLM function-calling) ───────────────────────────────

export const TOOLS = {
  'memory.search':         { fn: memorySearch,         description: 'Search the institutional knowledge base (master plan, audits, codebases). Use for context lookups.' },
  'memory.ingest':         { fn: memoryIngest,         description: 'Trigger ingest of a knowledge source. Sources: master-plan, workflow-doc, audits, github-history, adrs, conversations, v2-codebase, v1-codebase, all.' },
  'builder.queue_spec':    { fn: builderQueueSpec,     description: 'Queue a new task spec for Builder by writing a markdown file to .agent/tasks/queued/. filename must start with "phase-" and end ".md".' },
  'builder.list_queue':    { fn: builderListQueue,     description: 'List the current queue of tasks waiting for Builder.' },
  'builder.cancel_task':   { fn: builderCancelTask,    description: 'Cancel a queued task by moving it to cancelled/.' },
  'verifier.audit':        { fn: verifierAudit,        description: 'Trigger Verifier to audit a task by ID and HEAD range. Returns verdict + gaps.' },
  'verifier.recent_runs':  { fn: verifierRecentRuns,   description: 'List recent verifier audit runs.' },
  'council.write_spec':    { fn: councilWriteSpec,     description: 'Ask Council to decompose a phase into a task spec.' },
  'adela.trigger_scrape':  { fn: adelaTriggerScrape,   description: 'Trigger Adela to run a scraper. Sources: usda-nass, abc-objective, news-rss, etc.' },
  'whatsapp.send':         { fn: whatsappSend,         description: 'Send a WhatsApp message to a number. to=E.164 format like +971501234567.' },
  'status.snapshot':       { fn: statusSnapshot,       description: 'Compute and return a fresh project status snapshot.' },
} as const

export type ToolName = keyof typeof TOOLS
```

### atlas/src/lib/dispatch.ts

```ts
import { TOOLS, ToolName } from './tools'
import { getSupabaseClient } from './supabase'
import { TrustMode } from '../types'

export interface DispatchRequest {
  tool: ToolName
  arguments: Record<string, unknown>
  initiatedBy: string  // 'cron' | 'chat:<thread_id>' | 'auto'
  trustMode: TrustMode
}

export interface DispatchResult {
  dispatchId: string
  status: 'success' | 'failed' | 'blocked'
  result?: unknown
  error?: string
  durationMs: number
}

const READ_ONLY_TOOLS = new Set<ToolName>([
  'memory.search', 'builder.list_queue', 'verifier.recent_runs', 'status.snapshot',
])

export async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
  const start = Date.now()
  const sb = getSupabaseClient()

  // Trust mode gating
  if (req.trustMode === 'stopped') {
    return { dispatchId: '', status: 'blocked', error: 'Atlas is in stopped mode; no dispatches allowed.', durationMs: 0 }
  }
  if (req.trustMode === 'passive' && !READ_ONLY_TOOLS.has(req.tool)) {
    return { dispatchId: '', status: 'blocked', error: `Atlas is in passive mode; tool '${req.tool}' is write-capable and not allowed.`, durationMs: 0 }
  }
  if (req.trustMode === 'chat' && !READ_ONLY_TOOLS.has(req.tool)) {
    return { dispatchId: '', status: 'blocked', error: `Atlas is in chat mode; tool '${req.tool}' is write-capable. Switch to confirm/auto.`, durationMs: 0 }
  }
  // 'confirm' mode: caller is expected to have already obtained user consent before calling dispatch()
  // 'auto' mode: cost gatekeeper applies (see future 1.10g task)

  // Insert pending row
  const { data: pendingRow, error: insertErr } = await sb.from('atlas_dispatches').insert({
    trust_mode: req.trustMode,
    initiated_by: req.initiatedBy,
    tool: req.tool,
    arguments: req.arguments,
    status: 'pending',
  }).select('id').single()

  if (insertErr || !pendingRow) {
    return { dispatchId: '', status: 'failed', error: `dispatch log insert failed: ${insertErr?.message ?? 'unknown'}`, durationMs: 0 }
  }

  const dispatchId = pendingRow.id as string

  // Execute the tool
  const tool = TOOLS[req.tool]
  if (!tool) {
    await sb.from('atlas_dispatches').update({ status: 'failed', error_message: `unknown tool: ${req.tool}`, duration_ms: Date.now() - start }).eq('id', dispatchId)
    return { dispatchId, status: 'failed', error: `unknown tool: ${req.tool}`, durationMs: Date.now() - start }
  }

  try {
    const args = Object.values(req.arguments)
    const result = await (tool.fn as (...a: unknown[]) => Promise<unknown>)(...args)
    const duration = Date.now() - start
    await sb.from('atlas_dispatches').update({ status: 'success', result, duration_ms: duration }).eq('id', dispatchId)
    return { dispatchId, status: 'success', result, durationMs: duration }
  } catch (err) {
    const duration = Date.now() - start
    const errorMsg = err instanceof Error ? err.message : String(err)
    await sb.from('atlas_dispatches').update({ status: 'failed', error_message: errorMsg, duration_ms: duration }).eq('id', dispatchId)
    return { dispatchId, status: 'failed', error: errorMsg, durationMs: duration }
  }
}
```

## Acceptance criteria

After this task ships:

1. `atlas/src/lib/tools.ts` and `atlas/src/lib/dispatch.ts` exist and TypeScript-compile.
2. `cd atlas && npm run build` succeeds.
3. Smoke test script `atlas/scripts/test-tools.ts` (created by this task) calls:
   - `memorySearch("Phase 1.10 Atlas")` → returns at least 1 chunk
   - `statusSnapshot()` → returns object with non-null `queuedSpecs` and `memoryChunkCount`
   - `builderListQueue()` → returns array including `phase-1.10b-atlas-schema.md`
4. After running smoke test, `atlas_dispatches` table has 3+ rows with `status='success'`.
5. Trust-mode gate works: calling `dispatch({tool: 'memory.ingest', trustMode: 'passive', ...})` returns `status: 'blocked'`.

## Out of scope

- Cost gatekeeper enforcement (1.10g)
- Master plan invariants (1.10h)
- Frontend tool-call visibility (1.10k)
- Function-calling integration with chat (1.10e ties this together)

## Notes

- All HTTP calls use plain `fetch` (Node 22 has it native). No axios.
- Each tool function is a thin wrapper — no orchestration logic. The brain decides; tools just execute.
- For tools that need streaming (future), this layer returns the final result; streaming happens in chat handler.
- The `(...a: unknown[])` cast in dispatch is a known workaround for TypeScript's strict any-spread. Acceptable here because we own the tool registry.
