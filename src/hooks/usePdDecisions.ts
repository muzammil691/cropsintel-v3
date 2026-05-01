// Phase 1.10ac — usePdDecisions
//
// Loads pd_decisions with optional filters. Decisions are append-only —
// realtime reconciliation just refetches on INSERT.

import { useCallback, useEffect, useState } from 'react'
import { listAllDecisions, type PdDecision, type PdDecisionVerdict } from '@/lib/pd-client'
import { supabase } from '@/lib/supabase'

export interface UsePdDecisionsFilters {
  verdict?: PdDecisionVerdict
  fromDate?: string
  toDate?: string
}

export interface UsePdDecisionsResult {
  decisions: PdDecision[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function usePdDecisions(filters?: UsePdDecisionsFilters): UsePdDecisionsResult {
  const [decisions, setDecisions] = useState<PdDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const verdict = filters?.verdict
  const fromDate = filters?.fromDate
  const toDate = filters?.toDate

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listAllDecisions({ verdict, fromDate, toDate })
      setDecisions(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [verdict, fromDate, toDate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('pd-decisions-list')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'pd_decisions' }, () => {
        void refresh()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  return { decisions, loading, error, refresh }
}
