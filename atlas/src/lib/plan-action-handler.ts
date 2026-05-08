// Phase 1.10aj — handlers for the four cockpit action buttons:
// Add / Modify / Follow / Revisit.
//
// "Add" and "Modify" run the wizard (wizard-engine + spec-from-wizard) but
// don't write anything to disk yet — the spec preview is shown to the user
// first. The actual write happens in followPhase() below.
//
// "Follow" persists the spec to .agent/tasks/queued/, sets state='follow' on
// the plan node so the tree paints emerald, and (for cockpit-added phases)
// invokes the master-plan-updater.
//
// "Revisit" toggles state='revisit' on the plan node so the build runner
// skips it. Click again to clear.

import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import { setPlanNodeState, clearPlanNodeState } from './plan-state'
import { proposeWizardQuestions, type WizardQuestion, type WizardProposeInput } from './wizard-engine'
import { specFromWizard, type WizardAnswer, type SpecFromWizardResult } from './spec-from-wizard'
import { findExistingSpecBucket, buildDuplicateSpecError, REPO_ROOT } from './plan-server'
import { withGitLock } from './git-mutex'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { appendCockpitPhaseToMasterPlan } from './master-plan-updater'

const execFileP = promisify(execFile)

export type PlanAction = 'add' | 'modify' | 'follow' | 'revisit'

export interface AddOrModifyResult {
  questions: WizardQuestion[]
  source: 'claude' | 'fallback'
  costUsd: number
}

/** Open the wizard for Add. Same shape as Modify but no existingSpec passed. */
export async function startAddWizard(input: {
  parentTitle: string
  parentBody: string
  phaseHint: string
  conceptSummaries?: string[]
  recentDoneSpecs?: string[]
}): Promise<AddOrModifyResult> {
  const proposeInput: WizardProposeInput = { ...input, mode: 'add' }
  const result = await proposeWizardQuestions(proposeInput)
  return { questions: result.questions, source: result.source, costUsd: result.costUsd }
}

/** Open the wizard for Modify — seeds the existing spec body. */
export async function startModifyWizard(input: {
  parentTitle: string
  parentBody: string
  phaseHint: string
  existingSpec: string
  conceptSummaries?: string[]
  recentDoneSpecs?: string[]
}): Promise<AddOrModifyResult> {
  const proposeInput: WizardProposeInput = { ...input, mode: 'modify' }
  const result = await proposeWizardQuestions(proposeInput)
  return { questions: result.questions, source: result.source, costUsd: result.costUsd }
}

export interface FollowPhaseInput {
  planNodeId: string
  parentTitle: string
  phaseId: string
  phaseHint: string
  mode: 'add' | 'modify'
  answers: WizardAnswer[]
  conceptSummaries?: string[]
  existingSpec?: string
  /**
   * When true, this is a brand-new phase added via cockpit Add — the
   * master-plan-updater appends it to docs/master-plan.md so the markdown
   * stays the source of truth.
   */
  isNewPhase: boolean
  actorPhone?: string
}

export interface FollowPhaseResult {
  ok: boolean
  filename: string
  spec: SpecFromWizardResult
  pushed: boolean
  sha?: string
  masterPlanUpdated: boolean
  reason?: string
}

/**
 * Persist a wizard-generated spec to .agent/tasks/queued/, set follow state
 * on the node, and (when isNewPhase) append the phase to the master plan.
 *
 * Idempotent against duplicate filenames — refuses to overwrite an existing
 * spec in queued/, in-progress/, or done/ buckets.
 */
