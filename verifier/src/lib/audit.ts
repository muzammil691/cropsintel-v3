import { VerificationResult } from '../types'
import { getSupabaseClient } from './supabase'

export type UnknownReason =
  | 'spec_not_found'
  | 'sync_failed'
  | 'judge_unreachable'
  | 'verify_crashed'
  | 'db_write_failed'

export async function writeVerifierRun(
  result: VerificationResult,
  taskSpecPath: string,
  commitSha: string,
  mode: 'audit-only' | 'gate',
  remediationTaskId?: string,
): Promise<void> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    console.warn('[verifier] Supabase not configured — skipping audit log write')
    return
  }

  const { error } = await supabase.from('verifier_runs').insert({
    task_id: result.taskId,
    task_spec_path: taskSpecPath,
    commit_sha: commitSha,
    mode,
    passed: result.passed,
    gaps: result.gaps,
    remediation_task_id: remediationTaskId ?? null,
    duration_ms: result.durationMs,
  })

  if (error) {
    // Throw, don't swallow. The caller decides what to do (downgrade to
    // verdict=unknown). Silently logging caused false-passes when Supabase
    // was unreachable: server.ts would still respond verdict=pass even
    // though no row was written, so agent-loop shipped unverified commits.
    console.error('[verifier] Failed to write audit log:', error.message)
    throw new Error(`verifier_runs insert failed: ${error.message}`)
  }
}

// Write a row with passed=NULL when the verifier could not produce a real
// verdict (spec missing, sync failed, judge unreachable, etc.). The
// workflow-trace invariant checker keys on row presence per (task_id,
// commit_sha), so writing this row prevents false `verifier_audit_missing`
// flags from Atlas while still recording that no real signal was obtained.
export async function writeUnknownVerifierRun(
  taskId: string,
  taskSpecPath: string | null,
  commitSha: string,
  mode: 'audit-only' | 'gate',
  unknownReason: UnknownReason,
  durationMs: number,
): Promise<void> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    console.warn('[verifier] Supabase not configured — skipping unknown audit log write')
    return
  }

  const { error } = await supabase.from('verifier_runs').insert({
    task_id: taskId,
    task_spec_path: taskSpecPath ?? `unknown:${taskId}`,
    commit_sha: commitSha,
    mode,
    passed: null,
    gaps: [],
    remediation_task_id: null,
    duration_ms: durationMs,
    unknown_reason: unknownReason,
  })

  if (error) {
    console.error('[verifier] Failed to write unknown audit log:', error.message)
    throw new Error(`verifier_runs unknown insert failed: ${error.message}`)
  }
  console.log(
    `[verifier] wrote unknown verifier_runs row for ${taskId} @ ${commitSha.slice(0, 8)} (reason=${unknownReason})`,
  )
}
