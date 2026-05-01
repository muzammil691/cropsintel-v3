// Phase 1.10ab — useBrainNodes
//
// Loads brain_nodes with optional filter/search; subscribes to realtime updates
// so a Multi-Brain debate's score change reconciles into the list rail.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listBrainNodes, type BrainNode } from '@/lib/brain-client'
import { supabase } from '@/lib/supabase'

export interface UseBrainNodesResult {
  nodes: BrainNode[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setSearch: (s: string) => void
  setCategory: (c: string | null) => void
  search: string
  category: string | null
  categories: string[]
}

export function useBrainNodes(): UseBrainNodesResult {
  const [nodes, setNodes] = useState<BrainNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listBrainNodes()
      setNodes(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Realtime: reconcile single-row updates without a full refetch.
  useEffect(() => {
    const channel = supabase
      .channel('brain-nodes-list')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'brain_nodes' }, (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        setNodes((prev) => {
          if (payload.eventType === 'INSERT') {
            const next = [...prev, normalize(payload.new)]
            next.sort((a, b) => a.label.localeCompare(b.label))
            return next
          }
          if (payload.eventType === 'UPDATE') {
            return prev.map((n) => (n.id === String(payload.new.id) ? normalize(payload.new) : n))
          }
          if (payload.eventType === 'DELETE') {
            return prev.filter((n) => n.id !== String(payload.old.id))
          }
          return prev
        })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return nodes.filter((n) => {
      if (category && n.category !== category) return false
      if (!s) return true
      return (
        n.label.toLowerCase().includes(s) ||
        n.node_key.toLowerCase().includes(s) ||
        (n.description ?? '').toLowerCase().includes(s)
      )
    })
  }, [nodes, search, category])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const n of nodes) if (n.category) set.add(n.category)
    return Array.from(set).sort()
  }, [nodes])

  return {
    nodes: filtered,
    loading,
    error,
    refresh,
    setSearch,
    setCategory,
    search,
    category,
    categories,
  }
}

function normalize(row: Record<string, unknown>): BrainNode {
  return {
    id: String(row.id),
    node_key: String(row.node_key),
    label: String(row.label),
    description: (row.description as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    status: (row.status as 'active' | 'paused' | 'archived') ?? 'active',
    score: Number(row.score ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}
