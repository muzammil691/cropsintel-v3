import type { AtlasStatus } from '@/lib/atlas-client'

interface PhaseHeaderProps {
  status: AtlasStatus | null
  loading: boolean
}

export function PhaseHeader({ status, loading }: PhaseHeaderProps) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
        Current phase
      </div>
      {loading && !status ? (
        <div className="h-7 w-20 rounded bg-slate-200 dark:bg-slate-800 animate-pulse mt-1" />
      ) : (
        <div className="text-2xl font-bold tabular-nums tracking-tight mt-0.5 text-emerald-700 dark:text-emerald-400">
          {status?.current_phase ?? '—'}
        </div>
      )}
      {status && (
        <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
          {status.memory_chunk_count.toLocaleString()} memory chunks indexed
        </div>
      )}
    </div>
  )
}
