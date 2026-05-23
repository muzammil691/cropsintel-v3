// Plan + workflow server helpers — reads from the local repo clone, edits via
// withGitLock so the conductor cron / snapshot cron / chat tools never collide
// on .git/index.lock.
//
// All file paths are computed relative to REPO_ROOT (defaults to
// /workspace/cropsintel-v3 on the Railway VPS).

import { readFile, writeFile, readdir } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { withGitLock } from './git-mutex'
import { parsePlan, serializePlan, moveNode, type PlanTree } from './plan-parser'
import { getSupabaseClient } from './supabase'
import { parseSpec, serializeFrontmatter } from './frontmatter'

const execFileP = promisify(execFile)

export const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
export const PLAN_PATH_REL = '.agent/master-plan.md'
export const WORKFLOW_PATH_REL = 'docs/MAXONS_Workflow_v1.md'

async function gitHeadSha(): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
    return stdout.trim()
  } catch {
    return 'unknown'
  }
}

async function gitCommitAndPush(message: string, files: string[]): Promise<{ sha: string; pushed: boolean }> {
  return withGitLock(`plan:${message.slice(0, 40)}`, async () => {
    try {
      await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO_ROOT })
    } catch (err) {
      console.warn('[plan-server] pull failed (continuing):', err)
    }
    for (const f of files) {
      await execFileP('git', ['add', f], { cwd: REPO_ROOT })
    }
    try {
      await execFileP(
        'git',
        ['-c', 'user.name=Atlas', '-c', 'user.email=atlas@cropsintel.local', 'commit', '-m', message],
        { cwd: REPO_ROOT },
      )
    } catch (err) {
      console.warn('[plan-server] commit produced no changes:', err)
      const sha = await gitHeadSha()
      return { sha, pushed: false }
    }
    const sha = await gitHeadSha()
    try {
      await execFileP('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT })
      return { sha, pushed: true }
    } catch (err) {
      console.error('[plan-server] push failed:', err)
      return { sha, pushed: false }
    }
  })
}

export async function readPlanMarkdown(): Promise<string> {
  const path = resolve(REPO_ROOT, PLAN_PATH_REL)
  return readFile(path, 'utf-8')
}

export async function getPlanResponse(): Promise<{
  updatedAt: string
  sha: string
  tree: PlanTree['root']
  flat: PlanTree['flat']
  /** Phase A.5: per-node active state overlay from atlas_plan_node_state. */
  nodeStates: Record<string, string[]>
}> {
  const md = await readPlanMarkdown()
  const tree = parsePlan(md)
  const sha = await gitHeadSha()

  // Phase A.5: bulk-fetch active state rows for every node id in the parsed
  // tree, so the Plan tab can paint void/queued/suggested badges in a single
  // round-trip. Failures here are non-fatal — empty map → no overlays, tree
  // still renders.
  const ids = tree.flat.map(n => n.id)
  let nodeStates: Record<string, string[]> = {}
  try {
    const { getPlanNodeStatesBulk } = await import('./plan-state.js')
    const map = await getPlanNodeStatesBulk(ids)
    for (const [id, rows] of map.entries()) {
      nodeStates[id] = rows.map(r => r.state)
    }
  } catch (err) {
    console.warn('[plan-server] node-state bulk fetch failed (non-fatal):', err instanceof Error ? err.message : err)
    nodeStates = {}
  }

  return {
    updatedAt: new Date().toISOString(),
    sha,
    tree: tree.root,
    flat: tree.flat,
    nodeStates,
  }
}

