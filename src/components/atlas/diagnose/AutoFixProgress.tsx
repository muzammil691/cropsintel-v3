import { Check, Loader2, AlertCircle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiagnosisLifecycleState } from '@/lib/atlas-client'

interface AutoFixProgressProps {
  state: DiagnosisLifecycleState
  queuedAt: string | null
  shippedAt: string | null
  resolvedAt: string | null
  failureReason: string | null
  commitSha: string | null
  onEscalate?: () => void
}

interface StepDef {
  label: string
}

const STEPS: StepDef[] = [
  { label: 'Spec queued' },
  { label: 'Builder shipping' },
  { label: 'Audit re-running' },
  { label: 'Cascade check' },
]

function stepIndexForState(state: DiagnosisLifecycleState): number {
  switch (state) {
    case 'auto-fix-queued':
      return 1
    case 'auto-fix-shipped':
      return 2
    case 'auto-fix-resolved':
    case 'auto-fix-failed':
      return 4
    default:
      return 0
  }
}

function fmtClock(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
}

function elapsedMin(iso: string | null): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.round((Date.now() - t) / 60000))
}

export function AutoFixProgress({
  state,
  queuedAt,
  shippedAt,
  resolvedAt,
  failureReason,
  commitSha,
  onEscalate,
}: AutoFixProgressProps) {
  const reached = stepIndexForState(state)
  const isResolved = state === 'auto-fix-resolved'
  const isFailed = state === 'auto-fix-failed'
  const heading = isResolved
    ? `✅ Resolved by autofix${commitSha ? ` (commit ${commitSha.slice(0, 7)})` : ''}`
    : isFailed
      ? `❌ Auto-fix failed; gap still present`
      : `🔧 Auto-fix in progress`

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-xs space-y-2',
        isResolved
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
          : isFailed
            ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
            : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200',
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        {isResolved ? (
          <Check className="size-4" aria-hidden />
        ) : isFailed ? (
          <AlertCircle className="size-4" aria-hidden />
        ) : (
          <Wrench className="size-4" aria-hidden />
        )}
        <span>{heading}</span>
      </div>

      <ol className="space-y-1">
        {STEPS.map((s, i) => {
          const done = i < reached
          const active = i === reached - 1 && !isResolved && !isFailed
          const ts = i === 0 ? queuedAt : i === 1 ? shippedAt : i === 3 && isResolved ? resolvedAt : null
          return (
            <li key={s.label} className="flex items-center gap-2 text-[11px]">
              <span
                className={cn(
                  'inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
                  done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : active
                      ? 'border-sky-500 text-sky-700 dark:text-sky-300'
                      : 'border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500',
                )}
              >
                {done ? (
                  <Check className="size-2.5" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-2.5 animate-spin" aria-hidden />
                ) : (
                  <span className="size-1 rounded-full bg-current" aria-hidden />
                )}
              </span>
              <span>
                Step {i + 1}/4: {s.label}
                {done ? ' ✓' : active ? '…' : ''}
                {ts && done ? ` (${fmtClock(ts)})` : ''}
                {active && i === 1 && shippedAt === null && queuedAt
                  ? ` (currently ${elapsedMin(queuedAt)} min in)`
                  : ''}
              </span>
            </li>
          )
        })}
      </ol>

      {isFailed && failureReason && (
        <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-white/60 dark:bg-rose-950/40 px-2 py-1.5 text-[11px] whitespace-pre-wrap">
          {failureReason}
        </div>
      )}
      {isFailed && onEscalate && (
        <button
          type="button"
          onClick={onEscalate}
          className="mt-1 inline-flex items-center rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/50"
        >
          Generate Claude Code prompt
        </button>
      )}
    </div>
  )
}
