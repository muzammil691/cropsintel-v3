// Phase 1.10bb-c Session 4 — Workshop left-rail session list.
//
// Lists prior + active workshop sessions with status pills and a primary
// "Start new workshop" button at top. Selection is controlled by the
// parent (PlanWorkshop) via `selectedSessionId` + `onSelect`.

import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  listWorkshopSessions,
  type WorkshopSessionSummary,
  type WorkshopSessionStatus,
} from '@/lib/atlas-client'

interface WorkshopSessionListProps {
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
  onStartNew: () => void
  /** Refresh tick — bump from parent to force a reload (e.g. after a session
   *  status changes via approve/reject in PlanDiffPreview). */
  refreshKey?: number
  className?: string
}

const STATUS_PILL: Record<WorkshopSessionStatus, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-800',
  },
  awaiting_approval: {
    label: 'Awaiting approval',
    className: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950/60 dark:text-yellow-200 border border-yellow-400 dark:border-yellow-700',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800',
  },
  abandoned: {
    label: 'Abandoned',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400 border border-slate-300 dark:border-slate-700',
  },
}

export function WorkshopSessionList({
  selectedSessionId,
  onSelect,
  onStartNew,
  refreshKey,
  className,
}: WorkshopSessionListProps) {
  const [sessions, setSessions] = useState<WorkshopSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listWorkshopSessions()
      .then((r) => {
        if (cancelled) return
        setSessions(r.sessions ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // Group: active/awaiting_approval first, then completed, then abandoned.
  const grouped = useMemo(() => {
    const order: WorkshopSessionStatus[] = ['active', 'awaiting_approval', 'completed', 'abandoned']
    const out: Array<[WorkshopSessionStatus, WorkshopSessionSummary[]]> = []
    for (const status of order) {
      const list = sessions.filter((s) => s.status === status)
      if (list.length > 0) out.push([status, list])
    }
    return out
  }, [sessions])

  return (
    <aside
      className={cn(
        'flex flex-col gap-3 h-full overflow-hidden',
        'bg-amber-50/40 dark:bg-amber-950/10',
        'border-r border-amber-200/60 dark:border-amber-900/40',
        className,
      )}
      aria-label="Workshop sessions"
    >
      <header className="px-2 sm:px-3 pt-3 pb-2 border-b border-amber-200/60 dark:border-amber-900/40">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="size-3.5 text-amber-700 dark:text-amber-300" aria-hidden />
          <h3 className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
            Workshop sessions
          </h3>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onStartNew}
          className="w-full bg-amber-700 hover:bg-amber-800 text-white text-xs h-8 transition-colors duration-200"
        >
          <Plus className="size-3.5 mr-1" aria-hidden />
          Start new workshop
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-2">
            <RefreshCw className="size-3 animate-spin" aria-hidden />
            Loading sessions…
          </div>
        )}
        {error && !loading && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <p className="text-[11px] text-slate-500 italic px-2 py-3 leading-relaxed">
            No workshops yet. Start one to refine the plan.
          </p>
        )}
        {!loading && grouped.map(([status, list]) => (
          <section key={status} className="space-y-1">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
              {STATUS_PILL[status].label}{' '}
              <span className="tabular-nums">({list.length})</span>
            </h4>
            <ul className="space-y-1">
              {list.map((s) => {
                const isSelected = s.id === selectedSessionId
                const startedDate = s.started_at ? new Date(s.started_at).toLocaleDateString() : ''
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        'w-full text-left rounded-md px-2 py-1.5 text-[10px] sm:text-[11px] min-h-[44px] sm:min-h-0 transition-colors duration-150',
                        'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50',
                        isSelected
                          ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-100'
                          : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-800 text-slate-700 dark:text-slate-200',
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                          className={cn(
                            'inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded',
                            STATUS_PILL[s.status].className,
                          )}
                        >
                          {STATUS_PILL[s.status].label}
                        </span>
                        <span className="text-slate-400 ml-auto tabular-nums">{startedDate}</span>
                      </div>
                      <div className="truncate font-mono text-[10px] text-slate-500">
                        {s.id.slice(0, 8)}…
                      </div>
                      <div className="text-slate-500 mt-0.5">
                        {s.total_turns} turn{s.total_turns === 1 ? '' : 's'}
                        {s.total_cost_usd > 0 && (
                          <>
                            {' · '}
                            <span className="tabular-nums">${s.total_cost_usd.toFixed(2)}</span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}

export default WorkshopSessionList