export async function writePlanMarkdown(
  newMarkdown: string,
  message: string,
  source: 'upload' | 'amend' | 'reorder',
  actorPhone?: string,
  diffSummary?: string,
): Promise<{ sha: string; pushed: boolean }> {
  const before = await readPlanMarkdown().catch(() => '')
  const path = resolve(REPO_ROOT, PLAN_PATH_REL)
  await writeFile(path, newMarkdown, 'utf-8')
  const result = await gitCommitAndPush(message, [PLAN_PATH_REL])

  const sb = getSupabaseClient()
  if (sb) {
    try {
      await sb.from('atlas_plan_revisions').insert({
        source,
        message,
        diff_summary: diffSummary ?? null,
        commit_sha: result.sha,
        before_size_bytes: before.length,
        after_size_bytes: newMarkdown.length,
        actor_phone: actorPhone ?? null,
      })
    } catch (err) {
      console.warn('[plan-server] revision row insert failed:', err)
    }
  }

  return result
}

// ─── Plan-node → spec generator ────────────────────────────────────────────
// "Build now" turns a plan node into a Builder spec under .agent/tasks/queued
// and pushes it. Uses the same filename pattern as existing specs so the
// agent loop picks it up.

function slugFromTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export type SpecBucket = 'queued' | 'in-progress' | 'done'

/**
 * Pillar B follow-up — dedupe-against-tree.
 * Refuse to queue a spec whose filename already exists in queued/, in-progress/,
 * or done/. Without this guard, Atlas re-drafting the same phase ID gets
 * silently accepted, Builder runs it, finds the work already in the tree, and
 * ships a 0-file commit (looks like the queue silently failed — exactly the
 * symptom the user hit on phase-1.00f-verifier-crash-pipeline-hardening).
 *
 * cancelled/ and failed/ are intentionally NOT checked — re-queueing those
 * is legit retry.
 */
export async function findExistingSpecBucket(filename: string): Promise<SpecBucket | null> {
  const buckets: SpecBucket[] = ['queued', 'in-progress', 'done']
  for (const bucket of buckets) {
    try {
      await readFile(resolve(REPO_ROOT, `.agent/tasks/${bucket}`, filename), 'utf-8')
      return bucket
    } catch { /* not in this bucket */ }
  }
  return null
}

// Phase 1.10ag: strict variant — also checks cancelled/ and failed/. Used by
// the auto-requeue path so a remediation that was force-cancelled doesn't
// reappear as a ghost on the next conductor tick (the bug behind the 11
// ghost-duplicates we cleaned up on 2026-05-08).
export type SpecBucketStrict = SpecBucket | 'cancelled' | 'failed'
export async function findExistingSpecBucketStrict(filename: string): Promise<SpecBucketStrict | null> {
  const buckets: SpecBucketStrict[] = ['queued', 'in-progress', 'done', 'cancelled', 'failed']
  for (const bucket of buckets) {
    try {
      await readFile(resolve(REPO_ROOT, `.agent/tasks/${bucket}`, filename), 'utf-8')
      return bucket
    } catch { /* not in this bucket */ }
  }
  return null
}

/** Build the standard refuse-to-queue error message — exported so callers
 *  (chat tools, HTTP routes) can compose consistent messaging. */
export function buildDuplicateSpecError(filename: string, bucket: SpecBucket): string {
  const guidance = bucket === 'done'
    ? 'This phase has already shipped — re-queueing would have Builder run with nothing to do and produce an empty commit. Pick a different phase id, or if you want to revert + redo, file an undeploy spec.'
    : bucket === 'in-progress'
    ? 'Builder is already running this spec — wait for it to land before queueing a re-draft.'
    : 'A queued spec with this filename already exists. Cancel it first if you want to replace, or pick a different filename.'
  return `${filename} already exists in .agent/tasks/${bucket}/. ${guidance}`
}

// ─── Band 3: requeue-with-gaps helper for Verifier-failed specs ──────────
//
// When Verifier returns passed=false, the conductor calls this to inject the
// gaps into a remediation spec, queue it, and let Builder + Verifier loop
// converge. Without this, failed specs sit in .agent/tasks/failed/ requiring
// manual intervention — exactly what Atlas flagged in its self-report
// ("Auto-requeue missing — specs die in limbo").
//
// Filename pattern: ${taskId}-rem.md for the first remediation, ${taskId}-rem2.md
// for the second, etc. Frontmatter carries `remediation: true` + the attempt
// number so the conductor's 3-attempt cap can read it.

