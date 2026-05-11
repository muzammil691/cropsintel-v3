import { VerificationResult } from '../types'
import { requireSupabaseClient } from './supabase'

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
  // Phase 1.10bb: write paths must fail loud if SERVICE_ROLE_KEY is missing.
  // Skipping silently caused verdict=pass to be sent back to agent-loop
  // without any row being persisted, corrupting the audit trail.
  const supabase = requireSupabaseClient()

  const { error } = await supabase.from('verifier_runs').insert({
    task_id: result.taskId,
    task_spec_path: taskSpecPath,
    commit_sha: commitSha,
    mode,
    passed: result.passed,
    gaps: result.gaps,
    remediation_task_id: remediationTaskId ?? null,
    duration_ms: result.durationMs,
    // rem3 — count of fail-keyword matches the council parser flipped from
    // failHits to subjectMatterHits (i.e. they sat inside backticks / fenced
    // blocks / quoted strings / task-id tokens / paths / 40-word post-
    // introducer windows). 0 on every code-only task; non-zero only on
    // investigation/ADR specs whose subject is itself a failure cluster.
    subject_matter_hits: result.subjectMatterHits ?? 0,
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
  // Phase 1.10bb: see writeVerifierRun — write paths must fail loud.
  const supabase = requireSupabaseClient()

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
