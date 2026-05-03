import { getSupabaseClient } from './supabase'
import { markBuildAttemptStatus } from './build-attempts'
import { writeFile, readFile, readdir, rename } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { draftSpec, type DraftResult } from './spec-draft'
import { getCurrentMode } from './trust-mode'
import { checkInvariants } from './invariants'
import { parseSpec, setFrontmatterField } from './frontmatter'
import { withGitLock } from './git-mutex'

const execFileP = promisify(execFile)

const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

// ─── Git helper for autonomous Atlas commits ────────────────────────────────
async function gitCommitAndPush(commitMsg: string, filesToAdd: string[]): Promise<{ sha: string; pushed: boolean }> {
  return withGitLock(`commit-and-push:${commitMsg.slice(0, 40)}`, async () => {
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
  })
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

export async function builderQueueSpec(
  filename: string,
  body: string,
  buildAttemptId?: string,
): Promise<{ path: string; sha: string; pushed: boolean }> {
  if (!filename.endsWith('.md')) throw new Error('builder.queue_spec: filename must end in .md')
  if (!filename.startsWith('phase-')) throw new Error('builder.queue_spec: filename must start with "phase-"')
  const relPath = `.agent/tasks/queued/${filename}`
  const fullPath = resolve(REPO_ROOT, relPath)
  await writeFile(fullPath, body, 'utf-8')
  // Auto-commit and push so Builder picks it up — Atlas owns the queue end-to-end
  const result = await gitCommitAndPush(`atlas: queue ${filename.replace(/\.md$/, '')}`, [relPath])

  // Phase 2 of agent-loop redesign: flip the corresponding atlas_build_attempts
  // row from 'planned' to 'queued' so the bookend is recorded. Best-effort —
  // failure here doesn't affect the queue; spec-draft logged the planned row,
  // and the post-ship hooks transition shipped/verified independently.
  if (buildAttemptId) {
    await markBuildAttemptStatus(buildAttemptId, 'queued')
  }

  return { path: fullPath, sha: result.sha, pushed: result.pushed }
}

export async function builderListQueue(): Promise<{ specs: string[] }> {
  // Refresh to see latest — serialized via git-mutex to avoid index.lock collisions.
  await withGitLock('list-queue:fetch+reset', async () => {
    try {
      await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
      await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: REPO_ROOT })
    } catch (err) {
      console.warn('[atlas-list] git refresh failed:', err)
    }
  })
  const dir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const files = await readdir(dir)
  return { specs: files.filter(f => f.endsWith('.md') && f !== '_template.md') }
}

export async function builderListDone(opts?: {
  limit?: number
  filter?: string
}): Promise<{ specs: string[]; count: number }> {
  // Refresh repo state first (mirror builderListQueue), serialized via git-mutex.
  await withGitLock('list-done:fetch+reset', async () => {
    try {
      await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
      await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: REPO_ROOT })
    } catch (err) {
      console.warn('[atlas-list-done] git refresh failed:', err)
    }
  })
  const dir = resolve(REPO_ROOT, '.agent/tasks/done')
  const files = (await readdir(dir)).filter(f => f.endsWith('.md') && f !== '_template.md')
  let filtered = files
  if (opts?.filter) {
    filtered = files.filter(f => f.includes(opts.filter!))
  }
  filtered.sort()
  const limit = opts?.limit ?? 100
  return { specs: filtered.slice(0, limit), count: filtered.length }
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

// Atlas-driven queue management. These mutate frontmatter on a queued spec
// (priority + depends-on) and commit+push so Builder picks them up next loop.
export async function builderSetPriority(taskId: string, priority: number): Promise<{ updated: boolean; sha: string; pushed: boolean }> {
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 1 || priority > 10) {
    throw new Error('builder.set_priority: priority must be an integer in [1..10]')
  }
  const relPath = `.agent/tasks/queued/${taskId}.md`
  const fullPath = resolve(REPO_ROOT, relPath)
  let content: string
  try {
    content = await readFile(fullPath, 'utf-8')
  } catch {
    throw new Error(`builder.set_priority: spec not found in queued/: ${taskId}.md (must not be in-progress/done/cancelled)`)
  }
  const next = setFrontmatterField(content, 'priority', priority)
  if (next === content) {
    return { updated: false, sha: 'no-changes', pushed: false }
  }
  await writeFile(fullPath, next, 'utf-8')
  const result = await gitCommitAndPush(`atlas: set priority=${priority} on ${taskId}`, [relPath])
  return { updated: true, sha: result.sha, pushed: result.pushed }
}

