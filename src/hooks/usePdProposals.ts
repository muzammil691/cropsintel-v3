// Phase 1.10ac — usePdProposals
//
// Loads pd_proposals (optionally filtered by status) with refresh + realtime
// reconciliation. Pattern mirrors useBrainNodes.

import { useCallback, useEffect, useState } from 'react'
import { listProposals, type PdProposal, type PdProposalStatus } from '@/lib/pd-client'
import { supabase } from '@/lib/supabase'

export interface UsePdProposalsResult {
  proposals: PdProposal[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function usePdProposals(filter?: { status?: PdProposalStatus }): UsePdProposalsResult {
  const [proposals, setProposals] = useState<PdProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const status = filter?.status

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listProposals(status ? { status } : undefined)
      setProposals(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('pd-proposals-list')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'pd_proposals' }, () => {
        void refresh()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  return { proposals, loading, error, refresh }
}
