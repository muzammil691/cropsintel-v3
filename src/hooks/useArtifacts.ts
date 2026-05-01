import { useCallback, useEffect, useState } from 'react'
import {
  decideFork,
  fetchDesignAudits,
  fetchOpenForks,
  fetchPendingSpecs,
  type DesignAudit,
  type OpenFork,
  type PendingSpec,
} from '@/lib/atlas-client'

export interface UseArtifactsResult {
  pendingSpecs: PendingSpec[]
  designAudits: DesignAudit[]
  openForks: OpenFork[]
  loading: boolean
  error: string | null
  refresh: () => void
  resolveFork: (id: string, chosen: string, rationale?: string) => Promise<void>
  // Optimistic remove for client-side dismiss after a successful action
  dismissSpec: (id: string) => void
  dismissAudit: (id: string) => void
}

// Polls the artifact endpoints. Failures fall back to empty arrays so the
// pane never blocks the conversation column.
export function useArtifacts(pollIntervalMs = 15000): UseArtifactsResult {
  const [pendingSpecs, setPendingSpecs] = useState<PendingSpec[]>([])
  const [designAudits, setDesignAudits] = useState<DesignAudit[]>([])
  const [openForks, setOpenForks] = useState<OpenFork[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [specs, audits, forks] = await Promise.all([
        fetchPendingSpecs().catch(() => []),
        fetchDesignAudits().catch(() => []),
        fetchOpenForks().catch(() => []),
      ])
      setPendingSpecs(specs)
      setDesignAudits(audits)
      setOpenForks(forks)
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

  const resolveFork = useCallback(async (id: string, chosen: string, rationale?: string) => {
    await decideFork(id, chosen, rationale)
    setOpenForks((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const dismissSpec = useCallback((id: string) => {
    setPendingSpecs((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const dismissAudit = useCallback((id: string) => {
    setDesignAudits((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return {
    pendingSpecs,
    designAudits,
    openForks,
    loading,
    error,
    refresh: load,
    resolveFork,
    dismissSpec,
    dismissAudit,
  }
}