export async function builderSetDependencies(taskId: string, dependsOn: string[]): Promise<{ updated: boolean; sha: string; pushed: boolean }> {
  if (!Array.isArray(dependsOn)) {
    throw new Error('builder.set_dependencies: dependsOn must be an array of task ids')
  }
  // Validate each dep exists somewhere — queued / in-progress / done / failed / cancelled
  const buckets = ['queued', 'in-progress', 'done', 'failed', 'cancelled']
  const known = new Set<string>()
  for (const b of buckets) {
    try {
      const files = await readdir(resolve(REPO_ROOT, `.agent/tasks/${b}`))
      for (const f of files) {
        if (f.endsWith('.md')) known.add(f.replace(/\.md$/, ''))
      }
    } catch { /* dir may not exist */ }
  }
  const missing = dependsOn.filter(id => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`builder.set_dependencies: unknown task ids: ${missing.join(', ')}`)
  }
  // Cycle detection: A depends on B, but B already lists A in its depends-on chain.
  if (await wouldCreateCycle(taskId, dependsOn)) {
    throw new Error(`builder.set_dependencies: would create a dependency cycle for ${taskId}`)
  }
  const relPath = `.agent/tasks/queued/${taskId}.md`
  const fullPath = resolve(REPO_ROOT, relPath)
  let content: string
  try {
    content = await readFile(fullPath, 'utf-8')
  } catch {
    throw new Error(`builder.set_dependencies: spec not found in queued/: ${taskId}.md`)
  }
  const next = setFrontmatterField(content, 'dependsOn', dependsOn)
  if (next === content) {
    return { updated: false, sha: 'no-changes', pushed: false }
  }
  await writeFile(fullPath, next, 'utf-8')
  const result = await gitCommitAndPush(`atlas: set depends-on=[${dependsOn.join(',')}] on ${taskId}`, [relPath])
  return { updated: true, sha: result.sha, pushed: result.pushed }
}

async function wouldCreateCycle(taskId: string, newDeps: string[]): Promise<boolean> {
  // Walk dependency graph from each new dep; if we ever land back on taskId, cycle.
  const queuedDir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const visited = new Set<string>()
  const stack = [...newDeps]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === taskId) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    try {
      const content = await readFile(resolve(queuedDir, `${cur}.md`), 'utf-8')
      const parsed = parseSpec(content)
      for (const d of parsed.frontmatter.dependsOn ?? []) {
        stack.push(d)
      }
    } catch { /* not in queued — terminal node */ }
  }
  return false
}

export async function builderQueueOrder(): Promise<{ order: Array<{ id: string; priority: number; depends_on: string[]; blocked: boolean; blocked_by: string[] }> }> {
  // Refresh local view of queued/ + done/ first so order reflects HEAD.
  await withGitLock('queue-order:fetch+reset', async () => {
    try {
      await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
      await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: REPO_ROOT })
    } catch (err) {
      console.warn('[atlas-queue-order] git refresh failed:', err)
    }
  })
  const queuedDir = resolve(REPO_ROOT, '.agent/tasks/queued')
  const doneDir = resolve(REPO_ROOT, '.agent/tasks/done')
  const queuedFiles = (await readdir(queuedDir).catch(() => [] as string[]))
    .filter(f => f.endsWith('.md') && f !== '_template.md')
  const doneIds = new Set(
    (await readdir(doneDir).catch(() => [] as string[]))
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, '')),
  )
  const rows: Array<{ id: string; priority: number; depends_on: string[]; blocked: boolean; blocked_by: string[]; filename: string }> = []
  for (const f of queuedFiles) {
    const id = f.replace(/\.md$/, '')
    let priority = 5
    let dependsOn: string[] = []
    try {
      const content = await readFile(resolve(queuedDir, f), 'utf-8')
      const parsed = parseSpec(content)
      if (typeof parsed.frontmatter.priority === 'number') priority = parsed.frontmatter.priority
      dependsOn = parsed.frontmatter.dependsOn ?? []
    } catch { /* unreadable — treat as default */ }
    const blockedBy = dependsOn.filter(d => !doneIds.has(d))
    rows.push({ id, priority, depends_on: dependsOn, blocked: blockedBy.length > 0, blocked_by: blockedBy, filename: f })
  }
  // Same sort as Builder: priority asc, filename asc. Blocked specs sort to the end so the head is "what Builder will pick next".
  rows.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.filename.localeCompare(b.filename)
  })
  return {
    order: rows.map(r => ({ id: r.id, priority: r.priority, depends_on: r.depends_on, blocked: r.blocked, blocked_by: r.blocked_by })),
  }
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

