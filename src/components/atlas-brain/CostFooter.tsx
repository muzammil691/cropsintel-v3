// Phase 1.10ab — CostFooter
//
// Today / Month / Cap meter with last-debate spotlight. Mirrors the existing
// Atlas CostMeter visual language for consistency.

import type { BrainCostSummary } from '@/lib/brain-client'
import { cn } from '@/lib/utils'

export interface CostFooterProps {
  costs: BrainCostSummary | null
  loading?: boolean
}

function fmt(n: number) {
  return n.toFixed(2)
}

export function CostFooter({ costs, loading }: CostFooterProps) {
  const budget = costs?.budget ?? 400
  const today = costs?.today ?? 0
  const month = costs?.month_to_date ?? 0
  const lastDebate = costs?.last_debate ?? null
  const pct = Math.min(100, (month / budget) * 100)
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'

  if (loading && !costs) {
    return (
      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3 text-xs text-slate-500">
        <span className="h-2 w-32 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
    )
  }

  return (
    <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-3 tabular-nums">
          <span>
            Today <span className="text-slate-800 dark:text-slate-200 font-medium">${fmt(today)}</span>
          </span>
          <span>
            Month <span className="text-slate-800 dark:text-slate-200 font-medium">${fmt(month)}</span> / ${fmt(budget)}
          </span>
          {lastDebate != null && (
            <span>
              Last debate <span className="text-slate-800 dark:text-slate-200 font-medium">${lastDebate.toFixed(4)}</span>
            </span>
          )}
        </div>
        <span className="text-[10px] tabular-nums">{pct.toFixed(1)}% of cap</span>
      </div>
      <div className="mt-1.5 w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Monthly AI spend vs cap"
        />
      </div>
    </div>
  )
}
