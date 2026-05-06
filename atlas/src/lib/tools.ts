import Anthropic from '@anthropic-ai/sdk'
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
import {
  draftPlanAmendment as planDraftAmendment,
  applyPendingPlanAmendment as planApplyAmendment,
  draftNewPlan as planDraftNew,
  queueSpecFromPlanNode,
  findExistingSpecBucket,
  buildDuplicateSpecError,
} from './plan-server'
import {
  setPlanNodeState,
  clearPlanNodeState,
  listAllActivePlanNodeStates,
} from './plan-state'

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
  // Dedupe against the live tree. The user hit this on phase-1.00f: Atlas
  // re-drafted an already-shipped spec, Builder picked it up, found nothing
  // to do, shipped 0 files (looked like a silent queue failure). Refuse
  // explicitly so the LLM can tell the user instead of wasting a build cycle.
  const existing = await findExistingSpecBucket(filename)
  if (existing) {
    throw new Error(`builder.queue_spec: ${buildDuplicateSpecError(filename, existing)}`)
  }
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

export async function builderQueueOrder(): Promise<{ order: Array<{ id: string; priority: number; depends_on: string[]; blocked: boolean; blocked_by: string[]; paused: boolean }> }> {
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
  const rows: Array<{ id: string; priority: number; depends_on: string[]; blocked: boolean; blocked_by: string[]; paused: boolean; filename: string }> = []
  for (const f of queuedFiles) {
    const id = f.replace(/\.md$/, '')
    let priority = 5
    let dependsOn: string[] = []
    let paused = false
    try {
      const content = await readFile(resolve(queuedDir, f), 'utf-8')
      const parsed = parseSpec(content)
      if (typeof parsed.frontmatter.priority === 'number') priority = parsed.frontmatter.priority
      dependsOn = parsed.frontmatter.dependsOn ?? []
      paused = parsed.frontmatter.paused === true
    } catch { /* unreadable — treat as default */ }
    const blockedBy = dependsOn.filter(d => !doneIds.has(d))
    rows.push({ id, priority, depends_on: dependsOn, blocked: blockedBy.length > 0, blocked_by: blockedBy, paused, filename: f })
  }
  // Sort: ready < blocked-but-not-paused < paused-but-not-blocked < both. Within
  // each bucket, priority asc, filename asc. Builder picks the head (always a
  // ready, unpaused, unblocked spec).
  rows.sort((a, b) => {
    const aRank = (a.paused ? 2 : 0) + (a.blocked ? 1 : 0)
    const bRank = (b.paused ? 2 : 0) + (b.blocked ? 1 : 0)
    if (aRank !== bRank) return aRank - bRank
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.filename.localeCompare(b.filename)
  })
  return {
    order: rows.map(r => ({ id: r.id, priority: r.priority, depends_on: r.depends_on, blocked: r.blocked, blocked_by: r.blocked_by, paused: r.paused })),
  }
}

// ─── Pillar B.1: positional move (swap priorities with adjacent neighbor) ──
//
// Replaces the priority +/- buttons in the Queue tab with Xbox-style up/down
// row motion. Algorithm: find the moved spec's position in the current queue
// order (excluding paused/blocked rows), find its neighbor in the requested
// direction, and either swap their priorities or nudge to break a tie.
//
// Two writes worst-case (when swap is needed); withGitLock serializes them so
// the concurrent index.lock collision is avoided.