export async function verifierRecentRuns(
  limit = 10,
  opts?: { includeAll?: boolean },
): Promise<unknown> {
  const sb = getSupabaseClient()
  if (!sb) throw new Error('Supabase client not configured')

  // Step 4 of agent-loop stabilization: apply the same latest-per-task dedup
  // that /atlas/verifier/runs already uses (shipped 365a1b5). Without this,
  // Atlas's status reports keep surfacing ancient fails for tasks that have
  // since passed — operator reads "5 of 10 null verdicts" alarms when in
  // reality those rows are weeks old.
  //
  // Pulls a wider window then collapses. opts.includeAll bypasses the
  // collapse for forensic queries.
  const widerLimit = opts?.includeAll ? limit : Math.max(limit * 5, 200)
  const { data, error } = await sb
    .from('verifier_runs')
    .select('id, task_id, commit_sha, mode, passed, unknown_reason, gaps, duration_ms, ran_at')
    .order('ran_at', { ascending: false })
    .limit(widerLimit)
  if (error) throw new Error(`verifier_runs query failed: ${error.message ?? JSON.stringify(error)}`)

  const rows = data ?? []
  if (opts?.includeAll) return { runs: rows }

  // Latest-per-task dedup. Drop tasks whose latest verdict is pass.
  // Keep passed=null rows so operator sees genuinely-indeterminate state
  // (db_write_failed / sync_failed / etc). limit applies after dedup.
  const seen = new Set<string>()
  const filtered: typeof rows = []
  for (const r of rows) {
    const tid = r.task_id ?? ''
    if (!tid || seen.has(tid)) continue
    seen.add(tid)
    if (r.passed === true) continue
    filtered.push(r)
    if (filtered.length >= limit) break
  }
  return { runs: filtered }
}

// ─── Council ────────────────────────────────────────────────────────────────

export async function councilWriteSpec(phase: string, context?: string): Promise<unknown> {
  const question = `Draft a task spec for phase ${phase}. Output the spec body as adrMarkdown. ${context ? `\n\nAdditional context:\n${context}` : ''}`
  const res = await fetch(`${COUNCIL_URL}/council`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COUNCIL_TOKEN}`,
      'Content-Type': 'application/json',
      'x-invoked-by': 'atlas',
    },
    body: JSON.stringify({ question, context: context ? { extra: context } : undefined, depth: 'quick' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Council /council ${res.status}: ${body.slice(0, 200)}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('json')) {
    const body = await res.text()
    throw new Error(`Council returned non-JSON (${ct}): ${body.slice(0, 200)}`)
  }
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
  // atlas_cost_today is a per-provider rollup; sum across rows for today's total.
  let costTodayUsd = 0
  try {
    const res = await sb.from('atlas_cost_today').select('cost_usd')
    for (const row of (res.data ?? []) as Array<{ cost_usd: number | string }>) {
      costTodayUsd += Number(row.cost_usd) || 0
    }
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
    costTodayUsd,
  }
}

// ─── Atlas spec authorship ───────────────────────────────────────────────────

export interface AtlasDraftSpecResult {
  filename: string
  markdown: string
  validation: { ok: boolean; missing: string[]; errors?: string[] }
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
  validation: { ok: boolean; missing: string[]; errors?: string[] }
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
      next_step: `Spec failed structural validation after retries. ${(draft.validation.errors ?? draft.validation.missing.map(m => `Missing: ${m}`)).join(' ')} Show the user the draft + missing sections and ask how to proceed.`,
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
    const queueResult = await builderQueueSpec(draft.filename, draft.markdown, draft.buildAttemptId)
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
  'builder.list_done':    { fn: builderListDone,    description: 'List task specs that have already shipped (in .agent/tasks/done/). Supports optional substring filter (e.g. filter="phase-1.3" returns only Phase 1.3 specs) and limit (default 100). Use this when the user asks "what shipped", "what\'s done", or asks about a specific phase\'s status — status.snapshot only gives counts, this gives names.' },
  'builder.cancel_task':  { fn: builderCancelTask,  description: 'Cancel a queued task by moving it to cancelled/.' },
  'builder.set_priority': { fn: builderSetPriority, description: 'Set a queued spec\'s priority (1=urgent .. 10=lowest). Mutates frontmatter and commits+pushes so Builder picks the new order on next loop. args=(taskId, priority).' },
  'builder.set_dependencies': { fn: builderSetDependencies, description: 'Set a queued spec\'s depends-on list. Each dep must exist somewhere in .agent/tasks/. Cycles are rejected. Commits+pushes. args=(taskId, dependsOn[]).' },
  'builder.queue_order':  { fn: builderQueueOrder,  description: 'Compute the current queue pickup order Builder will use (priority + dependency aware). Read-only. Returns array of {id, priority, depends_on, blocked, blocked_by}.' },
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
