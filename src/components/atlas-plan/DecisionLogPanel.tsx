// Phase 1.10bb-c Session 4 — Workshop right-rail decision log + open questions.
//
// Live-updating view of THIS session's accumulated decisions and open
// questions per Q3 anti-drift contract. Also exposes a "Pause session"
// button so the user can step away without abandoning the session — the
// session stays `active`, just hidden from the active rail until resumed.

import { Pause, ScrollText, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  WorkshopDecision,
  WorkshopOpenQuestion,
  WorkshopSessionStatus,
} from '@/lib/atlas-client'

interface DecisionLogPanelProps {
  decisions: WorkshopDecision[]
  openQuestions: WorkshopOpenQuestion[]
  status: WorkshopSessionStatus
  /** Show the "Pause session" button (hide on completed/abandoned sessions). */
  onPause?: () => void
  className?: string
}

export function DecisionLogPanel({
  decisions,
  openQuestions,
  status,
  onPause,
  className,
}: DecisionLogPanelProps) {
  const isLive = status === 'active' || status === 'awaiting_approval'

  return (
    <aside
      className={cn(
        'flex flex-col h-full overflow-hidden',
        'bg-amber-50/40 dark:bg-amber-950/10',
        'border-l border-amber-200/60 dark:border-amber-900/40',
        className,
      )}
      aria-label="Decision log"
    >
      <header className="px-3 pt-3 pb-2 border-b border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ScrollText className="size-3.5 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 truncate">
            Decision log
          </h3>
        </div>
        {isLive && onPause && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onPause}
            className="h-6 px-1.5 text-[10px]"
            title="Pause this session — stays active, returns later"
            aria-label="Pause session"
          >
            <Pause className="size-3" aria-hidden />
            <span className="ml-1">Pause</span>
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Decisions ({decisions.length})
          </h4>
          {decisions.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic">
              No decisions ratified yet — Atlas asks, you answer, the conversation distills the answers into decisions over time.
            </p>
          ) : (
            <ul className="space-y-2">
              {decisions
                .slice()
                .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
                .map((d, i) => (
                  <li
                    key={`${d.timestamp ?? i}-${d.decided.slice(0, 16)}`}
                    className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      {d.phase_id && (
                        <code className="text-[9px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/60 px-1 py-0.5 rounded">
                          {d.phase_id}
                        </code>
                      )}
                      <span className="text-[9px] text-slate-400 tabular-nums ml-auto">
                        {d.timestamp ? d.timestamp.slice(0, 10) : ''}
                      </span>
                    </div>
                    <p className="text-emerald-900 dark:text-emerald-100 font-medium">
                      <span className="text-emerald-700 dark:text-emerald-400">decided</span>{' '}
                      {d.decided}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                      <span className="text-rose-700 dark:text-rose-400">over</span> {d.over}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                      <span className="text-amber-700 dark:text-amber-400">because</span>{' '}
                      {d.because}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <HelpCircle className="size-3 text-amber-700 dark:text-amber-300" aria-hidden />
            Open questions ({openQuestions.length})
          </h4>
          {openQuestions.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic">
              No open questions — ambiguities raised by Atlas land here so they don&apos;t get auto-resolved.
            </p>
          ) : (
            <ul className="space-y-2">
              {openQuestions
                .slice()
                .sort((a, b) => (b.raised_at ?? '').localeCompare(a.raised_at ?? ''))
                .map((q) => (
                  <li
                    key={q.id}
                    className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      {q.phase_id && (
                        <code className="text-[9px] font-mono text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded">
                          {q.phase_id}
                        </code>
                      )}
                      <span className="text-[9px] text-slate-400 tabular-nums ml-auto">
                        {q.raised_at ? q.raised_at.slice(0, 10) : ''}
                      </span>
                    </div>
                    <p className="text-amber-900 dark:text-amber-100 font-medium leading-snug">
                      {q.question}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                      {q.reason}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}

export default DecisionLogPanel