export async function builderMovePosition(
  taskId: string,
  direction: 'up' | 'down',
): Promise<{ ok: boolean; moved: boolean; reason?: string; sha?: string }> {
  if (direction !== 'up' && direction !== 'down') {
    throw new Error("builder.move_position: direction must be 'up' or 'down'")
  }
  const { order } = await builderQueueOrder()
  // Move only among the active head — paused/blocked rows are at the tail and
  // moving them changes nothing user-visible until they're resumed/unblocked.
  const active = order.filter(r => !r.paused && !r.blocked)
  const i = active.findIndex(r => r.id === taskId)
  if (i < 0) {
    return { ok: false, moved: false, reason: 'task not in active queue (paused / blocked / not-queued)' }
  }
  const ni = direction === 'up' ? i - 1 : i + 1
  if (ni < 0 || ni >= active.length) {
    return { ok: true, moved: false, reason: 'already at edge' }
  }
  const moved = active[i]
  const neighbor = active[ni]
  const movedRow = order.find(r => r.id === moved.id)!
  const neighborRow = order.find(r => r.id === neighbor.id)!

  // Different priorities → simple swap.
  if (movedRow.priority !== neighborRow.priority) {
    await builderSetPriority(moved.id, neighborRow.priority)
    const r = await builderSetPriority(neighbor.id, movedRow.priority)
    return { ok: true, moved: true, sha: r.sha }
  }
  // Equal priorities → nudge into the priority gap. If the gap is a wall
  // (priority 1 going up, priority 10 going down), nudge the neighbor instead.
  const target = direction === 'up'
    ? Math.max(1, neighborRow.priority - 1)
    : Math.min(10, neighborRow.priority + 1)
  if (target !== neighborRow.priority) {
    const r = await builderSetPriority(moved.id, target)
    return { ok: true, moved: true, sha: r.sha }
  }
  // Wall on moved's side — nudge neighbor in the opposite direction.
  const neighborTarget = direction === 'up'
    ? Math.min(10, neighborRow.priority + 1)
    : Math.max(1, neighborRow.priority - 1)
  if (neighborTarget === neighborRow.priority) {
    return { ok: true, moved: false, reason: 'priorities at boundary on both sides' }
  }
  const r = await builderSetPriority(neighbor.id, neighborTarget)
  return { ok: true, moved: true, sha: r.sha }
}

// ─── Pillar B.2: pause / resume per task ────────────────────────────────────
//
// Sets `paused: true` (or removes it) in the spec's frontmatter and pushes.
// Builder's pick_next_task skips paused specs (agent-loop.sh updated alongside).

export async function builderPauseTask(taskId: string): Promise<{ updated: boolean; sha: string; pushed: boolean }> {
  const relPath = `.agent/tasks/queued/${taskId}.md`
  const fullPath = resolve(REPO_ROOT, relPath)
  let content: string
  try {
    content = await readFile(fullPath, 'utf-8')
  } catch {
    throw new Error(`builder.pause_task: spec not found in queued/: ${taskId}.md`)
  }
  const next = setFrontmatterField(content, 'paused', true)
  if (next === content) return { updated: false, sha: 'no-changes', pushed: false }
  await writeFile(fullPath, next, 'utf-8')
  const result = await gitCommitAndPush(`atlas: pause ${taskId}`, [relPath])
  return { updated: true, sha: result.sha, pushed: result.pushed }
}

