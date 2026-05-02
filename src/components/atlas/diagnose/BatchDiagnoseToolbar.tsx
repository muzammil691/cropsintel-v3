import { cn } from '@/lib/utils'

interface BatchDiagnoseToolbarProps {
  total: number
  selected: number
  failedCount: number
  onSelectAll: () => void
  onSelectFailed: () => void
  onClearSelection: () => void
  onDiagnoseAll: () => void
  onDiscussAll: () => void
  onCopyCcPrompt: () => void
  onDismissAll: () => void
  busy?: boolean
  estCostUsd?: number
}

const BTN =
  'inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50'

export function BatchDiagnoseToolbar({
  total,
  selected,
  failedCount,
  onSelectAll,
  onSelectFailed,
  onClearSelection,
  onDiagnoseAll,
  onDiscussAll,
  onCopyCcPrompt,
  onDismissAll,
  busy,
  estCostUsd,
}: BatchDiagnoseToolbarProps) {
  const hasSelection = selected > 0
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 text-[11px] space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-slate-500 dark:text-slate-400 mr-1">
          {hasSelection ? (
            <span className="font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
              {selected} selected
            </span>
          ) : (
            <>Select rows to enable batch actions ({total} total)</>
          )}
        </span>
        <button type="button" onClick={onSelectAll} className={BTN} disabled={busy || total === 0}>
          Select all
        </button>
        <button
          type="button"
          onClick={onSelectFailed}
          className={BTN}
          disabled={busy || failedCount === 0}
        >
          Select failed only ({failedCount})
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className={BTN}
          disabled={busy || !hasSelection}
        >
          Clear selection
        </button>
      </div>

      {hasSelection && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 dark:border-slate-800 pt-2">
          <button
            type="button"
            onClick={onDiagnoseAll}
            className={cn(BTN, 'border-emerald-300 dark:border-emerald-800 font-medium')}
            disabled={busy}
            title={
              estCostUsd && estCostUsd > 0
                ? `Estimated cost: ~$${estCostUsd.toFixed(2)} for ${selected} item${selected === 1 ? '' : 's'}`
                : undefined
            }
          >
            {busy ? 'Diagnosing…' : `Diagnose all (${selected})`}
            {estCostUsd && estCostUsd > 0 ? (
              <span className="ml-1.5 text-slate-500 tabular-nums">~${estCostUsd.toFixed(2)}</span>
            ) : null}
          </button>
          <button type="button" onClick={onDiscussAll} className={BTN} disabled={busy}>
            Discuss all ({selected})
          </button>
          <button type="button" onClick={onCopyCcPrompt} className={BTN} disabled={busy}>
            Copy combined CC prompt
          </button>
          <button type="button" onClick={onDismissAll} className={BTN} disabled={busy}>
            Dismiss all
          </button>
        </div>
      )}
    </div>
  )
}
