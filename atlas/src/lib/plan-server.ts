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

export async function getPlanResponse(): Promise<{ updatedAt: string; sha: string; tree: PlanTree['root']; flat: PlanTree['flat'] }> {
  const md = await readPlanMarkdown()
  const tree = parsePlan(md)
  const sha = await gitHeadSha()
  return { updatedAt: new Date().toISOString(), sha, tree: tree.root, flat: tree.flat }
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

export async function queueSpecFromPlanNode(
  nodeTitle: string,
  nodeBody: string,
  phaseHint: string,
): Promise<{ filename: string; sha: string; pushed: boolean }> {
  const slug = slugFromTitle(nodeTitle) || 'plan-node'
  const phaseSlug = slugFromTitle(phaseHint) || 'plan'
  const filename = `phase-${phaseSlug}-${slug}.md`
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