export async function followPhase(input: FollowPhaseInput): Promise<FollowPhaseResult> {
  const spec = await specFromWizard({
    parentTitle: input.parentTitle,
    phaseId: input.phaseId,
    phaseHint: input.phaseHint,
    mode: input.mode,
    answers: input.answers,
    conceptSummaries: input.conceptSummaries,
    existingSpec: input.existingSpec,
  })

  const existing = await findExistingSpecBucket(spec.filename)
  if (existing) {
    return {
      ok: false,
      filename: spec.filename,
      spec,
      pushed: false,
      masterPlanUpdated: false,
      reason: buildDuplicateSpecError(spec.filename, existing),
    }
  }

  const relPath = `.agent/tasks/queued/${spec.filename}`
  const fullPath = resolve(REPO_ROOT, relPath)
  await writeFile(fullPath, spec.markdown, 'utf-8')

  // Mark the plan node as follow so the tree paints emerald.
  await setPlanNodeState({
    planNodeId: input.planNodeId,
    state: 'queued-no-build',
    setBy: 'user',
    metadata: { spec_filename: spec.filename, follow: true },
  })

  // For cockpit-added (brand-new) phases, append to master plan.
  let masterPlanUpdated = false
  const filesToCommit = [relPath]
  if (input.isNewPhase) {
    const append = await appendCockpitPhaseToMasterPlan({
      phaseId: input.phaseId,
      title: input.parentTitle,
      summary: spec.markdown.slice(0, 600),
      actorPhone: input.actorPhone,
    })
    if (append.ok) {
      masterPlanUpdated = true
      filesToCommit.push(append.relPath)
    }
  }

  const commit = await commitAndPush(
    `feat(cockpit): follow phase ${input.phaseId} — ${input.parentTitle.slice(0, 60)}${input.isNewPhase && masterPlanUpdated ? ' + master plan v1.7' : ''}`,
    filesToCommit,
  )

  return {
    ok: true,
    filename: spec.filename,
    spec,
    pushed: commit.pushed,
    sha: commit.sha,
    masterPlanUpdated,
  }
}

async function commitAndPush(message: string, files: string[]): Promise<{ sha: string; pushed: boolean }> {
  return withGitLock(`cockpit:${message.slice(0, 40)}`, async () => {
    try {
      await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO_ROOT })
    } catch (err) {
      console.warn('[plan-action-handler] pull failed (continuing):', err instanceof Error ? err.message : err)
    }
    for (const f of files) {
      try {
        await execFileP('git', ['add', f], { cwd: REPO_ROOT })
      } catch (err) {
        console.warn(`[plan-action-handler] git add ${f} failed:`, err instanceof Error ? err.message : err)
      }
    }
    try {
      await execFileP(
        'git',
        ['-c', 'user.name=Atlas-Cockpit', '-c', 'user.email=cockpit@cropsintel.local', 'commit', '-m', message],
        { cwd: REPO_ROOT },
      )
    } catch (err) {
      console.warn('[plan-action-handler] commit produced no changes:', err instanceof Error ? err.message : err)
      const sha = await gitHeadSha()
      return { sha, pushed: false }
    }
    const sha = await gitHeadSha()
    try {
      await execFileP('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT })
      return { sha, pushed: true }
    } catch (err) {
      console.error('[plan-action-handler] push failed:', err)
      return { sha, pushed: false }
    }
  })
}

async function gitHeadSha(): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
    return stdout.trim()
  } catch {
    return 'unknown'
  }
}

/**
 * Toggle revisit state on a plan node. If currently revisit, clear it; else
 * set it. The build runner skips any node carrying state='optional'
 * (which is what revisit maps to in atlas_plan_node_state — reuses the
 * existing CHECK enum so we don't need a schema migration).
 */
export async function toggleRevisit(planNodeId: string): Promise<{ ok: boolean; revisiting: boolean; reason?: string }> {
  const { getPlanNodeState } = await import('./plan-state.js')
  const rows = await getPlanNodeState(planNodeId)
  const isRevisit = rows.some((r: { state: string; metadata: Record<string, unknown> | null }) =>
    r.state === 'optional' && r.metadata && (r.metadata as Record<string, unknown>).revisit === true)
  if (isRevisit) {
    const r = await clearPlanNodeState(planNodeId, 'optional')
    return { ok: r.ok, revisiting: false, reason: r.reason }
  } else {
    const r = await setPlanNodeState({
      planNodeId,
      state: 'optional',
      setBy: 'user',
      metadata: { revisit: true },
      reason: 'cockpit revisit',
    })
    return { ok: r.ok, revisiting: true, reason: r.reason }
  }
}