export interface VerifierGap {
  check?: string
  severity?: string
  expected?: string
  actual?: string
  remediation?: string
  description?: string
}

// Cluster 7da23cc3f830 fix — body source selection for chained remediations.
// Returns the most recent existing spec body so each retry inherits the
// Builder's enumeration work from the prior attempt (esp. the back-ticked
// file paths Verifier reads as spec.filesRequired). Without this, every
// retry reseeds from the title-only original spec, which is the proximate
// cause of the 7da23cc3f830 Verifier-cluster loop.
//
// Lookup chain for attempt N: prior rem(N-1), then rem(N-2), ..., then rem1,
// then the original. Each candidate is checked in failed/ then done/.
export async function findInheritedBody(args: {
  taskId: string
  attempt: number
  repoRoot?: string
}): Promise<{ content: string; source: string } | null> {
  const root = args.repoRoot ?? REPO_ROOT
  const remFilename = (k: number) =>
    k === 1 ? `${args.taskId}-rem.md` : `${args.taskId}-rem${k}.md`

  const candidates: string[] = []
  for (let k = args.attempt - 1; k >= 1; k--) candidates.push(remFilename(k))
  candidates.push(`${args.taskId}.md`)

  for (const filename of candidates) {
    for (const bucket of ['failed', 'done'] as const) {
      const p = resolve(root, `.agent/tasks/${bucket}`, filename)
      try {
        const content = await readFile(p, 'utf-8')
        return { content, source: `${bucket}/${filename}` }
      } catch { /* not in this bucket */ }
    }
  }
  return null
}

export async function requeueWithGaps(args: {
  taskId: string
  gaps: VerifierGap[]
  attempt?: number  // defaults to 1; conductor passes incremented value for chained remediations
}): Promise<{
  ok: boolean
  filename?: string
  sha?: string
  pushed?: boolean
  reason?: string
}> {
  const attempt = args.attempt ?? 1
  if (attempt > 3) {
    return { ok: false, reason: '3-attempt cap exceeded — escalate via WhatsApp instead of looping' }
  }
  // Prefer the most recent existing remediation body over the title-only
  // original — preserves Builder's prior enumeration (esp. file paths that
  // Verifier reads as spec.filesRequired).
  const inherited = await findInheritedBody({ taskId: args.taskId, attempt })
  if (!inherited) {
    return { ok: false, reason: `original spec not found in failed/ or done/ for ${args.taskId}` }
  }
  const originalContent = inherited.content

  // Compute remediation filename. Skip if already queued/in-progress (idempotent).
  const remSuffix = attempt === 1 ? '-rem' : `-rem${attempt}`
  const remFilename = `${args.taskId}${remSuffix}.md`
  // Phase 1.10ag — strict bucket check covers cancelled/ and failed/ too. If
  // the remediation already lives in a terminal bucket, refuse and audit-log:
  // re-queueing it would produce a ghost duplicate when the conductor's
  // in-memory dedup Set decays on Railway redeploy.
  const existingStrict = await findExistingSpecBucketStrict(remFilename)
  if (existingStrict === 'queued' || existingStrict === 'in-progress') {
    return { ok: true, filename: remFilename, reason: `already ${existingStrict} (idempotent no-op)` }
  }
  if (existingStrict === 'cancelled' || existingStrict === 'failed') {
    await logGhostBlocked(remFilename, existingStrict)
    if (existingStrict === 'failed') {
      // Failed remediations can be retried by bumping attempt — that's the
      // existing 3-attempt cap behavior. Cancelled is terminal (operator intent).
      return requeueWithGaps({ ...args, attempt: attempt + 1 })
    }
    return { ok: false, filename: remFilename, reason: `already ${existingStrict} — refusing ghost re-queue` }
  }
  if (existingStrict === 'done') {
    // Try the next attempt number.
    return requeueWithGaps({ ...args, attempt: attempt + 1 })
  }

  // Parse the original spec, mutate frontmatter, append gaps section.
  const parsed = parseSpec(originalContent)
  const newFrontmatter = {
    ...parsed.frontmatter,
    priority: 1, // remediation is always urgent
    remediation: true,
    remediationAttempt: attempt,
    dependsOn: undefined, // clear inherited deps — this is a fresh attempt
  }
  const fmText = serializeFrontmatter(newFrontmatter)
  const gapsSection = buildGapsSection(args.gaps, args.taskId, attempt)
  const body = (parsed.body ?? '').replace(/\s+$/, '')
  const newContent = `---\n${fmText}\n---\n${body}\n\n${gapsSection}\n`

  const relPath = `.agent/tasks/queued/${remFilename}`
  const fullPath = resolve(REPO_ROOT, relPath)
  await writeFile(fullPath, newContent, 'utf-8')
  const result = await gitCommitAndPush(
    `atlas: requeue with gaps — ${args.taskId} (attempt ${attempt})`,
    [relPath],
  )
  return { ok: true, filename: remFilename, sha: result.sha, pushed: result.pushed }
}

