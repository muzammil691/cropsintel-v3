// 1.10bd-queue-pivot Step 3b — atomic /queue handler + crash recovery.
//
// Owns the "approve to queue" transition for workshop diffs:
//   1. Atomic master-plan mutation + filesystem spec drafting in one commit.
//   2. Rollback (git checkout HEAD) on push failure, surfaced as
//      status='rolled_back' on the atlas_queue_operations row.
//   3. Hard failure path captured as status='failure' with the error.
//   4. Conductor boot recovery: detect ahead-of-remote state, retry push,
//      freeze /queue if push still fails.
//   5. Module-level freeze flag the /queue route checks before doing work.
//
// All operations write to atlas_queue_operations with start/complete
// timestamps, op counts, commit_sha, pushed boolean, and a forensic
// meta_json blob — see migration 1.10bd-queue-pivot-step2 for the schema.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, mkdir, rm, rename, access } from 'fs/promises'
import { resolve, dirname } from 'path'

import { applyOpsToMasterPlan, type PlanDiffOp } from './workshop-diff-applier'
import { REPO_ROOT, PLAN_PATH_REL, findExistingSpecBucket } from './plan-server'
import { withGitLock } from './git-mutex'
import { getSupabaseClient } from './supabase'

const execFileP = promisify(execFile)

// ─── Module-level freeze flag ─────────────────────────────────────────
// Set by boot recovery when local is ahead-of-remote with a failed push,
// or when conductor detects a diverged state. The /queue handler
// short-circuits with 503 while the flag is set.

let queueFrozenReason: string | null = null

export function isQueueFrozen(): boolean {
  return queueFrozenReason !== null
}

export function getQueueFreezeReason(): string | null {
  return queueFrozenReason
}

export function freezeQueue(reason: string): void {
  console.warn(`[queue-orchestrator] freeze: ${reason}`)
  queueFrozenReason = reason
}

export function unfreezeQueue(): void {
  if (queueFrozenReason) {
    console.log('[queue-orchestrator] unfreezing (was: ' + queueFrozenReason + ')')
    queueFrozenReason = null
  }
}

// ─── Git state inspection ─────────────────────────────────────────────

export type GitState =
  | { state: 'clean' }
  | { state: 'ahead'; commits: number }
  | { state: 'behind'; commits: number }
  | { state: 'diverged'; ahead: number; behind: number }
  | { state: 'error'; error: string }

