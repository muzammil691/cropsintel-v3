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
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+12345622692' // Maxons; swap when Atlas has dedicated number

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
  if (!sb) throw new Error('Supabase client not configured')
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
  if (!sb) throw new Error('Supabase client not configured')

  const queuedDir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const inProgressDir = resolve(REPO_ROOT, '.agent/tasks/in-progress')
  const doneDir = resolve(REPO_ROOT, '.agent/tasks/done')
  const failedDir = resolve(REPO_ROOT, '.agent/tasks/failed')

  const [queued, inProgress, doneList, failedList] = await Promise.all([
    readdir(queuedDir).catch(() => [] as string[]),
    readdir(inProgressDir).catch(() => [] as string[]),
    readdir(doneDir).catch(() => [] as string[]),
    readdir(failedDir).catch(() => [] as string[]),
  ])

  const filterMd = (files: string[]) => files.filter(f => f.endsWith('.md') && f !== '_template.md')

  const { count: chunkCount } = await sb.from('memory_chunks').select('*', { count: 'exact', head: true })
  let costToday: { cost_usd: number } | null = null
  try {
    const res = await sb.from('atlas_cost_today').select('cost_usd').maybeSingle()
    costToday = res.data as { cost_usd: number } | null
  } catch {
    // view may not exist yet; treat as zero
  }

  return {
    takenAt: new Date().toISOString(),
    queuedSpecs: filterMd(queued).length,
    inFlightSpecs: filterMd(inProgress).length,
    doneSpecsTotal: filterMd(doneList).length,
    failedSpecsTotal: filterMd(failedList).length,
    memoryChunkCount: chunkCount ?? 0,
    costTodayUsd: costToday?.cost_usd ?? 0,
  }
}

// ─── Tool registry (for LLM function-calling) ───────────────────────────────

export const TOOLS = {
  'memory.search':        { fn: memorySearch,       description: 'Search the institutional knowledge base (master plan, audits, codebases). Use for context lookups.' },
  'memory.ingest':        { fn: memoryIngest,       description: 'Trigger ingest of a knowledge source. Sources: master-plan, workflow-doc, audits, github-history, adrs, conversations, v2-codebase, v1-codebase, all.' },
  'builder.queue_spec':   { fn: builderQueueSpec,   description: 'Queue a new task spec for Builder by writing a markdown file to .agent/tasks/queued/. filename must start with "phase-" and end ".md".' },
  'builder.list_queue':   { fn: builderListQueue,   description: 'List the current queue of tasks waiting for Builder.' },
  'builder.cancel_task':  { fn: builderCancelTask,  description: 'Cancel a queued task by moving it to cancelled/.' },
  'verifier.audit':       { fn: verifierAudit,      description: 'Trigger Verifier to audit a task by ID and HEAD range. Returns verdict + gaps.' },
  'verifier.recent_runs': { fn: verifierRecentRuns, description: 'List recent verifier audit runs.' },
  'council.write_spec':   { fn: councilWriteSpec,   description: 'Ask Council to decompose a phase into a task spec.' },
  'adela.trigger_scrape': { fn: adelaTriggerScrape, description: 'Trigger Adela to run a scraper. Sources: usda-nass, abc-objective, news-rss, etc.' },
  'whatsapp.send':        { fn: whatsappSend,       description: 'Send a WhatsApp message to a number. to=E.164 format like +971501234567.' },
  'status.snapshot':      { fn: statusSnapshot,     description: 'Compute and return a fresh project status snapshot.' },
} as const

export type ToolName = keyof typeof TOOLS