// Phase 1.10ag: log a ghost-requeue block to agent_audit_log so we can prove
// the guard fired (and over time, count how often the bug would have hit
// without the fix). Failures here are non-fatal — the audit row is observability,
// not a hard dependency of the requeue path.
async function logGhostBlocked(filename: string, existingState: string): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  try {
    await sb.from('agent_audit_log').insert({
      agent_name: 'atlas',
      action_type: 'ghost_requeue_blocked',
      payload: {
        filename,
        existing_state: existingState,
        blocked_at: new Date().toISOString(),
      },
      status: 'success',
    })
  } catch (err) {
    console.warn('[plan-server] ghost_requeue_blocked audit insert failed:', err instanceof Error ? err.message : err)
  }
}

// Phase 1.10ag — safeRequeue: refuses to re-create a spec already present in
// any terminal state (cancelled/, failed/, done/) OR currently active
// (in-progress/, queued/). Used by call sites that want to surface a queued
// spec idempotently without producing ghost duplicates.
//
// Unlike requeueWithGaps, this works for arbitrary spec ids — it does NOT
// inject Verifier gaps. The caller supplies the spec body. If the caller has
// no body (and the spec doesn't already exist anywhere), safeRequeue returns
// ok:false with reason 'no_source' so the caller can decide what to do.
export async function safeRequeue(args: {
  specId: string
  body?: string
}): Promise<{ ok: boolean; created?: boolean; reason?: string; sha?: string; pushed?: boolean }> {
  const filename = `${args.specId}.md`
  const bucket = await findExistingSpecBucketStrict(filename)
  if (bucket === 'queued' || bucket === 'in-progress') {
    return { ok: true, created: false, reason: `already in ${bucket}` }
  }
  if (bucket === 'cancelled' || bucket === 'failed' || bucket === 'done') {
    await logGhostBlocked(filename, bucket)
    return { ok: false, created: false, reason: `already in ${bucket}` }
  }
  if (!args.body) {
    return { ok: false, created: false, reason: 'no_source — caller must supply spec body for a fresh queue' }
  }
  const relPath = `.agent/tasks/queued/${filename}`
  const fullPath = resolve(REPO_ROOT, relPath)
  await writeFile(fullPath, args.body, 'utf-8')
  const result = await gitCommitAndPush(`atlas: safe-requeue ${args.specId}`, [relPath])
  return { ok: true, created: true, sha: result.sha, pushed: result.pushed }
}

