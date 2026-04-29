import { VerificationResult } from '../types'
import { getSupabaseClient } from './supabase'

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
    console.error('[verifier] Failed to write audit log:', error.message)
  }
}
