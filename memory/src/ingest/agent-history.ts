// Phase 1.10az (audit C1a) — ingest verifier_runs + designer_runs as searchable
// memory chunks so spec-draft (and future Council/Builder context injection)
// can retrieve "what failed before on this scope" before generating new code.
//
// Why: the audit found Memory only ingested static docs (master-plan, audits,
// codebases) plus git history — never the structured failure log. As a result
// every new build started cold, repeating the same gaps. This source closes
// the learning loop end-to-end:
//
//   verifier_runs / designer_runs  →  agent-history chunks  →  memory.search
//                                                              →  spec-draft (C1b)
//
// We pull the most recent N failed runs (passed=false OR passed IS NULL for
// verifier; verdict='fail' for designer), serialize each into a stable text
// blob, and embedAndStore them. embedAndStore dedupes on
// (source, source_path, chunk_index) so re-running this ingest is idempotent.

import { getSupabaseClient } from '../lib/supabase'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

const VERIFIER_LIMIT = 200
const DESIGNER_LIMIT = 200

interface VerifierRow {
  task_id: string | null
  commit_sha: string | null
  mode: string | null
  passed: boolean | null
  unknown_reason: string | null
  gaps: unknown
  duration_ms: number | null
  created_at: string | null
}

interface DesignerRow {
  task_id: string | null
  operation: string | null
  head_before: string | null
  head_after: string | null
  verdict: string | null
  gaps: unknown
  rationale: string | null
  created_at: string | null
}

interface DesignerGap {
  check?: unknown
  severity?: unknown
  actual?: unknown
  remediation?: unknown
  file?: unknown
}

function shortSha(sha: string | null): string {
  return (sha ?? 'unknown').slice(0, 12)
}

function asGapList(raw: unknown): DesignerGap[] {
  return Array.isArray(raw) ? (raw as DesignerGap[]) : []
}

function renderVerifierRow(r: VerifierRow): string {
  const lines: string[] = []
  lines.push(`[verifier_runs failure]`)
  lines.push(`task_id: ${r.task_id ?? 'unknown'}`)
  lines.push(`commit_sha: ${shortSha(r.commit_sha)}`)
  lines.push(`mode: ${r.mode ?? 'unknown'}`)
  lines.push(`passed: ${r.passed === null ? 'null (unknown)' : String(r.passed)}`)
  if (r.unknown_reason) lines.push(`unknown_reason: ${r.unknown_reason}`)
  if (r.created_at) lines.push(`when: ${r.created_at}`)
  const gaps = asGapList(r.gaps)
  if (gaps.length > 0) {
    lines.push(`gaps:`)
    for (const g of gaps) {
      const check = String(g.check ?? '?')
      const sev = String(g.severity ?? '?')
      const actual = String(g.actual ?? '').slice(0, 200)
      const fix = String(g.remediation ?? '').slice(0, 200)
      lines.push(`  - check=${check} severity=${sev}`)
      if (actual) lines.push(`    actual: ${actual}`)
      if (fix) lines.push(`    remediation: ${fix}`)
    }
  }
  return lines.join('\n')
}

function renderDesignerRow(r: DesignerRow): string {
  const lines: string[] = []
  lines.push(`[designer_runs failure]`)
  lines.push(`task_id: ${r.task_id ?? 'unknown'}`)
  lines.push(`operation: ${r.operation ?? 'unknown'}`)
  if (r.head_after) lines.push(`commit_sha: ${shortSha(r.head_after)}`)
  lines.push(`verdict: ${r.verdict ?? 'unknown'}`)
  if (r.created_at) lines.push(`when: ${r.created_at}`)
  if (r.rationale) lines.push(`rationale: ${r.rationale.slice(0, 400)}`)
  const gaps = asGapList(r.gaps)
  if (gaps.length > 0) {
    lines.push(`gaps:`)
    for (const g of gaps) {
      const check = String(g.check ?? '?')
      const sev = String(g.severity ?? '?')
      const file = String(g.file ?? '')
      const actual = String(g.actual ?? '').slice(0, 200)
      const fix = String(g.remediation ?? '').slice(0, 200)
      lines.push(`  - check=${check} severity=${sev}${file ? ` file=${file}` : ''}`)
      if (actual) lines.push(`    actual: ${actual}`)
      if (fix) lines.push(`    remediation: ${fix}`)
    }
  }
  return lines.join('\n')
}

