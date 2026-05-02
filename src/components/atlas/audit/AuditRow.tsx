import { CheckCircle2, XCircle, MinusCircle, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AuditRowSource = 'verifier' | 'designer'
export type AuditVerdict = 'pass' | 'fail' | 'partial' | 'unknown'

export interface AuditRowData {
  id: string
  source: AuditRowSource
  verdict: AuditVerdict
  task_id: string
  summary: string
  commit_sha: string | null
  created_at: string
  gap_count: number
  // Carried so the action handlers (Diagnose / Copy CC Prompt) can submit a
  // proper payload to /atlas/artifacts/diagnose without an extra fetch.
  gaps?: unknown[]
  raw?: Record<string, unknown>
}

export type AuditRowAction =
  | 'diagnose'
  | 'discuss'
  | 'copy-cc-prompt'
  | 'view-gaps'
  | 'open-commit'
  | 'recheck'

interface AuditRowProps {
  row: AuditRowData
  onAction: (kind: AuditRowAction, row: AuditRowData) => void
  recheckBusy?: boolean
}

export function AuditRow({ row, onAction, recheckBusy }: AuditRowProps) {
  const isFail = row.verdict === 'fail'
  const showRecheck = isFail || row.verdict === 'unknown'
  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2">
      <div className="flex items-start gap-2">
        <VerdictIcon verdict={row.verdict} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
              {formatRelativeTime(row.created_at)}
            </span>
            <span
              className={cn(
                'text-[10px] uppercase tracking-wider font-semibold',
                row.source === 'verifier'
                  ? 'text-sky-700 dark:text-sky-300'
                  : 'text-violet-700 dark:text-violet-300',
              )}
            >
              {row.source}
            </span>
            <code className="font-mono text-xs text-slate-700 dark:text-slate-200 truncate">
              {row.task_id}
            </code>
            <span className="ml-auto text-[10px] text-slate-400">
              {row.commit_sha ? `commit ${row.commit_sha.slice(0, 7)}` : ''}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 truncate">
            {row.summary}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] flex-wrap">
            {isFail ? (
              <>
                <ActionButton onClick={() => onAction('diagnose', row)}>Diagnose</ActionButton>
                <ActionButton onClick={() => onAction('discuss', row)}>Discuss</ActionButton>
                <ActionButton onClick={() => onAction('copy-cc-prompt', row)}>
                  Copy CC Prompt
                </ActionButton>
              </>
            ) : (
              <>
                {row.gap_count > 0 && (
                  <ActionButton onClick={() => onAction('view-gaps', row)}>
                    view gaps ({row.gap_count})
                  </ActionButton>
                )}
                {row.commit_sha && (
                  <ActionButton onClick={() => onAction('open-commit', row)}>
                    open commit
                    <ExternalLink className="size-3 ml-0.5" aria-hidden />
                  </ActionButton>
                )}
              </>
            )}
            {showRecheck && (
              <ActionButton
                onClick={() => onAction('recheck', row)}
                disabled={recheckBusy}
                title="Re-run the audit at current HEAD; if it passes the row drops off the list"
                ariaLabel={
                  recheckBusy
                    ? `Rechecking ${row.source} for ${row.task_id}…`
                    : `Recheck ${row.source} audit for ${row.task_id} at current HEAD`
                }
              >
                <RefreshCw
                  className={cn('size-3 mr-0.5', recheckBusy && 'animate-spin')}
                  aria-hidden
                />
                {recheckBusy ? 'Rechecking…' : 'Recheck'}
              </ActionButton>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

function VerdictIcon({ verdict }: { verdict: AuditVerdict }) {
  if (verdict === 'pass') {
    return <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
  }
  if (verdict === 'fail') {
    return <XCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
  }
  if (verdict === 'partial') {
    return <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
  }
  return <MinusCircle className="size-4 text-slate-400 shrink-0 mt-0.5" />
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}
