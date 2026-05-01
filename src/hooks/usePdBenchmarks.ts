// Phase 1.10ac — usePdBenchmarks
//
// Loads pd_benchmarks samples and groups them by metric_key for the
// Benchmarks tab's per-metric sparklines.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listBenchmarks, type PdBenchmark } from '@/lib/pd-client'

export interface MetricSeries {
  metric_key: string
  samples: PdBenchmark[]   // chronological ascending
  latest: number | null
  delta: number | null     // latest minus prior
}

export interface UsePdBenchmarksResult {
  series: MetricSeries[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function usePdBenchmarks(): UsePdBenchmarksResult {
  const [rows, setRows] = useState<PdBenchmark[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listBenchmarks(undefined, 200)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const series = useMemo<MetricSeries[]>(() => {
    const grouped = new Map<string, PdBenchmark[]>()
    for (const r of rows) {
      const arr = grouped.get(r.metric_key) ?? []
      arr.push(r)
      grouped.set(r.metric_key, arr)
    }
    const out: MetricSeries[] = []
    for (const [metric_key, samples] of grouped) {
      const ascending = [...samples].sort((a, b) => a.observed_at.localeCompare(b.observed_at))
      const latest = ascending.length > 0 ? ascending[ascending.length - 1].value : null
      const prior = ascending.length > 1 ? ascending[ascending.length - 2].value : null
      const delta = latest != null && prior != null ? latest - prior : null
      out.push({ metric_key, samples: ascending, latest, delta })
    }
    out.sort((a, b) => a.metric_key.localeCompare(b.metric_key))
    return out
  }, [rows])

  return { series, loading, error, refresh }
}
