// Phase 1.10ab — useBrainHistory
//
// Loads brain_node_history rows for a given node, oldest-first for sparkline.

import { useCallback, useEffect, useState } from 'react'
import { listNodeHistory, type BrainNodeHistoryRow } from '@/lib/brain-client'

export interface UseBrainHistoryResult {
  history: BrainNodeHistoryRow[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useBrainHistory(nodeId: string | null): UseBrainHistoryResult {
  const [history, setHistory] = useState<BrainNodeHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!nodeId) {
      setHistory([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await listNodeHistory(nodeId)
      // returned newest-first; sparkline wants oldest-first
      setHistory([...rows].reverse())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { history, loading, error, refresh }
}
