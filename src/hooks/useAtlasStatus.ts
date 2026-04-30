import { useState, useEffect, useCallback } from 'react'
import { fetchStatus, fetchCosts, type AtlasStatus, type AtlasCosts } from '@/lib/atlas-client'

export interface AtlasStatusResult {
  status: AtlasStatus | null
  costs: AtlasCosts | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useAtlasStatus(pollIntervalMs = 5000): AtlasStatusResult {
  const [status, setStatus] = useState<AtlasStatus | null>(null)
  const [costs, setCosts] = useState<AtlasCosts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchStatus(), fetchCosts()])
      setStatus(s)
      setCosts(c)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, pollIntervalMs)
    return () => clearInterval(id)
  }, [load, pollIntervalMs])

  return { status, costs, loading, error, refresh: load }
}
