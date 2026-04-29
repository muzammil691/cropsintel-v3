import { getSupabaseClient } from './supabase'
import { MemoryRun } from '../types'

export async function writeMemoryRun(run: MemoryRun): Promise<void> {
  try {
    const sb = getSupabaseClient()
    await sb.from('memory_runs').insert({
      operation: run.operation,
      source: run.source ?? null,
      chunks_added: run.chunks_added ?? 0,
      chunks_skipped: run.chunks_skipped ?? 0,
      chunks_searched: run.chunks_searched ?? 0,
      query: run.query ?? null,
      invoked_by: run.invoked_by ?? 'memory-agent',
      duration_ms: run.duration_ms ?? null,
      cost_usd: run.cost_usd ?? 0,
      metadata: run.metadata ?? {},
    })
  } catch (err) {
    // Audit failures must never crash the main operation
    console.error('[audit] Failed to write memory_run:', err)
  }
}