export async function builderResumeTask(taskId: string): Promise<{ updated: boolean; sha: string; pushed: boolean }> {
  const relPath = `.agent/tasks/queued/${taskId}.md`
  const fullPath = resolve(REPO_ROOT, relPath)
  let content: string
  try {
    content = await readFile(fullPath, 'utf-8')
  } catch {
    throw new Error(`builder.resume_task: spec not found in queued/: ${taskId}.md`)
  }
  // setFrontmatterField on a falsy paused removes the line (serializer skips it).
  const next = setFrontmatterField(content, 'paused', false)
  if (next === content) return { updated: false, sha: 'no-changes', pushed: false }
  await writeFile(fullPath, next, 'utf-8')
  const result = await gitCommitAndPush(`atlas: resume ${taskId}`, [relPath])
  return { updated: true, sha: result.sha, pushed: result.pushed }
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

// ─── Plan-aware chat tools (A.6) ────────────────────────────────────────────
// These let the chat panel discuss + amend the master plan, draft fresh plans
// from a free-form prompt, and mutate per-node state (void / queue) without
// leaving the chat surface. Diff-and-confirm: drafting NEVER auto-writes;
// the user clicks Apply on the artifact card to call plan.apply_amendment.

let _anthropicClient: Anthropic | null = null
function getAnthropicForPlan(): Anthropic {
  if (_anthropicClient) return _anthropicClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — plan.draft_amendment / plan.draft_new require Claude.')
  _anthropicClient = new Anthropic({ apiKey })
  return _anthropicClient
}

export interface PlanDraftResult {
  proposed_markdown: string
  current_markdown: string
  diff: { addedLines: number; removedLines: number; unchangedLines: number; sample: { added: string[]; removed: string[] } }
  reasoning: string
}

// NB: dispatch layer spreads `Object.values(arguments)` positionally — these
// must take positional args (matching the order in the description's args=(...))
// not a single object arg. The LLM reads the description and emits keys in
// the same order; Object.values then preserves insertion order.

export async function planDraftAmendmentTool(instruction: string): Promise<PlanDraftResult> {
  if (!instruction || typeof instruction !== 'string') {
    throw new Error('plan.draft_amendment: `instruction` is required')
  }
  const result = await planDraftAmendment(instruction, getAnthropicForPlan())
  return {
    proposed_markdown: result.proposedMarkdown,
    current_markdown: result.currentMarkdown,
    diff: result.diff,
    reasoning: result.reasoning,
  }
}

export async function planApplyAmendmentTool(proposed_markdown: string, summary?: string): Promise<{ ok: boolean; sha: string; pushed: boolean }> {
  if (!proposed_markdown || typeof proposed_markdown !== 'string' || proposed_markdown.length < 100) {
    throw new Error('plan.apply_amendment: `proposed_markdown` is required (min 100 chars). Pass the value from a prior plan.draft_amendment call exactly.')
  }
  const cleanSummary = (typeof summary === 'string' && summary.trim().length > 0) ? summary.trim() : 'chat-applied amendment'
  const result = await planApplyAmendment(proposed_markdown, cleanSummary)
  return { ok: true, sha: result.sha, pushed: result.pushed }
}

export async function planDraftNewTool(prompt: string, context_refs?: string[]): Promise<PlanDraftResult> {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('plan.draft_new: `prompt` is required (free-form goal description)')
  }
  const refs = Array.isArray(context_refs) ? context_refs.filter(s => typeof s === 'string') : []
  const result = await planDraftNew(prompt, refs, getAnthropicForPlan())
  return {
    proposed_markdown: result.proposedMarkdown,
    current_markdown: result.currentMarkdown,
    diff: result.diff,
    reasoning: result.reasoning,
  }
}

export async function planVoidTool(plan_node_id: string, reason?: string): Promise<{ ok: boolean; rowId?: string; reason?: string }> {
  if (!plan_node_id || typeof plan_node_id !== 'string') {
    throw new Error('plan.void: `plan_node_id` is required')
  }
  return setPlanNodeState({
    planNodeId: plan_node_id,
    state: 'voided',
    reason,
    setBy: 'user',
  })
}

export async function planRecoverTool(plan_node_id: string): Promise<{ ok: boolean; reason?: string }> {
  if (!plan_node_id || typeof plan_node_id !== 'string') {
    throw new Error('plan.recover: `plan_node_id` is required')
  }
  return clearPlanNodeState(plan_node_id, 'voided')
}

export async function planAddToQueueTool(
  plan_node_id: string,
  title: string,
  node_body?: string,
  phase_hint?: string,
): Promise<{ ok: boolean; filename: string; sha: string; pushed: boolean }> {
  if (!plan_node_id || typeof plan_node_id !== 'string') {
    throw new Error('plan.add_to_queue: `plan_node_id` is required')
  }
  if (!title || typeof title !== 'string') {
    throw new Error('plan.add_to_queue: `title` is required (the plan node\'s heading text)')
  }
  const queued = await queueSpecFromPlanNode(
    title,
    node_body ?? '',
    phase_hint ?? 'plan',
  )
  await setPlanNodeState({
    planNodeId: plan_node_id,
    state: 'queued-no-build',
    setBy: 'user',
    metadata: { spec_filename: queued.filename },
  }).catch(err => console.warn('[plan.add_to_queue] state row insert failed (non-fatal):', err))
  return { ok: true, filename: queued.filename, sha: queued.sha, pushed: queued.pushed }
}