// Phase 1.10ag — safeRequeueWithReset: explicit operator-only path that wipes
// the spec from every bucket (archiving prior copies under
// .agent/tasks/cancelled/.archive/<ts>/) and creates a fresh queued copy.
// Use only when the operator genuinely wants to retry a force-cancelled spec.
export async function safeRequeueWithReset(args: {
  specId: string
  body: string
}): Promise<{ ok: boolean; archived: string[]; sha?: string; pushed?: boolean }> {
  const filename = `${args.specId}.md`
  const ts = Date.now()
  const archiveDirRel = `.agent/tasks/cancelled/.archive/${ts}`
  const archiveDir = resolve(REPO_ROOT, archiveDirRel)
  const archived: string[] = []
  const buckets: SpecBucketStrict[] = ['queued', 'in-progress', 'cancelled', 'failed', 'done']

  const { mkdir, rename: fsRename } = await import('fs/promises')
  await mkdir(archiveDir, { recursive: true }).catch(() => { /* exists */ })

  for (const b of buckets) {
    const fromRel = `.agent/tasks/${b}/${filename}`
    const fromPath = resolve(REPO_ROOT, fromRel)
    try {
      await readFile(fromPath, 'utf-8')
    } catch {
      continue
    }
    const toRel = `${archiveDirRel}/${b}-${filename}`
    const toPath = resolve(REPO_ROOT, toRel)
    try {
      await fsRename(fromPath, toPath)
      archived.push(`${b}/${filename}`)
    } catch (err) {
      console.warn(`[plan-server] safeRequeueWithReset failed to archive ${fromRel}:`, err instanceof Error ? err.message : err)
    }
  }

  const queuedRel = `.agent/tasks/queued/${filename}`
  const queuedPath = resolve(REPO_ROOT, queuedRel)
  await writeFile(queuedPath, args.body, 'utf-8')

  const result = await gitCommitAndPush(
    `atlas: safe-requeue-with-reset ${args.specId} (archived ${archived.length} prior copies)`,
    [queuedRel, archiveDirRel],
  )
  return { ok: true, archived, sha: result.sha, pushed: result.pushed }
}

function buildGapsSection(gaps: VerifierGap[], taskId: string, attempt: number): string {
  const header = `## Prior failure — gaps to address (attempt ${attempt})\n\nThe previous run of \`${taskId}\` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.\n`
  if (!Array.isArray(gaps) || gaps.length === 0) {
    return `${header}\n_No structured gap detail returned by Verifier — investigate the verifier_runs row for ${taskId} directly._\n`
  }
  const items = gaps.slice(0, 20).map((g, i) => {
    const lines: string[] = [`### Gap ${i + 1}: ${g.check ?? g.description ?? 'unspecified check'}`]
    if (g.severity) lines.push(`- Severity: \`${g.severity}\``)
    if (g.expected) lines.push(`- Expected: ${g.expected}`)
    if (g.actual) lines.push(`- Actual: ${g.actual}`)
    if (g.remediation) lines.push(`- Remediation: ${g.remediation}`)
    return lines.join('\n')
  })
  return `${header}\n${items.join('\n\n')}\n`
}

export async function queueSpecFromPlanNode(
  nodeTitle: string,
  nodeBody: string,
  phaseHint: string,
): Promise<{ filename: string; sha: string; pushed: boolean }> {
  const slug = slugFromTitle(nodeTitle) || 'plan-node'
  const phaseSlug = slugFromTitle(phaseHint) || 'plan'
  const filename = `phase-${phaseSlug}-${slug}.md`
  // Refuse before write if the filename already exists somewhere in the tree.
  const existing = await findExistingSpecBucket(filename)
  if (existing) {
    throw new Error(`queue_spec_from_plan_node: ${buildDuplicateSpecError(filename, existing)}`)
  }
  const relPath = `.agent/tasks/queued/${filename}`
  const fullPath = resolve(REPO_ROOT, relPath)
  const body = `---\npriority: 3\nsource: atlas-plan-tree\n---\n\n# Task: ${nodeTitle}\n\n${nodeBody}\n\n## Source plan node\n\n- Phase hint: ${phaseHint}\n- Generated: ${new Date().toISOString()}\n`
  await writeFile(fullPath, body, 'utf-8')
  const result = await gitCommitAndPush(`atlas: queue spec from plan node — ${nodeTitle.slice(0, 60)}`, [relPath])
  return { filename, sha: result.sha, pushed: result.pushed }
}

