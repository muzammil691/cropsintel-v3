import { getSupabaseClient } from './supabase'
import { writeFile, readdir, rename } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { draftSpec, type DraftResult } from './spec-draft'
import { getCurrentMode } from './trust-mode'
import { checkInvariants } from './invariants'

const execFileP = promisify(execFile)

const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

// ─── Git helper for autonomous Atlas commits ────────────────────────────────
async function gitCommitAndPush(commitMsg: string, filesToAdd: string[]): Promise<{ sha: string; pushed: boolean }> {
  // Pull first to avoid stale-base conflicts
  try {
    await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO_ROOT })
  } catch (err) {
    console.warn('[atlas-git] pull failed (continuing):', err)
  }
  // Stage files
  for (const f of filesToAdd) {
    await execFileP('git', ['add', f], { cwd: REPO_ROOT })
  }
  // Commit
  try {
    await execFileP('git', ['-c', 'user.name=Atlas', '-c', 'user.email=atlas@cropsintel.local', 'commit', '-m', commitMsg], { cwd: REPO_ROOT })
  } catch (err) {
    // Probably nothing to commit
    console.warn('[atlas-git] commit produced no changes:', err)
    return { sha: 'no-changes', pushed: false }
  }
  // Get sha
  const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
  const sha = stdout.trim()
  // Push
  try {
    await execFileP('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT })
    return { sha, pushed: true }
  } catch (err) {
    console.error('[atlas-git] push failed:', err)
    return { sha, pushed: false }
  }
}
const MEMORY_URL = process.env.MEMORY_URL ?? 'https://cooperative-rejoicing-production.up.railway.app'
const MEMORY_TOKEN = process.env.MEMORY_API_TOKEN
const VERIFIER_URL = process.env.VERIFIER_URL ?? 'https://rare-happiness-production.up.railway.app'
const VERIFIER_TOKEN = process.env.VERIFIER_API_TOKEN
const COUNCIL_URL = process.env.COUNCIL_URL ?? 'https://just-reflection-production.up.railway.app'
const COUNCIL_TOKEN = process.env.COUNCIL_API_TOKEN
const ADELA_URL = process.env.ADELA_URL ?? 'https://believable-warmth-production.up.railway.app'
const ADELA_TOKEN = process.env.ADELA_API_TOKEN
const DESIGNER_URL = process.env.DESIGNER_URL ?? ''
const DESIGNER_TOKEN = process.env.DESIGNER_API_TOKEN
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

export async function builderQueueSpec(filename: string, body: string): Promise<{ path: string; sha: string; pushed: boolean }> {
  if (!filename.endsWith('.md')) throw new Error('builder.queue_spec: filename must end in .md')
  if (!filename.startsWith('phase-')) throw new Error('builder.queue_spec: filename must start with "phase-"')
  const relPath = `.agent/tasks/queued/${filename}`
  const fullPath = resolve(REPO_ROOT, relPath)
  await writeFile(fullPath, body, 'utf-8')
  // Auto-commit and push so Builder picks it up — Atlas owns the queue end-to-end
  const result = await gitCommitAndPush(`atlas: queue ${filename.replace(/\.md$/, '')}`, [relPath])
  return { path: fullPath, sha: result.sha, pushed: result.pushed }
}

export async function builderListQueue(): Promise<{ specs: string[] }> {
  // Refresh to see latest
  try {
    await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
    await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: REPO_ROOT })
  } catch (err) {
    console.warn('[atlas-list] git refresh failed:', err)
  }
  const dir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const files = await readdir(dir)
  return { specs: files.filter(f => f.endsWith('.md') && f !== '_template.md') }
}

