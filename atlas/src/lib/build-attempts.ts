// Phase 2 of the agent-loop redesign — pre-build memory record.
//
// spec-draft inserts a 'planned' row here once the spec markdown is finalized.
// builderQueueSpec flips it to 'queued'. Conductor's existing post-ship hooks
// flip it to 'shipped' when Builder pushes, and Phase 6 adds 'verified' when
// verifierAuditAfterShips writes a passing row.
//
// The agent-history memory ingest reads this table in Phase 6 so completion
// becomes a positive memory trace (today agent-history only records failures).

import { createHash } from 'crypto'
import { getSupabaseClient } from './supabase'

export type PrimaryDomain = 'frontend' | 'analytical' | 'research' | 'mixed'

export type BuildAttemptStatus =
  | 'planned'
  | 'queued'
  | 'shipped'
  | 'verified'
  | 'failed'
  | 'escalated'

export interface RecordBuildAttemptInput {
  taskId: string
  specFilename: string
  specMarkdown: string
  primaryDomain: PrimaryDomain
  multiBrainRunId?: string | null
  priorWarnings?: unknown[]
  costUsd?: number
  attemptNumber?: number
}

export interface RecordedBuildAttempt {
  id: string
  attemptNumber: number
  specSha: string
}

/**
 * Classify the spec by which file paths it touches. Used to tag the build
 * attempt and to enable Phase 4b per-domain Builder routing in a future PR.
 *
 * Heuristic precedence — first match wins:
 *   - frontend:    src/components, src/pages, src/app, *.tsx, *.jsx
 *   - analytical:  atlas/, verifier/, designer/, council/, memory/, supabase/migrations
 *   - research:    docs/MAXONS_Workflow, docs/v3-step*-audit, market intelligence
 *   - mixed:       falls through (touches multiple domains)
 *
 * If both frontend + analytical signals appear in roughly equal volume, we
 * call it mixed — Builder routing in Phase 4b sticks with Claude on mixed
 * specs since splitting one spec across multiple builders is dangerous.
 */
export function classifyPrimaryDomain(markdown: string): PrimaryDomain {
  const md = markdown.toLowerCase()
  let frontend = 0
  let analytical = 0
  let research = 0

  // Count distinct file references per bucket.
  const frontendPatterns = [
    /src\/components\//g,
    /src\/pages\//g,
    /src\/app\//g,
    /\.tsx\b/g,
    /\.jsx\b/g,
    /tailwind|shadcn|aria-label|focus-visible/gi,
  ]
  const analyticalPatterns = [
    /atlas\/src\//g,
    /verifier\/src\//g,
    /designer\/src\//g,
    /council\/src\//g,
    /memory\/src\//g,
    /supabase\/migrations\//g,
    /\.sql\b/g,
  ]
  const researchPatterns = [
    /docs\/maxons_workflow/gi,
    /docs\/v3-step\d-/gi,
    /market intel/gi,
    /\.agent\/master-plan\.md/gi,
  ]

  for (const p of frontendPatterns) frontend += (md.match(p) ?? []).length
  for (const p of analyticalPatterns) analytical += (md.match(p) ?? []).length
  for (const p of researchPatterns) research += (md.match(p) ?? []).length

  // Mixed = top two domains are within 50% of each other AND both >= 2 hits.
  const sorted = [
    { domain: 'frontend' as PrimaryDomain, count: frontend },
    { domain: 'analytical' as PrimaryDomain, count: analytical },
    { domain: 'research' as PrimaryDomain, count: research },
  ].sort((a, b) => b.count - a.count)

  if (sorted[0].count === 0) return 'mixed' // No signal at all
  if (sorted[1].count >= 2 && sorted[1].count / sorted[0].count >= 0.5) return 'mixed'
  return sorted[0].domain
}

export function computeSpecSha(specMarkdown: string): string {
  return createHash('sha256').update(specMarkdown).digest('hex')
}

/**
 * Insert a 'planned' build attempt row. Called from spec-draft once the
 * markdown is finalized but before builderQueueSpec writes to disk.
 *
 * Returns the row's id and attempt_number. The id is later used by
 * builderQueueSpec → markStatus('queued') and the post-ship pipeline.
 *
 * Auto-increments attempt_number for the same task_id by reading the most
 * recent row + 1. Concurrency is fine: two parallel calls would race on the
 * UNIQUE (task_id, attempt_number) constraint and one would retry with N+2.
 * In practice spec-draft is sequential per task, so the race is theoretical.
 */
export async function recordBuildAttempt(
  input: RecordBuildAttemptInput,
): Promise<RecordedBuildAttempt | null> {
  const sb = getSupabaseClient()
  if (!sb) {
    console.warn('[build-attempts] Supabase not configured — skipping plan record')
    return null
  }

  const specSha = computeSpecSha(input.specMarkdown)

  let attemptNumber = input.attemptNumber
  if (attemptNumber === undefined) {
    const { data } = await sb
      .from('atlas_build_attempts')
      .select('attempt_number')
      .eq('task_id', input.taskId)
      .order('attempt_number', { ascending: false })
      .limit(1)
    const latest = (data ?? [])[0] as { attempt_number?: number } | undefined
    attemptNumber = (latest?.attempt_number ?? 0) + 1
  }

  const { data, error } = await sb
    .from('atlas_build_attempts')
    .insert({
      task_id: input.taskId,
      spec_filename: input.specFilename,
      spec_sha: specSha,
      primary_domain: input.primaryDomain,
      status: 'planned',
      multi_brain_run_id: input.multiBrainRunId ?? null,
      prior_warnings: input.priorWarnings ?? [],
      attempt_number: attemptNumber,
      cost_usd: input.costUsd ?? 0,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.warn(
      `[build-attempts] failed to record planned attempt for ${input.taskId}: ${error?.message ?? 'no data returned'}`,
    )
    return null
  }

  return {
    id: data.id as string,
    attemptNumber,
    specSha,
  }
}

/**
 * Update a build attempt's status + the matching timestamp column. Best-effort:
 * a failure here doesn't break the agent loop, just leaves the row stuck in
 * its previous state.
 */
export async function markBuildAttemptStatus(
  attemptId: string,
  status: BuildAttemptStatus,
  extras?: { failureGaps?: unknown },
): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return

  const tsColumn: Partial<Record<BuildAttemptStatus, string>> = {
    queued: 'queued_at',
    shipped: 'shipped_at',
    verified: 'verified_at',
  }

  const update: Record<string, unknown> = { status }
  const tsCol = tsColumn[status]
  if (tsCol) update[tsCol] = new Date().toISOString()
  if (status === 'verified') update.completed_at = new Date().toISOString()
  if (extras?.failureGaps !== undefined) update.failure_gaps = extras.failureGaps

  const { error } = await sb
    .from('atlas_build_attempts')
    .update(update)
    .eq('id', attemptId)

  if (error) {
    console.warn(
      `[build-attempts] failed to mark ${attemptId} as ${status}: ${error.message}`,
    )
  }
}
