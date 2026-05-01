import type { AtlasStatus } from '@/lib/atlas-client'

interface LiveCountersProps {
  status: AtlasStatus | null
  loading: boolean
}

interface CounterProps {
  label: string
  value: number | string
  accent?: 'normal' | 'warn' | 'danger' | 'good'
}

function Counter({ label, value, accent = 'normal' }: CounterProps) {
  const valueColor =
    accent === 'danger' ? 'text-red-600 dark:text-red-400'
      : accent === 'warn' ? 'text-amber-600 dark:text-amber-400'
      : accent === 'good' ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-slate-900 dark:text-slate-100'
  return (
    <div className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular-nums leading-tight ${valueColor}`}>{value}</div>
    </div>
  )
}

export function LiveCounters({ status, loading }: LiveCountersProps) {
  const placeholder = loading && !status ? '…' : null
  const queued = placeholder ?? (status?.queued ?? 0)
  const inFlight = placeholder ?? (status?.in_flight ?? 0)
  const done = placeholder ?? (status?.done_24h ?? 0)
  const failed = placeholder ?? (status?.failed_24h ?? 0)
  const failedAccent = status && status.failed_24h > 0 ? 'danger' : 'normal'
  const inFlightAccent = status && status.in_flight > 3 ? 'warn' : 'normal'

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Counter label="Queue" value={queued} />
      <Counter label="In-flight" value={inFlight} accent={inFlightAccent} />
      <Counter label="Done 24h" value={done} accent="good" />
      <Counter label="Failed 24h" value={failed} accent={failedAccent} />
    </div>
  )
}