// ─── Reorder helper ────────────────────────────────────────────────────────
export async function reorderPlanNode(
  movedId: string,
  newParentId: string,
  newIndex: number,
  actorPhone?: string,
): Promise<{ ok: boolean; sha?: string; error?: string }> {
  const md = await readPlanMarkdown()
  const tree = parsePlan(md)
  const ok = moveNode(tree, movedId, newParentId, newIndex)
  if (!ok) return { ok: false, error: 'move_failed' }
  const newMd = serializePlan(tree)
  const result = await writePlanMarkdown(
    newMd,
    `chore(plan): reorder ${movedId} → ${newParentId}#${newIndex}`,
    'reorder',
    actorPhone,
  )
  return { ok: true, sha: result.sha }
}

// ─── Workflow graph parser (MAXONS_Workflow_v1.md → nodes/edges) ───────────
//
// Phase 1.10at moved the parser into ./workflow-parser.ts (with caching +
// baseline fallback). This file just re-exports the public types so older
// imports compile.

export type { WorkflowGraphNode, WorkflowGraphEdge, WorkflowGraph } from './workflow-parser'

// ─── Discussion-queue helpers ──────────────────────────────────────────────

export interface DiscussionItem {
  artifact_kind: 'design_audit' | 'open_fork' | 'pending_spec' | 'plan_node'
  artifact_ref: string
  context: Record<string, unknown>
  notes?: string
}

export async function moveItemsToDiscussion(items: DiscussionItem[]): Promise<{ inserted: number }> {
  const sb = getSupabaseClient()
  if (!sb) return { inserted: 0 }
  if (!items.length) return { inserted: 0 }
  const rows = items.map(it => ({
    artifact_kind: it.artifact_kind,
    artifact_ref: it.artifact_ref,
    context: it.context,
    notes: it.notes ?? null,
  }))
  const { data, error } = await sb.from('atlas_discussion_queue').insert(rows).select('id')
  if (error) {
    console.warn('[plan-server] discussion insert failed:', error.message)
    return { inserted: 0 }
  }
  return { inserted: data?.length ?? 0 }
}

export async function listDiscussionQueue(): Promise<unknown[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('atlas_discussion_queue')
    .select('*')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    console.warn('[plan-server] discussion list failed:', error.message)
    return []
  }
  return data ?? []
}

export async function resolveDiscussionItem(
  id: string,
  resolution: 'queued' | 'dismissed' | 'forked',
): Promise<{ ok: boolean }> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false }
  const { error } = await sb
    .from('atlas_discussion_queue')
    .update({ resolution, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.warn('[plan-server] discussion resolve failed:', error.message)
    return { ok: false }
  }
  return { ok: true }
}

// ─── Cross-reference: linked specs by title fuzzy-match ────────────────────

interface SpecHit {
  filename: string
  status: 'queued' | 'done' | 'failed' | 'in-progress'
}

