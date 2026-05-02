// Phase 3 of the agent-loop redesign — pre-build verifier check.
//
// Before a finalized spec gets queued to Builder, we check whether the same
// task or an identical spec has failed before, and surface those warnings as
// a "## Prior-attempt warnings" section appended to the spec markdown.
// Builder reads the warnings and explicitly avoids re-doing what failed.
//
// Two failure-class triggers:
//   1. Soft warning (default): warnings appended, spec still ships.
//   2. Hard escalation: same spec_sha failed in last 24h with same gaps →
//      caller should pause + WhatsApp ping, not queue.
//
// memory.search('agent-history') is also consulted for embedded prior-incident
// context that fetchPriorIncidents in spec-draft already pulls — but that runs
// BEFORE Council writes the spec, so its results inform Council's draft, not
// the post-draft preflight. This module runs AFTER the final markdown exists,
// which is when "did this exact spec fail before?" is answerable.

import { getSupabaseClient } from './supabase'
import { computeSpecSha } from './build-attempts'

export interface PreflightWarning {
  kind: 'prior-fail' | 'identical-spec-recently-failed' | 'gap-pattern'
  message: string
  evidence?: Record<string, unknown>
}

export interface PreflightResult {
  warnings: PreflightWarning[]
  priorAttempts: number
  /** Number of times this exact spec_sha failed in the last 24h. */
  identicalRecentFailures: number
  /** Suggested action for the caller. */
  recommendation: 'queue' | 'queue-with-warnings' | 'escalate'
}

const RECENT_WINDOW_HOURS = 24
const HARD_ESCALATE_IDENTICAL_THRESHOLD = 2

interface VerifierRunSlim {
  passed: boolean | null
  gaps: unknown
  ran_at: string | null
  commit_sha: string | null
}

interface BuildAttemptSlim {
  spec_sha: string | null
  status: string | null
  attempt_number: number | null
  failure_gaps: unknown
  planned_at: string | null
}

function summarizeGaps(rawGaps: unknown): string[] {
  if (!Array.isArray(rawGaps)) return []
  return rawGaps
    .slice(0, 4)
    .map((g) => {
      const gap = g as { check?: string; actual?: string; description?: string }
      const check = String(gap.check ?? 'gap')
      const detail = String(gap.actual ?? gap.description ?? '').slice(0, 160)
      return detail ? `${check}: ${detail}` : check
    })
}

function formatRelative(ts: string | null | undefined): string {
  if (!ts) return 'unknown'
  const ms = Date.now() - new Date(ts).getTime()
  if (Number.isNaN(ms)) return 'unknown'
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Run the preflight checks. Best-effort — Supabase missing or query failure
 * returns an empty result so the spec still ships.
 */
export async function preflightCheck(
  taskId: string,
  specMarkdown: string,
): Promise<PreflightResult> {
  const sb = getSupabaseClient()
  if (!sb) {
    return {
      warnings: [],
      priorAttempts: 0,
      identicalRecentFailures: 0,
      recommendation: 'queue',
    }
  }

  const specSha = computeSpecSha(specMarkdown)
  const recentCutoff = new Date(Date.now() - RECENT_WINDOW_HOURS * 3600_000).toISOString()
  const warnings: PreflightWarning[] = []

  // 1. Prior failed verifier_runs for this task_id (any time).
  let priorAttempts = 0
  try {
    const { data } = await sb
      .from('verifier_runs')
      .select('passed, gaps, ran_at, commit_sha')
      .eq('task_id', taskId)
      .eq('passed', false)
      .order('ran_at', { ascending: false })
      .limit(5)
    const rows = (data ?? []) as VerifierRunSlim[]
    priorAttempts = rows.length
    for (const r of rows.slice(0, 3)) {
      const gapSummary = summarizeGaps(r.gaps)
      if (gapSummary.length === 0) continue
      warnings.push({
        kind: 'prior-fail',
        message: `Verifier failed this task ${formatRelative(r.ran_at)} (${r.commit_sha?.slice(0, 8) ?? 'no sha'}) with ${gapSummary.length} gap${gapSummary.length === 1 ? '' : 's'}: ${gapSummary.slice(0, 2).join(' | ')}`,
        evidence: { ran_at: r.ran_at, commit_sha: r.commit_sha, gaps: gapSummary },
      })
    }
  } catch (err) {
    console.warn(
      `[preflight] verifier_runs query failed for ${taskId}:`,
      err instanceof Error ? err.message : err,
    )
  }

  // 2. atlas_build_attempts with same spec_sha that failed/escalated recently.
  let identicalRecentFailures = 0
  try {
    const { data } = await sb
      .from('atlas_build_attempts')
      .select('spec_sha, status, attempt_number, failure_gaps, planned_at')
      .eq('spec_sha', specSha)
      .in('status', ['failed', 'escalated'])
      .gte('planned_at', recentCutoff)
    const rows = (data ?? []) as BuildAttemptSlim[]
    identicalRecentFailures = rows.length
    if (rows.length > 0) {
      warnings.push({
        kind: 'identical-spec-recently-failed',
        message: `An identical spec (sha=${specSha.slice(0, 12)}) failed ${rows.length}× in the last ${RECENT_WINDOW_HOURS}h. Builder is unlikely to do better without a different approach.`,
        evidence: { spec_sha: specSha, occurrences: rows.length, latest: rows[0]?.planned_at },
      })
    }
  } catch (err) {
    console.warn(
      `[preflight] atlas_build_attempts query failed for ${taskId}:`,
      err instanceof Error ? err.message : err,
    )
  }

  const recommendation: PreflightResult['recommendation'] =
    identicalRecentFailures >= HARD_ESCALATE_IDENTICAL_THRESHOLD
      ? 'escalate'
      : warnings.length > 0
        ? 'queue-with-warnings'
        : 'queue'

  return {
    warnings,
    priorAttempts,
    identicalRecentFailures,
    recommendation,
  }
}

/**
 * Render the preflight result as a markdown section to append to the spec.
 * Returns empty string when there are no warnings — caller can safely
 * concatenate without checking.
 */
export function renderPreflightSection(result: PreflightResult): string {
  if (result.warnings.length === 0) return ''
  const lines: string[] = []
  lines.push('')
  lines.push('## Prior-attempt warnings')
  lines.push('')
  lines.push(
    'Atlas detected prior-attempt context for this task before queueing. ' +
      'Address each item explicitly in your implementation; do NOT repeat the ' +
      'same mistake the verifier already flagged.',
  )
  lines.push('')
  for (const w of result.warnings) {
    lines.push(`- **[${w.kind}]** ${w.message}`)
  }
  if (result.recommendation === 'escalate') {
    lines.push('')
    lines.push(
      `> ⚠️ Recommendation: ESCALATE. ${result.identicalRecentFailures} identical-spec failures in the last 24h.`,
    )
  }
  return lines.join('\n')
}