export async function ingestAgentHistory(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'agent-history' as const
  const errors: string[] = []
  let totalInserted = 0
  let totalSkipped = 0
  let totalCost = 0

  const sb = getSupabaseClient()

  // ─── Verifier runs (failed + unknown) ──────────────────────────────────────
  const { data: verifierRows, error: vErr } = await sb
    .from('verifier_runs')
    .select('task_id, commit_sha, mode, passed, unknown_reason, gaps, duration_ms, created_at')
    .or('passed.eq.false,passed.is.null')
    .order('created_at', { ascending: false })
    .limit(VERIFIER_LIMIT)

  if (vErr) {
    errors.push(`verifier_runs query failed: ${vErr.message}`)
  } else if (verifierRows && verifierRows.length > 0) {
    const chunks: RawChunk[] = verifierRows.map((row, idx) => {
      const r = row as VerifierRow
      return {
        source,
        source_path: `verifier/${r.task_id ?? 'unknown'}@${shortSha(r.commit_sha)}`,
        source_section: r.passed === null ? `unknown:${r.unknown_reason ?? 'unspecified'}` : 'failed',
        content: renderVerifierRow(r),
        chunk_index: idx,
        metadata: {
          kind: 'verifier_run',
          task_id: r.task_id,
          commit_sha: r.commit_sha,
          passed: r.passed,
          unknown_reason: r.unknown_reason,
        },
      }
    })
    const { inserted, skipped, costUsd } = await embedAndStore(chunks)
    totalInserted += inserted
    totalSkipped += skipped
    totalCost += costUsd
    console.log(`[agent-history] verifier_runs: +${inserted}, skipped ${skipped}, $${costUsd.toFixed(4)}`)
  }

  // ─── Designer runs (failed) ────────────────────────────────────────────────
  const { data: designerRows, error: dErr } = await sb
    .from('designer_runs')
    .select('task_id, operation, head_before, head_after, verdict, gaps, rationale, created_at')
    .eq('verdict', 'fail')
    .order('created_at', { ascending: false })
    .limit(DESIGNER_LIMIT)

  if (dErr) {
    errors.push(`designer_runs query failed: ${dErr.message}`)
  } else if (designerRows && designerRows.length > 0) {
    const chunks: RawChunk[] = designerRows.map((row, idx) => {
      const r = row as DesignerRow
      return {
        source,
        source_path: `designer/${r.task_id ?? 'unknown'}@${shortSha(r.head_after)}`,
        source_section: r.operation ?? 'unknown',
        content: renderDesignerRow(r),
        chunk_index: VERIFIER_LIMIT + idx, // namespace away from verifier indices
        metadata: {
          kind: 'designer_run',
          task_id: r.task_id,
          operation: r.operation,
          head_after: r.head_after,
          verdict: r.verdict,
        },
      }
    })
    const { inserted, skipped, costUsd } = await embedAndStore(chunks)
    totalInserted += inserted
    totalSkipped += skipped
    totalCost += costUsd
    console.log(`[agent-history] designer_runs: +${inserted}, skipped ${skipped}, $${costUsd.toFixed(4)}`)
  }

  const result: IngestResult = {
    source,
    chunksAdded: totalInserted,
    chunksSkipped: totalSkipped,
    costUsd: totalCost,
    durationMs: Date.now() - start,
    errors,
  }

  await writeMemoryRun({
    operation: 'ingest',
    source,
    chunks_added: totalInserted,
    chunks_skipped: totalSkipped,
    cost_usd: totalCost,
    duration_ms: result.durationMs,
  })

  console.log(`[agent-history] Done: +${totalInserted} chunks, $${totalCost.toFixed(4)}`)
  return result
}
