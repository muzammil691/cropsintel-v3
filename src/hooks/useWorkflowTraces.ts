import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface WorkflowTrace {
  task_id: string
  sha: string
  shipped_at: string
  verifier_verdict: 'pass' | 'fail' | null
  verifier_confidence: number | null
  verifier_gaps: Array<{ check?: string; severity?: string; description?: string }> | null
  designer_verdict: 'pass' | 'fail' | 'unknown' | null
  designer_confidence: number | null
  designer_ran_at: string | null
  memory_ingested_at: string | null
  memory_chunks_added: number | null
  atlas_observed_at: string | null
}

export interface UseWorkflowTracesResult {
  traces: WorkflowTrace[]
  loading: boolean
  error: string | null
  refresh: () => void
}

interface RawRow {
  task_id?: string
  sha?: string
  shipped_at?: string
  verifier_verdict?: string
  verifier_confidence?: number | string
  verifier_gaps?: unknown
  designer_verdict?: string | null
  designer_confidence?: number | string | null
  designer_ran_at?: string | null
  memory_ingested_at?: string | null
  memory_chunks_added?: number | null
  atlas_observed_at?: string | null
}

function normalize(row: RawRow): WorkflowTrace {
  return {
    task_id: row.task_id ?? 'unknown',
    sha: row.sha ?? '',
    shipped_at: row.shipped_at ?? '',
    verifier_verdict: (row.verifier_verdict as WorkflowTrace['verifier_verdict']) ?? null,
    verifier_confidence: row.verifier_confidence != null ? Number(row.verifier_confidence) : null,
    verifier_gaps: Array.isArray(row.verifier_gaps)
      ? (row.verifier_gaps as WorkflowTrace['verifier_gaps'])
      : null,
    designer_verdict: (row.designer_verdict as WorkflowTrace['designer_verdict']) ?? null,
    designer_confidence: row.designer_confidence != null ? Number(row.designer_confidence) : null,
    designer_ran_at: row.designer_ran_at ?? null,
    memory_ingested_at: row.memory_ingested_at ?? null,
    memory_chunks_added: row.memory_chunks_added ?? null,
    atlas_observed_at: row.atlas_observed_at ?? null,
  }
}

export function useWorkflowTraces(pollIntervalMs = 30000, limit = 10): UseWorkflowTracesResult {
  const [traces, setTraces] = useState<WorkflowTrace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      // The view is created in migration 20260501080000_atlas_workflow_trace_view.sql
      // Cast through unknown because the view isn't in database.types.ts (auto-gen would
      // pick it up on next supabase gen-types run; until then we type-erase here).
      const { data, error: err } = await (supabase
        .from('atlas_workflow_trace' as never)
        .select('*')
        .order('shipped_at', { ascending: false })
        .limit(limit) as unknown as Promise<{ data: RawRow[] | null; error: { message: string } | null }>)
      if (err) {
        setError(err.message)
      } else {
        setTraces((data ?? []).map(normalize))
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    load()
    const id = setInterval(load, pollIntervalMs)
    return () => clearInterval(id)
  }, [load, pollIntervalMs])

  return { traces, loading, error, refresh: load }
}