export async function builderCancelTask(taskId: string): Promise<{ moved_to: string; sha: string; pushed: boolean }> {
  const fromRel = `.agent/tasks/queued/${taskId}.md`
  const toRel = `.agent/tasks/cancelled/${taskId}.md`
  const fromPath = resolve(REPO_ROOT, fromRel)
  const toPath = resolve(REPO_ROOT, toRel)
  await rename(fromPath, toPath)
  const result = await gitCommitAndPush(`atlas: cancel ${taskId}`, [fromRel, toRel])
  return { moved_to: toPath, sha: result.sha, pushed: result.pushed }
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

// ─── Designer ───────────────────────────────────────────────────────────────

export async function designerAuditCommit(
  taskId: string,
  headBefore: string,
  headAfter: string,
  screenshotUrl?: string,
): Promise<unknown> {
  if (!DESIGNER_URL) {
    return { verdict: 'unknown', error: 'DESIGNER_URL not configured', gaps: [] }
  }
  const res = await fetch(`${DESIGNER_URL}/designer/audit-commit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DESIGNER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, head_before: headBefore, head_after: headAfter, screenshot_url: screenshotUrl }),
  })
  if (!res.ok) {
    return { verdict: 'unknown', error: `designer audit-commit ${res.status}`, gaps: [] }
  }
  return res.json()
}

export async function designerReviewSpec(taskId: string, specMarkdown: string): Promise<unknown> {
  if (!DESIGNER_URL) {
    return { verdict: 'unknown', error: 'DESIGNER_URL not configured', gaps: [] }
  }
  const res = await fetch(`${DESIGNER_URL}/designer/review-spec`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DESIGNER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, spec_markdown: specMarkdown }),
  })
  if (!res.ok) {
    return { verdict: 'unknown', error: `designer review-spec ${res.status}`, gaps: [] }
  }
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

// ─── Atlas spec authorship ───────────────────────────────────────────────────

export interface AtlasDraftSpecResult {
  filename: string
  markdown: string
  validation: { ok: boolean; missing: string[] }
  cost_usd: number
  review_verdict: DraftResult['reviewVerdict']
  review_rationale?: string
  council: { used: boolean; error?: string }
  steps: DraftResult['steps']
}

export async function atlasDraftSpec(phase: string, goal: string): Promise<AtlasDraftSpecResult> {
  if (!phase || typeof phase !== 'string') throw new Error('atlas.draft_spec: `phase` is required (e.g. "1.7c")')
  if (!goal || typeof goal !== 'string') throw new Error('atlas.draft_spec: `goal` is required (freeform feature description)')
  const result = await draftSpec(phase, goal)
  return {
    filename: result.filename,
    markdown: result.markdown,
    validation: result.validation,
    cost_usd: result.costUsd,
    review_verdict: result.reviewVerdict,
    review_rationale: result.reviewRationale,
    council: result.council,
    steps: result.steps,
  }
}

export interface AtlasProposeAndQueueResult {
  action: 'queued' | 'awaiting_confirmation' | 'draft_only' | 'invariant_blocked' | 'validation_failed'
  filename: string
  spec_markdown: string
  validation: { ok: boolean; missing: string[] }
  trust_mode: string
  cost_usd: number
  review_verdict: DraftResult['reviewVerdict']
  council: { used: boolean; error?: string }
  steps: DraftResult['steps']
  // Populated when action === 'queued'
  queue?: { sha: string; pushed: boolean; queue_position: number; queue_size: number; path: string }
  // Populated when action === 'invariant_blocked'
  invariant_violations?: Array<{ rule_id: string; description: string; severity: string }>
  // Populated when action !== 'queued'
  next_step?: string
}

export async function atlasProposeAndQueue(
  phase: string,
  goal: string,
  threadId?: string,
): Promise<AtlasProposeAndQueueResult> {
  if (!phase || typeof phase !== 'string') throw new Error('atlas.propose_and_queue: `phase` is required (e.g. "1.7c")')
  if (!goal || typeof goal !== 'string') throw new Error('atlas.propose_and_queue: `goal` is required (freeform feature description)')

  const trustMode = getCurrentMode()
  const draft = await draftSpec(phase, goal)

  // Validation gate — surface to caller without queueing if missing sections.
  if (!draft.validation.ok) {
    return {
      action: 'validation_failed',
      filename: draft.filename,
      spec_markdown: draft.markdown,
      validation: draft.validation,
      trust_mode: trustMode,
      cost_usd: draft.costUsd,
      review_verdict: draft.reviewVerdict,
      council: draft.council,
      steps: draft.steps,
      next_step: `Spec failed structural validation after retries. Missing: ${draft.validation.missing.join(', ')}. Show the user the draft + missing sections and ask how to proceed.`,
    }
  }

  // Master-plan invariants — applied to the draft body BEFORE we let any queue happen.
  // (invariants.ts type-imports DispatchRequest from dispatch.ts, which is erased at
  // runtime; no real cycle.)
  const invariantCheck = await checkInvariants({
    tool: 'builder.queue_spec',
    arguments: { filename: draft.filename, body: draft.markdown },
    initiatedBy: threadId ? `chat:${threadId}` : 'atlas.propose_and_queue',
    trustMode,
  })
  if (!invariantCheck.allow) {
    return {
      action: 'invariant_blocked',
      filename: draft.filename,
      spec_markdown: draft.markdown,
      validation: draft.validation,
      trust_mode: trustMode,
      cost_usd: draft.costUsd,
      review_verdict: draft.reviewVerdict,
      council: draft.council,
      steps: draft.steps,
      invariant_violations: invariantCheck.violations,
      next_step: `Master plan invariants blocked the draft: ${invariantCheck.violations.map(v => `[${v.rule_id}] ${v.description}`).join('; ')}. Either revise the goal or refuse the request.`,
    }
  }

  // Persist to atlas_pending_specs (best-effort) so the user can confirm later, even
  // after the chat session rotates.
  try {
    const sb = getSupabaseClient()
    if (sb && threadId) {
      await sb.from('atlas_pending_specs').insert({
        thread_id: threadId,
        spec_markdown: draft.markdown,
        filename: draft.filename,
      })
    }
  } catch (err) {
    console.warn('[atlas-pending-specs] insert failed (non-fatal):', err)
  }

  // ─── Mode-aware queueing ────────────────────────────────────────────────────
  if (trustMode === 'auto') {
    const queueResult = await builderQueueSpec(draft.filename, draft.markdown)
    let queueList: string[] = []
    try {
      const list = await builderListQueue()
      queueList = list.specs
    } catch (err) {
      console.warn('[atlas-propose] list_queue verification failed:', err)
    }
    const position = queueList.indexOf(draft.filename) + 1 // 1-based; 0 if not found
    // Mark pending row resolved
    try {
      const sb = getSupabaseClient()
      if (sb && threadId) {
        await sb.from('atlas_pending_specs').update({
          resolved_at: new Date().toISOString(),
          resolution: 'queued',
        }).eq('thread_id', threadId).eq('filename', draft.filename).is('resolved_at', null)
      }
    } catch { /* non-fatal */ }
    return {
      action: 'queued',
      filename: draft.filename,
      spec_markdown: draft.markdown,
      validation: draft.validation,
      trust_mode: trustMode,
      cost_usd: draft.costUsd,
      review_verdict: draft.reviewVerdict,
      council: draft.council,
      steps: draft.steps,
      queue: {
        sha: queueResult.sha,
        pushed: queueResult.pushed,
        queue_position: position,
        queue_size: queueList.length,
        path: queueResult.path,
      },
      next_step: `Queued at position ${position} of ${queueList.length}. SHA ${queueResult.sha}. Builder will pick it up on next loop.`,
    }
  }

  if (trustMode === 'confirm') {
    return {
      action: 'awaiting_confirmation',
      filename: draft.filename,
      spec_markdown: draft.markdown,
      validation: draft.validation,
      trust_mode: trustMode,
      cost_usd: draft.costUsd,
      review_verdict: draft.reviewVerdict,
      council: draft.council,
      steps: draft.steps,
      next_step: `Trust mode is confirm. Show the user the FULL drafted markdown and ask: "Approve queueing ${draft.filename}? Reply YES to ship, NO to cancel, or tell me what to tweak." On YES, call builder.queue_spec with the same filename + body.`,
    }
  }

  // chat / passive / stopped (stopped already blocked by dispatch trust-mode gate)
  return {
    action: 'draft_only',
    filename: draft.filename,
    spec_markdown: draft.markdown,
    validation: draft.validation,
    trust_mode: trustMode,
    cost_usd: draft.costUsd,
    review_verdict: draft.reviewVerdict,
    council: draft.council,
    steps: draft.steps,
    next_step: `Trust mode is ${trustMode} — drafted but NOT queued. Tell the user: "Currently in ${trustMode} mode — flip to confirm or auto to actually queue." Show them the draft.`,
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
  'atlas.draft_spec':     { fn: atlasDraftSpec,     description: 'Draft a full task spec markdown for a given phase + freeform goal. Internally runs Council first-draft + multi-brain debate review + structural validation. args=(phase, goal). Read-only — does NOT queue. Use this when the user wants a preview/critique only.' },
  'atlas.propose_and_queue': { fn: atlasProposeAndQueue, description: 'Primary spec-authorship flow: draft (Council + multi-brain) → validate → check invariants → queue (auto mode) or stage for confirmation (confirm mode) or draft-only (chat/passive). args=(phase, goal). thread_id is auto-injected by the chat handler. Use this whenever the user says "build/ship/queue/spec" something.' },
  'adela.trigger_scrape': { fn: adelaTriggerScrape, description: 'Trigger Adela to run a scraper. Sources: usda-nass, abc-objective, news-rss, etc.' },
  'designer.audit_commit':{ fn: designerAuditCommit,description: 'Run Designer audit on a UI commit. args=(task_id, head_before, head_after, screenshot_url?). Returns verdict + gaps.' },
  'designer.review_spec': { fn: designerReviewSpec, description: 'Run Designer review on a task spec. args=(task_id, spec_markdown). Returns verdict + gaps.' },
  'whatsapp.send':        { fn: whatsappSend,       description: 'Send a WhatsApp message to a number. to=E.164 format like +971501234567.' },
  'status.snapshot':      { fn: statusSnapshot,     description: 'Compute and return a fresh project status snapshot.' },
} as const

export type ToolName = keyof typeof TOOLS
