// Phase 1.10ac — BenchmarksTab
//
// Per-metric sparkline + latest value + delta-vs-prior (Tufte/Datadog/Linear
// pattern from the research doc). Static list of seeded metrics for now;
// cron-fed updates land in later phases.

import { Loader2, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { usePdBenchmarks, type MetricSeries } from '@/hooks/usePdBenchmarks'
import { cn } from '@/lib/utils'

const METRIC_LABELS: Record<string, string> = {
  specs_shipped_per_day: 'Specs shipped / day',
  verifier_pass_rate: 'Verifier pass rate',
  cost_today: 'Cost today (USD)',
}

export function BenchmarksTab() {
  const { series, loading, error } = usePdBenchmarks()

  return (
    <div className="px-4 py-5 max-w-4xl mx-auto">
      <h2 className="text-base font-semibold mb-1">Benchmarks</h2>
      <p className="text-xs text-slate-500 mb-4">
        KPIs that track build velocity, quality, and cost.
      </p>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading benchmarks…
        </div>
      ) : series.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No benchmarks recorded yet.</p>
      ) : (
        <ul className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {series.map((s) => <Row key={s.metric_key} series={s} />)}
        </ul>
      )}
    </div>
  )
}

function Row({ series }: { series: MetricSeries }) {
  const label = METRIC_LABELS[series.metric_key] ?? series.metric_key
  const data = series.samples.map((s, i) => ({ x: i, y: s.value }))
  const latest = series.latest
  const delta = series.delta
  const deltaIcon = delta == null ? Minus : delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus
  const DeltaIcon = deltaIcon
  const deltaColor = delta == null ? 'text-slate-400'
    : delta > 0 ? 'text-emerald-600 dark:text-emerald-400'
    : delta < 0 ? 'text-red-600 dark:text-red-400'
    : 'text-slate-500'

  return (
    <li className="grid grid-cols-12 items-center gap-3 px-3 py-3">
      <div className="col-span-5 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-[10px] text-slate-500 truncate">{series.metric_key} · {series.samples.length} sample{series.samples.length === 1 ? '' : 's'}</p>
      </div>
      <div className="col-span-4 h-10">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line
                type="monotone"
                dataKey="y"
                stroke="currentColor"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                className="text-emerald-600 dark:text-emerald-400"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[10px] text-slate-400 text-center">{data.length === 0 ? 'no data' : 'single sample'}</p>
        )}
      </div>
      <div className="col-span-3 text-right">
        <p className="text-sm font-semibold tabular-nums">{latest == null ? '—' : formatValue(series.metric_key, latest)}</p>
        <p className={cn('text-[10px] tabular-nums flex items-center justify-end gap-0.5', deltaColor)}>
          <DeltaIcon className="size-3" aria-hidden />
          {delta == null ? 'no prior' : formatDelta(delta)}
        </p>
      </div>
    </li>
  )
}

function formatValue(key: string, v: number): string {
  if (key === 'verifier_pass_rate') return `${(v * 100).toFixed(0)}%`
  if (key === 'cost_today') return `$${v.toFixed(2)}`
  return v.toFixed(v >= 10 ? 0 : 1)
}

function formatDelta(d: number): string {
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(Math.abs(d) >= 10 ? 0 : 2)}`
}