export async function getGitState(): Promise<GitState> {
  try {
    // Fetch latest origin so the ahead/behind counts reflect reality.
    await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
    const { stdout: ahead } = await execFileP('git', ['rev-list', '--count', 'origin/main..HEAD'], { cwd: REPO_ROOT })
    const { stdout: behind } = await execFileP('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: REPO_ROOT })
    const aheadN = parseInt(ahead.trim(), 10) || 0
    const behindN = parseInt(behind.trim(), 10) || 0
    if (aheadN === 0 && behindN === 0) return { state: 'clean' }
    if (aheadN > 0 && behindN === 0) return { state: 'ahead', commits: aheadN }
    if (aheadN === 0 && behindN > 0) return { state: 'behind', commits: behindN }
    return { state: 'diverged', ahead: aheadN, behind: behindN }
  } catch (err) {
    return { state: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Boot recovery ────────────────────────────────────────────────────
//
// Called once at conductor start. Resolves three cases:
//   ahead    → orphan local commit from a crashed /queue handler. Check
//              atlas_queue_operations for in_progress rows; if none, try
//              to push. Push success → continue. Push fail → freeze
//              queue, surface in /health.
//   behind   → normal — pull --rebase.
//   diverged → hard stop. Freeze queue. Fire WhatsApp alert. Operator
//              must intervene.
//   error    → log + continue (often a network blip; don't freeze
//              unnecessarily, but surface in /health).

export async function bootGitRecovery(opts?: {
  notifyWhatsApp?: (message: string) => Promise<unknown>
}): Promise<{ state: GitState; action: string; queueFrozen: boolean }> {
  const state = await getGitState()

  if (state.state === 'clean') {
    return { state, action: 'no-op', queueFrozen: false }
  }

  if (state.state === 'behind') {
    try {
      await withGitLock('boot-recovery-pull', async () => {
        await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO_ROOT })
      })
      return { state, action: 'pulled-rebase', queueFrozen: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      freezeQueue(`boot pull --rebase failed: ${msg}`)
      return { state, action: 'pull-failed', queueFrozen: true }
    }
  }

  if (state.state === 'ahead') {
    // Check for in-flight queue ops — if any are still status='in_progress',
    // a /queue handler crashed mid-flow and the local commit is the
    // partial-state we'd otherwise overwrite. Surface so the operator can
    // inspect; don't auto-push until those rows are resolved.
    const sb = getSupabaseClient()
    let inFlight = 0
    if (sb) {
      const { count } = await sb
        .from('atlas_queue_operations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'in_progress')
        .lt('started_at', new Date(Date.now() - 60_000).toISOString()) // older than 1 min
      inFlight = count ?? 0
    }
    if (inFlight > 0) {
      freezeQueue(`local ahead by ${state.commits} with ${inFlight} stuck in_progress queue op(s) — inspect atlas_queue_operations`)
      return { state, action: 'frozen-stuck-rows', queueFrozen: true }
    }
    try {
      await withGitLock('boot-recovery-push', async () => {
        await execFileP('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT })
      })
      return { state, action: 'pushed', queueFrozen: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      freezeQueue(`boot push failed (local ahead by ${state.commits}): ${msg}`)
      return { state, action: 'push-failed', queueFrozen: true }
    }
  }

  if (state.state === 'diverged') {
    freezeQueue(`diverged: local ahead ${state.ahead}, behind ${state.behind} — manual rebase required`)
    if (opts?.notifyWhatsApp) {
      try {
        await opts.notifyWhatsApp(
          `Atlas boot: git diverged (ahead ${state.ahead}, behind ${state.behind}). Queue frozen. Manual rebase needed on Railway.`,
        )
      } catch { /* alerting must never block boot */ }
    }
    return { state, action: 'frozen-diverged', queueFrozen: true }
  }

  // state.state === 'error' — log + continue.
  console.warn('[queue-orchestrator] boot git-state check errored:', state.error)
  return { state, action: 'continue-on-error', queueFrozen: false }
}

// ─── Spec body synthesis ──────────────────────────────────────────────

function slugifyForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function specFilenameFor(phaseId: string, title?: string): string {
  // builderQueueSpec validation requires phase- prefix + .md suffix. Keep
  // phase_id intact (dots and dashes are allowed in shell-safe paths on
  // POSIX) and append a short slugified title suffix when available.
  const idPart = phaseId.replace(/[^a-z0-9.-]/gi, '-')
  const titlePart = title ? `-${slugifyForFilename(title)}` : ''
  return `phase-${idPart}${titlePart}.md`
}

function synthSpecBody(op: Extract<PlanDiffOp, { op: 'add' | 'edit' }>): string {
  const titleLine = op.title ? `# ${op.phase_id}: ${op.title}` : `# ${op.phase_id}`
  const bodyText = (op.body ?? '').trim()
  const tierLine = op.launch_tier ? `\n_launch tier: ${op.launch_tier}_\n` : ''
  return `${titleLine}\n${tierLine}\n${bodyText || '_(no body provided in diff — fill in before building)_'}\n`
}

// ─── /queue handler core ──────────────────────────────────────────────

export interface QueueWorkshopDiffInput {
  diffId: string
  memberId: string | null
  sessionId: string | null
  ops: PlanDiffOp[]
  /** Already-loaded plan_diffs row's diff_jsonb — caller provides to avoid
   *  another DB roundtrip in this function. */
  diffJsonb: { ops: PlanDiffOp[]; summary?: string }
}

export interface QueueWorkshopDiffResult {
  ok: boolean
  status: 'success' | 'rolled_back' | 'failure'
  appliedAt: string | null
  opsTotal: number
  opsApplied: number
  opsSkipped: number
  specsDrafted: number
  specPaths: string[]
  commitSha: string | null
  pushed: boolean
  error: string | null
  queueOpId: string | null
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

/**
 * Atomic apply: read master plan → compute new markdown in memory → write
 * everything to a temp working area → fs.rename into final locations →
 * single git commit + push → roll back via `git checkout HEAD --` if push
 * fails. Every outcome lands in atlas_queue_operations.
 */
export async function queueWorkshopDiff(
  input: QueueWorkshopDiffInput,
): Promise<QueueWorkshopDiffResult> {
  if (isQueueFrozen()) {
    return {
      ok: false,
      status: 'failure',
      appliedAt: null,
      opsTotal: input.ops.length,
      opsApplied: 0,
      opsSkipped: 0,
      specsDrafted: 0,
      specPaths: [],
      commitSha: null,
      pushed: false,
      error: `queue frozen: ${getQueueFreezeReason()}`,
      queueOpId: null,
    }
  }

  const sb = getSupabaseClient()

  // 1. Open atlas_queue_operations row — status='in_progress'.
  let queueOpId: string | null = null
  if (sb) {
    const { data, error } = await sb
      .from('atlas_queue_operations')
      .insert({
        diff_id: input.diffId,
        session_id: input.sessionId,
        member_id: input.memberId,
        status: 'in_progress',
        ops_total: input.ops.length,
      })
      .select('id')
      .single()
    if (!error && data) queueOpId = (data as { id: string }).id
  }

  const tmpDir = resolve(REPO_ROOT, `.agent/.tmp-queue-${input.diffId}`)
  const planPathAbs = resolve(REPO_ROOT, PLAN_PATH_REL)
  let touchedFiles: string[] = []
  let specPaths: string[] = []
  let applyResult: { applied: number; skipped: number } = { applied: 0, skipped: 0 }
  let commitSha: string | null = null

  const finalize = async (status: 'success' | 'rolled_back' | 'failure', errorMsg: string | null, pushed: boolean, appliedAt: string | null, meta: Record<string, unknown>) => {
    if (sb && queueOpId) {
      await sb.from('atlas_queue_operations').update({
        status,
        completed_at: new Date().toISOString(),
        applied_at: appliedAt,
        ops_applied: applyResult.applied,
        ops_skipped: applyResult.skipped,
        specs_drafted: specPaths.length,
        commit_sha: commitSha,
        pushed,
        error: errorMsg,
        meta_json: meta,
      }).eq('id', queueOpId)
    }
    // Best-effort cleanup of the temp dir.
    try { await rm(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    return {
      ok: status === 'success',
      status,
      appliedAt,
      opsTotal: input.ops.length,
      opsApplied: applyResult.applied,
      opsSkipped: applyResult.skipped,
      specsDrafted: specPaths.length,
      specPaths,
      commitSha,
      pushed,
      error: errorMsg,
      queueOpId,
    } as QueueWorkshopDiffResult
  }

  try {
    // 2. Read current master plan + compute new markdown in memory.
    let currentPlan = ''
    try {
      currentPlan = await readFile(planPathAbs, 'utf-8')
    } catch (err) {
      return await finalize('failure', `master plan not readable: ${err instanceof Error ? err.message : String(err)}`, false, null, { stage: 'read-plan' })
    }

    const computed = applyOpsToMasterPlan(currentPlan, input.ops)
    applyResult = { applied: computed.applied.length, skipped: computed.skipped.length }

    // 3. Synthesize specs for add/edit ops THAT WERE APPLIED. Skipped ops
    // (e.g. cascade-blocked remove, missing parent_id) get no spec.
    const appliedAddEdits = computed.applied
      .map((v) => v.op)
      .filter((o): o is Extract<PlanDiffOp, { op: 'add' | 'edit' }> => o.op === 'add' || o.op === 'edit')

    const specFiles: Array<{ filename: string; body: string }> = []
    const filenameConflicts: string[] = []
    for (const op of appliedAddEdits) {
      const filename = specFilenameFor(op.phase_id, op.title)
      const existing = await findExistingSpecBucket(filename)
      if (existing) {
        filenameConflicts.push(`${filename} (already in ${existing})`)
        continue
      }
      specFiles.push({ filename, body: synthSpecBody(op) })
    }
    if (filenameConflicts.length > 0) {
      return await finalize('failure', `spec filename collision(s): ${filenameConflicts.join(', ')}`, false, null, { stage: 'collision-check', conflicts: filenameConflicts })
    }

    // 4. Write tmp dir.
    await mkdir(tmpDir, { recursive: true })
    const tmpPlanPath = resolve(tmpDir, 'master-plan.md')
    await writeFile(tmpPlanPath, computed.markdown, 'utf-8')
    const tmpSpecPaths: Array<{ tmp: string; final: string; relFinal: string }> = []
    for (const s of specFiles) {
      const tmp = resolve(tmpDir, s.filename)
      const relFinal = `.agent/tasks/queued/${s.filename}`
      const final = resolve(REPO_ROOT, relFinal)
      await writeFile(tmp, s.body, 'utf-8')
      tmpSpecPaths.push({ tmp, final, relFinal })
    }

    // 5. Atomic moves: tmp → final.
    await mkdir(resolve(REPO_ROOT, '.agent/tasks/queued'), { recursive: true })
    await rename(tmpPlanPath, planPathAbs)
    touchedFiles.push(PLAN_PATH_REL)
    for (const s of tmpSpecPaths) {
      await rename(s.tmp, s.final)
      touchedFiles.push(s.relFinal)
      specPaths.push(s.relFinal)
    }

    // 6. Single git commit + push under the existing mutex.
    let pushed = false
    try {
      const result = await withGitLock('queue-workshop-diff', async () => {
        // Pre-commit pull --rebase to land on top of any concurrent change.
        try {
          await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO_ROOT })
        } catch (err) {
          console.warn('[queue-orchestrator] pre-commit pull --rebase warned:', err)
        }
        for (const f of touchedFiles) {
          await execFileP('git', ['add', f], { cwd: REPO_ROOT })
        }
        const summary = (input.diffJsonb.summary ?? `queue diff ${input.diffId.slice(0, 8)}`).slice(0, 80)
        const commitMsg = `workshop: queue ${specFiles.length} spec${specFiles.length === 1 ? '' : 's'} — ${summary}\n\ndiff_id: ${input.diffId}`
        try {
          await execFileP('git', ['-c', 'user.name=Atlas', '-c', 'user.email=atlas@cropsintel.local', 'commit', '-m', commitMsg], { cwd: REPO_ROOT })
        } catch (commitErr) {
          throw new Error(`commit failed: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`)
        }
        const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
        const sha = stdout.trim()
        try {
          await execFileP('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT })
          return { sha, pushed: true }
        } catch (pushErr) {
          // Push failed → local has the commit but remote doesn't.
          const msg = pushErr instanceof Error ? pushErr.message : String(pushErr)
          return { sha, pushed: false, pushError: msg }
        }
      })
      commitSha = result.sha
      pushed = result.pushed
      if (!pushed) {
        // Rollback: hard-reset the working tree to origin/main so the
        // local commit is discarded along with the file changes. We use
        // reset --hard origin/main rather than checkout because the
        // commit itself needs to go away — leaving it would re-surface
        // the same partial state on the next boot recovery.
        try {
          await withGitLock('queue-rollback', async () => {
            await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: REPO_ROOT })
          })
        } catch (resetErr) {
          // Rollback itself failed — freeze the queue and surface in /health.
          const msg = resetErr instanceof Error ? resetErr.message : String(resetErr)
          freezeQueue(`rollback failed after push failure: ${msg}`)
          return await finalize('failure', `push failed AND rollback failed: ${msg}`, false, null, {
            stage: 'rollback', commit_sha: commitSha, applied_ops: computed.applied.map((v) => v.op), skipped_ops: computed.skipped,
          })
        }
        return await finalize('rolled_back', `git push failed; working tree reset to origin/main`, false, null, {
          stage: 'push', commit_sha: commitSha, applied_ops: computed.applied.map((v) => v.op),
        })
      }
    } catch (gitErr) {
      // Pre-push error (commit failure, mutex error, etc.). Try to roll
      // back unstaged changes so the working tree isn't dirty.
      const msg = gitErr instanceof Error ? gitErr.message : String(gitErr)
      try {
        await execFileP('git', ['checkout', 'HEAD', '--', ...touchedFiles], { cwd: REPO_ROOT })
      } catch { /* ignore */ }
      return await finalize('failure', msg, false, null, { stage: 'git-commit', touched: touchedFiles })
    }

    // 7. Push succeeded. Stamp applied_at on plan_diffs.
    const nowIso = new Date().toISOString()
    if (sb) {
      const { error } = await sb
        .from('plan_diffs')
        .update({ applied_at: nowIso })
        .eq('id', input.diffId)
      if (error) {
        // Filesystem is committed + pushed but DB is out of sync. Don't
        // roll back — that would un-push a successful commit. Surface as
        // success with a meta_json hint so the operator can reconcile.
        return await finalize('success', `applied_at update failed (filesystem already pushed): ${error.message}`, true, null, {
          stage: 'post-push', commit_sha: commitSha, applied_at_db_error: error.message,
        })
      }
    }

    return await finalize('success', null, true, nowIso, {
      stage: 'done',
      commit_sha: commitSha,
      applied_ops: computed.applied.map((v) => v.op),
      skipped_ops: computed.skipped,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return await finalize('failure', msg, false, null, { stage: 'unhandled', error: msg })
  }
}