export async function findRelatedSpecs(query: string): Promise<SpecHit[]> {
  const out: SpecHit[] = []
  const buckets: Array<{ dir: string; status: SpecHit['status'] }> = [
    { dir: '.agent/tasks/queued', status: 'queued' },
    { dir: '.agent/tasks/done', status: 'done' },
    { dir: '.agent/tasks/failed', status: 'failed' },
    { dir: '.agent/tasks/in-progress', status: 'in-progress' },
  ]
  const needle = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3)
  if (!needle.length) return out
  for (const b of buckets) {
    let files: string[] = []
    try {
      files = (await readdir(resolve(REPO_ROOT, b.dir))).filter(f => f.endsWith('.md'))
    } catch {
      continue
    }
    for (const f of files) {
      const lower = f.toLowerCase()
      if (needle.some(n => lower.includes(n))) {
        out.push({ filename: f, status: b.status })
      }
    }
  }
  return out
}

// ─── Plan amendment via Claude (instruction → new markdown) ────────────────

type AmendClient = {
  messages: {
    create: (args: {
      model: string
      max_tokens: number
      system: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>
  }
}

export async function amendPlanWithClaude(
  instruction: string,
  anthropic: AmendClient,
): Promise<{ markdown: string; reasoning: string }> {
  const md = await readPlanMarkdown()
  const prompt = `You are editing the CropsIntel V3 master plan. Apply the user's instruction faithfully and return ONLY the full updated markdown file content (no commentary, no fences).\n\nInstruction:\n${instruction}\n\nCurrent plan:\n\n${md}`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    system: 'You are a precise document editor. You receive a markdown file and an instruction; return ONLY the new full markdown file content. Preserve heading levels and structure unless the instruction explicitly says to change them.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text!)
    .join('\n')
    .trim()

  // Tolerance: if the model wrapped the response in fences, strip them.
  const stripped = text
    .replace(/^```(?:markdown|md)?\n/, '')
    .replace(/\n```\s*$/, '')

  return { markdown: stripped, reasoning: 'amended via claude-opus-4-7' }
}

// ───────────────────────────────────────────────────────────────────────────
// Phase A.6 — diff-and-confirm flow + free-form draft.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compute a small unified-diff-style summary between two markdown bodies.
 * NOT a full LCS diff — just line-by-line counts + a sample of changed lines
 * so the chat can render a 3-5 line "X added, Y removed" preview without
 * exploding token budget. The full new markdown is also returned so the
 * apply step can write it verbatim without re-running the model.
 */
export function summarizeMarkdownDiff(before: string, after: string): {
  addedLines: number
  removedLines: number
  unchangedLines: number
  sample: { added: string[]; removed: string[] }
} {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const beforeSet = new Map<string, number>()
  for (const l of beforeLines) beforeSet.set(l, (beforeSet.get(l) ?? 0) + 1)
  const afterSet = new Map<string, number>()
  for (const l of afterLines) afterSet.set(l, (afterSet.get(l) ?? 0) + 1)

  let added = 0
  let removed = 0
  let unchanged = 0
  const addedSample: string[] = []
  const removedSample: string[] = []

  for (const line of afterLines) {
    const beforeCount = beforeSet.get(line) ?? 0
    if (beforeCount > 0) {
      unchanged++
      beforeSet.set(line, beforeCount - 1)
    } else {
      added++
      if (addedSample.length < 8 && line.trim().length > 0) addedSample.push(line.slice(0, 200))
    }
  }
  for (const [line, count] of beforeSet.entries()) {
    if (count <= 0) continue
    removed += count
    if (removedSample.length < 8 && line.trim().length > 0) {
      for (let i = 0; i < count && removedSample.length < 8; i++) {
        removedSample.push(line.slice(0, 200))
      }
    }
  }

  return {
    addedLines: added,
    removedLines: removed,
    unchangedLines: unchanged,
    sample: { added: addedSample, removed: removedSample },
  }
}

/**
 * Diff-only variant of amendPlanWithClaude: runs the same prompt but does NOT
 * write to disk. Returns the proposed full markdown + a diff summary the chat
 * can render. Caller then sends the markdown back via applyPendingAmendment
 * to actually write it.
 */
export async function draftPlanAmendment(
  instruction: string,
  anthropic: AmendClient,
): Promise<{ proposedMarkdown: string; currentMarkdown: string; diff: ReturnType<typeof summarizeMarkdownDiff>; reasoning: string }> {
  const before = await readPlanMarkdown()
  const { markdown: after, reasoning } = await amendPlanWithClaude(instruction, anthropic)
  const diff = summarizeMarkdownDiff(before, after)
  return {
    proposedMarkdown: after,
    currentMarkdown: before,
    diff,
    reasoning,
  }
}

/**
 * Apply a previously-drafted plan amendment. Caller hands us the markdown
 * that came out of draftPlanAmendment. We commit + push it.
 */
export async function applyPendingPlanAmendment(
  proposedMarkdown: string,
  amendmentSummary: string,
  actorPhone?: string,
): Promise<{ sha: string; pushed: boolean }> {
  return writePlanMarkdown(
    proposedMarkdown,
    `atlas: amend plan — ${amendmentSummary.slice(0, 80)}`,
    'amend',
    actorPhone,
    amendmentSummary,
  )
}

/**
 * Free-form "draft a new plan from this prompt" — generates a fresh master
 * plan markdown structure based on the user's freeform goals. Used by the
 * "clean rebuild" / "draft me a plan from scratch" chat flow.
 *
 * Does NOT apply — returns the proposed markdown + diff against current plan.
 * User reviews + applies via applyPendingPlanAmendment.
 *
 * Caller can pass contextRefs (file paths under .agent/ or docs/) that get
 * read and inlined into the prompt as "draw from these documents". Common
 * uses: docs/v3-step2-v1-audit.md, docs/v3-step3-v2-audit.md,
 * docs/MAXONS_Workflow_v1.md.
 */
export async function draftNewPlan(
  freeformPrompt: string,
  contextRefs: string[],
  anthropic: AmendClient,
): Promise<{ proposedMarkdown: string; currentMarkdown: string; diff: ReturnType<typeof summarizeMarkdownDiff>; reasoning: string }> {
  const before = await readPlanMarkdown().catch(() => '')

  const contextBlocks: string[] = []
  for (const ref of contextRefs) {
    try {
      const path = resolve(REPO_ROOT, ref)
      const content = await readFile(path, 'utf-8')
      // Cap each context doc at 12KB so we don't blow Claude's context budget.
      contextBlocks.push(`### Context from ${ref}\n\n${content.slice(0, 12_000)}`)
    } catch {
      contextBlocks.push(`### Context from ${ref}\n\n(file not found — skipping)`)
    }
  }

  const prompt = [
    `You are drafting a fresh master plan for CropsIntel V3.`,
    ``,
    `User's freeform brief:`,
    freeformPrompt,
    ``,
    contextBlocks.length > 0 ? `Reference documents to draw from (DO NOT copy verbatim — distill into a new plan):\n\n${contextBlocks.join('\n\n---\n\n')}` : '',
    ``,
    `Current master plan (for reference; you may replace it entirely or evolve it — follow the user's intent):`,
    ``,
    before.slice(0, 16_000),
    ``,
    `Return ONLY the new full master-plan markdown file content. Use H1 + H2 headings for top-level phases. Each leaf node should be a concrete deliverable. Preserve any structural elements (frontmatter, navigation lines) only if they were already present.`,
  ].filter(Boolean).join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    system: 'You are a senior product architect drafting a master plan. The output must be a complete, actionable, structured markdown document — phases as H1/H2, leaves as concrete deliverables. Return ONLY the markdown file content; no preamble, no fences.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text!)
    .join('\n')
    .trim()
  const after = text.replace(/^```(?:markdown|md)?\n/, '').replace(/\n```\s*$/, '')

  const diff = summarizeMarkdownDiff(before, after)
  return {
    proposedMarkdown: after,
    currentMarkdown: before,
    diff,
    reasoning: `drafted via claude-opus-4-7 with ${contextRefs.length} context refs`,
  }
}
