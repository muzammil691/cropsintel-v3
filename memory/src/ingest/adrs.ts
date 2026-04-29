import { getSupabaseClient } from '../lib/supabase'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

export async function ingestAdrs(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'adrs' as const

  let sb
  try {
    sb = getSupabaseClient()
  } catch {
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: ['Supabase not configured'] }
  }

  // Try architecture_decisions table (may not exist yet if phase 2 hasn't run)
  const { data, error } = await sb
    .from('architecture_decisions')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    const msg = `architecture_decisions table not yet available: ${error.message}`
    console.warn(`[adrs] ${msg}`)
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: [msg] }
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) {
    console.log('[adrs] No ADRs found yet')
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: [] }
  }

  console.log(`[adrs] Found ${rows.length} ADRs`)

  const rawChunks: RawChunk[] = rows.map((row, idx) => {
    const title = String(row.title ?? row.name ?? `ADR-${idx}`)
    const body = formatAdr(row)
    return {
      source,
      source_path: `adr-${String(row.id ?? idx)}`,
      source_section: title,
      content: body,
      chunk_index: 0,
      metadata: {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        decision_made_by: row.decision_made_by,
      },
    }
  })

  const { inserted, skipped, costUsd } = await embedAndStore(rawChunks)

  const result: IngestResult = {
    source,
    chunksAdded: inserted,
    chunksSkipped: skipped,
    costUsd,
    durationMs: Date.now() - start,
    errors: [],
  }

  await writeMemoryRun({
    operation: 'ingest',
    source,
    chunks_added: inserted,
    chunks_skipped: skipped,
    cost_usd: costUsd,
    duration_ms: result.durationMs,
  })

  console.log(`[adrs] Done: +${inserted} chunks, $${costUsd.toFixed(4)}`)
  return result
}

function formatAdr(row: Record<string, unknown>): string {
  const lines: string[] = []

  const title = String(row.title ?? row.name ?? 'Untitled ADR')
  lines.push(`# ADR: ${title}`)

  if (row.status) lines.push(`**Status:** ${row.status}`)
  if (row.created_at) lines.push(`**Date:** ${row.created_at}`)
  if (row.decision_made_by) lines.push(`**Decision by:** ${row.decision_made_by}`)

  if (row.context || row.problem) {
    lines.push(`\n## Context\n${row.context ?? row.problem}`)
  }
  if (row.decision || row.content || row.body) {
    lines.push(`\n## Decision\n${row.decision ?? row.content ?? row.body}`)
  }
  if (row.consequences || row.rationale) {
    lines.push(`\n## Consequences\n${row.consequences ?? row.rationale}`)
  }

  return lines.join('\n')
}