export async function planListStatesTool(): Promise<{ states: Array<{ plan_node_id: string; state: string; reason: string | null; set_by: string | null; set_at: string }> }> {
  const rows = await listAllActivePlanNodeStates()
  return {
    states: rows.map(row => ({
      plan_node_id: row.plan_node_id,
      state: row.state,
      reason: row.reason,
      set_by: row.set_by,
      set_at: row.set_at,
    })),
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
  'builder.queue_order':  { fn: builderQueueOrder,  description: 'Compute the current queue pickup order Builder will use (priority + dependency + paused aware). Read-only. Returns array of {id, priority, depends_on, blocked, blocked_by, paused}.' },
  'builder.move_position':{ fn: builderMovePosition,description: 'Move a queued spec one position up or down — Xbox-style. Internally swaps priorities with the adjacent neighbor (or nudges to break a tie). args=(taskId, direction). direction: "up" | "down".' },
  'builder.pause_task':   { fn: builderPauseTask,   description: 'Pause a queued spec — Builder will skip it on pickup. Distinct from cancel: paused stays in queued/ and is reversible via builder.resume_task. args=(taskId).' },
  'builder.resume_task':  { fn: builderResumeTask,  description: 'Resume a previously-paused queued spec — Builder picks it up again on next loop. args=(taskId).' },
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
  // ─── Plan-aware tools (A.6) ────────────────────────────────────────────
  // Diff-and-confirm: draft tools NEVER auto-write. After draft_amendment or
  // draft_new returns, ALWAYS show the user the artifact card with the diff
  // and wait for explicit approval ("apply" / "yes" / "go ahead") before
  // calling apply_amendment with the same proposed_markdown.
  'plan.draft_amendment': { fn: planDraftAmendmentTool, description: 'Draft an amendment to the master plan from a natural-language instruction. Returns proposed_markdown + current_markdown + diff summary + reasoning. DOES NOT WRITE — chat shows the user an Apply/Reject card. Use whenever the user says "change the plan", "add a phase", "rename X in the plan", "void/move/restructure", etc. args=(instruction).' },
  'plan.apply_amendment': { fn: planApplyAmendmentTool, description: 'Apply a previously-drafted plan amendment. Pass proposed_markdown verbatim from a prior plan.draft_amendment or plan.draft_new result. Writes + commits + pushes to git. ONLY call after the user has explicitly approved (e.g. they said "apply", "yes", "ship it"). args=(proposed_markdown, summary).' },
  'plan.draft_new':       { fn: planDraftNewTool,       description: 'Draft a brand-new master plan from a free-form prompt. Use when the user wants a clean rebuild plan (e.g. "draft a plan to rebuild from V1"). Optional context_refs is an array of file paths inlined as reference docs (e.g. ["docs/v3-step2-v1-audit.md"]). DOES NOT WRITE — same diff-and-confirm flow as plan.draft_amendment. args=(prompt, context_refs?).' },
  'plan.void':            { fn: planVoidTool,           description: 'Mark a plan node as voided. Hidden by default in the Plan tab tree, visible under the Voided filter. Recoverable via plan.recover. args=(plan_node_id, reason?).' },
  'plan.recover':         { fn: planRecoverTool,        description: 'Recover a previously-voided plan node — clears the voided state row. args=(plan_node_id).' },
  'plan.add_to_queue':    { fn: planAddToQueueTool,     description: 'Queue a plan node as a spec WITHOUT immediately building. Same effect as the ➕ button on the Plan tab. Caller must pass plan_node_id + title (the node\'s heading text); node_body and phase_hint are optional. args=(plan_node_id, title, node_body?, phase_hint?).' },
  'plan.list_states':     { fn: planListStatesTool,     description: 'List all currently-active plan-node states (voided / queued-no-build / suggested-by-multi-brain / suggested-by-verifier / optional). Read-only. Use to answer "which phases are voided", "what did Multi-Brain suggest", etc.' },
} as const

export type ToolName = keyof typeof TOOLS
