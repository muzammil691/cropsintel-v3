import { PhaseHeader } from './PhaseHeader'
import { LiveCounters } from './LiveCounters'
import { CostGauges } from './CostGauges'
import { VerifierSpark } from './VerifierSpark'
import { RecentShipsTimeline } from './RecentShipsTimeline'
import type { AtlasStatus, AtlasCosts } from '@/lib/atlas-client'

interface StatusPaneProps {
  status: AtlasStatus | null
  costs: AtlasCosts | null
  loading: boolean
  error: string | null
}

export function StatusPane({ status, costs, loading, error }: StatusPaneProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        Unable to reach Atlas: {error}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] xl:h-[calc(100vh-7rem)] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Live status
        </h2>
        <span className="text-[10px] tabular-nums text-slate-400">
          5s poll
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50/40 dark:bg-slate-900/20">
        <PhaseHeader status={status} loading={loading} />
        <LiveCounters status={status} loading={loading} />
        <CostGauges costs={costs} loading={loading} />
        {(status?.verifier_history?.length ?? 0) > 0 && (
          <VerifierSpark
            history={status!.verifier_history}
            passRate={status!.verifier_pass_rate}
          />
        )}
        <RecentShipsTimeline
          ships={status?.recent_ships ?? []}
          loading={loading && !status}
        />
      </div>
    </div>
  )
}
