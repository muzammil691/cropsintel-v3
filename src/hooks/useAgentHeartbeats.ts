// Phase 1.10ax — useAgentHeartbeats
//
// Subscribes to atlas_agent_heartbeats via Supabase Realtime so the cockpit's
// in-flight chip + workflow pipeline + Agents tab update within ~1s of a
// Builder push, not at the conductor's 5-min poll cadence.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAgentHeartbeats, type AgentHeartbeat } from '@/lib/atlas-client'

export interface UseAgentHeartbeatsResult {
  heartbeats: Record<string, AgentHeartbeat>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useAgentHeartbeats(): UseAgentHeartbeatsResult {
  const [heartbeats, setHeartbeats] = useState<Record<string, AgentHeartbeat>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchAgentHeartbeats()
      setHeartbeats(prev => {
        const next: Record<string, AgentHeartbeat> = { ...prev }
        for (const h of rows) next[h.agent] = h
        return next
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('atlas-agent-heartbeats')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'atlas_agent_heartbeats' }, (payload: { eventType: string; new: AgentHeartbeat; old: { agent?: string } }) => {
        setHeartbeats(prev => {
          if (payload.eventType === 'DELETE') {
            const next = { ...prev }
            const agent = payload.old.agent
            if (agent) delete next[agent]
            return next
          }
          if (payload.new && payload.new.agent) {
            return { ...prev, [payload.new.agent]: payload.new }
          }
          return prev
        })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  // Wall-clock tick so "stale" / "unreachable" thresholds re-evaluate without
  // a server round-trip. 30s cadence is enough for the 60s-stale threshold.
  useEffect(() => {
    const id = window.setInterval(() => {
      setHeartbeats(prev => ({ ...prev }))
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  return { heartbeats, loading, error, refresh }
}

export type DerivedAgentStatus = 'running' | 'idle' | 'stale' | 'unreachable' | 'unknown'

export function deriveAgentStatus(h: AgentHeartbeat | undefined): DerivedAgentStatus {
  if (!h) return 'unknown'
  const ageMs = Date.now() - new Date(h.updated_at).getTime()
  if (h.state === 'unreachable') return 'unreachable'
  if (ageMs > 30 * 60 * 1000) return 'unreachable'
  if (h.state === 'running' || h.state === 'shipping' || h.state === 'verifying' || h.state === 'starting') {
    return 'running'
  }
  if (ageMs > 5 * 60 * 1000) return 'stale'
  return 'idle'
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${ss.toString().padStart(2, '0')}`
}
