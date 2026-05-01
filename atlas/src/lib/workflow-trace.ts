// Phase 1.10al — Workflow chain analysis for the diagnosis "discuss" bucket.
//
// When the classifier picks "discuss" we don't dump the raw payload at the
// user. We walk backwards through the agent choreography:
//
//   designer_audit → commit → spec → conductor decision → parent audit?
//
// If the same task_id has chained through three or more remediation attempts,
// the spec is probably ambiguous and Atlas should escalate to "Should I
// rewrite the spec or pause this thread?".

import { execFile } from 'child_process'
import { promisify } from 'util'
import { getSupabaseClient } from './supabase'

const execFileP = promisify(execFile)
export const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

export interface TraceStep {
  step: string
  detail: string
  timestamp?: string
  sha?: string
}

export interface WorkflowTrace {
  task_id: string | null
  steps: TraceStep[]
  attempt_count: number
  is_remediation_loop: boolean
  summary: string
}

interface CommitInfo {
  sha: string
  subject: string
  iso: string
}

async function gitLogForTask(taskId: string, limit: number): Promise<CommitInfo[]> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', `--max-count=${limit}`, '--all', `--grep=${taskId}`, '--pretty=format:%H%x09%cI%x09%s'],
      { cwd: REPO_ROOT },
    )
    return stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [sha, iso, ...rest] = line.split('\t')
        return { sha, iso, subject: rest.join('\t') }
      })
  } catch {
    return []
  }
}

async function gitCommitInfo(sha: string): Promise<CommitInfo | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null
  try {
    const { stdout } = await execFileP('git', ['log', '-1', '--pretty=format:%H%x09%cI%x09%s', sha], {
      cwd: REPO_ROOT,
    })
    const [s, iso, ...rest] = stdout.split('\t')
    return { sha: s, iso, subject: rest.join('\t') }
  } catch {
    return null
  }
}

function extractTaskId(payload: Record<string, unknown>): string | null {
  // Designer audit / verifier run carry task_id directly.
  const direct = payload['task_id']
  if (typeof direct === 'string' && direct.length > 0) return direct

  // Sometimes the task is encoded in the commit subject of an embedded sha.
  const sha = payload['commit_sha'] ?? payload['sha']
  if (typeof sha === 'string') {
    const match = sha.match(/phase-[\w.-]+/)
    if (match) return match[0]
  }

  return null
}

async function countDesignerRunsForTask(taskId: string): Promise<number> {
  const sb = getSupabaseClient()
  if (!sb) return 0
  try {
    const { count } = await sb
      .from('designer_runs')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .eq('verdict', 'fail')
    return count ?? 0
  } catch {
    return 0
  }
}

async function countVerifierRunsForTask(taskId: string): Promise<number> {
  const sb = getSupabaseClient()
  if (!sb) return 0
  try {
    const { count } = await sb
      .from('verifier_runs')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .eq('passed', false)
    return count ?? 0
  } catch {
    return 0
  }
}

async function listConductorDecisionsForTask(taskId: string): Promise<Array<{ rationale: string; decided_at: string }>> {
  const sb = getSupabaseClient()
  if (!sb) return []
  try {
    const { data } = await sb
      .from('atlas_decisions')
      .select('rationale, decided_at')
      .ilike('rationale', `%${taskId}%`)
      .order('decided_at', { ascending: true })
      .limit(10)
    return (data ?? []) as Array<{ rationale: string; decided_at: string }>
  } catch {
    return []
  }
}

export async function traceArtifact(payload: Record<string, unknown>): Promise<WorkflowTrace> {
  const taskId = extractTaskId(payload)
  const steps: TraceStep[] = []

  if (!taskId) {
    return {
      task_id: null,
      steps: [],
      attempt_count: 0,
      is_remediation_loop: false,
      summary: 'Could not extract a task_id from the artifact payload — no chain to trace.',
    }
  }

  // 1. Find every commit that mentions this task_id.
  const commits = await gitLogForTask(taskId, 12)
  for (const c of commits) {
    steps.push({
      step: 'commit',
      detail: c.subject,
      timestamp: c.iso,
      sha: c.sha.slice(0, 8),
    })
  }

  // 2. If payload references a specific commit_sha, anchor that commit's parent.
  const referencedSha = payload['commit_sha']
  if (typeof referencedSha === 'string') {
    const info = await gitCommitInfo(referencedSha)
    if (info && !commits.some(c => c.sha === info.sha)) {
      steps.unshift({
        step: 'failing_commit',
        detail: info.subject,
        timestamp: info.iso,
        sha: info.sha.slice(0, 8),
      })
    }
  }

  // 3. How many failed designer + verifier runs has this task accumulated?
  const designerFailCount = await countDesignerRunsForTask(taskId)
  const verifierFailCount = await countVerifierRunsForTask(taskId)
  if (designerFailCount > 0) {
    steps.push({
      step: 'designer_failures',
      detail: `${designerFailCount} failed designer audit(s) for this task`,
    })
  }
  if (verifierFailCount > 0) {
    steps.push({
      step: 'verifier_failures',
      detail: `${verifierFailCount} failed verifier run(s) for this task`,
    })
  }

  // 4. Conductor remediation decisions referencing this task.
  const decisions = await listConductorDecisionsForTask(taskId)
  for (const d of decisions) {
    steps.push({
      step: 'conductor_decision',
      detail: d.rationale.slice(0, 200),
      timestamp: d.decided_at,
    })
  }

  const attemptCount = Math.max(commits.length, designerFailCount, verifierFailCount, decisions.length)
  const isLoop = attemptCount >= 3

  const summary = isLoop
    ? `This is the ${ordinal(attemptCount)} remediation attempt on ${taskId}. The spec may be ambiguous — Atlas should ask whether to rewrite it or pause this thread.`
    : `Traced ${steps.length} step(s) for ${taskId}. ${attemptCount} attempt(s) so far — not yet a remediation loop.`

  return { task_id: taskId, steps, attempt_count: attemptCount, is_remediation_loop: isLoop, summary }
}

function ordinal(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`
  return `${n}th`
}

export function formatTraceForChat(trace: WorkflowTrace): string {
  if (!trace.task_id) return trace.summary

  const lines: string[] = []
  lines.push(`I traced this artifact backward across the agent chain. Here's what I see:\n`)
  for (const step of trace.steps.slice(0, 12)) {
    const ts = step.timestamp ? ` (${new Date(step.timestamp).toLocaleString()})` : ''
    const sha = step.sha ? ` — ${step.sha}` : ''
    lines.push(`- ${step.step}${sha}${ts}: ${step.detail}`)
  }
  lines.push('')
  lines.push(trace.summary)

  if (trace.is_remediation_loop) {
    lines.push('')
    lines.push('Three options I can see:')
    lines.push('1. Rewrite the spec to be less ambiguous, then re-queue it.')
    lines.push('2. Pause the thread and discuss with you what the spec should actually achieve.')
    lines.push('3. Mark the failures as known/waived and move on.')
    lines.push('')
    lines.push('Which do you want?')
  }

  return lines.join('\n')
}
