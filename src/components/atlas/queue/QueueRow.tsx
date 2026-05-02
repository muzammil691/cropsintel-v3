import { ChevronUp, ChevronDown, Pencil, Trash2, FileText, Clock, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QueueRowProps {
  taskId: string
  filename: string
  state: 'queued' | 'in-progress'
  position?: number
  priority?: number
  blocked?: boolean
  blockedBy?: string[]
  startedAt?: string | null
  canManage: boolean
  busy?: boolean
  onPriorityUp?: () => void
  onPriorityDown?: () => void
  onEdit?: () => void
  onCancel?: () => void
}

export function QueueRow({
  taskId,
  filename,
  state,
  position,
  priority,
  blocked,
  blockedBy,
  startedAt,
  canManage,
  busy,
  onPriorityUp,
  onPriorityDown,
  onEdit,
  onCancel,
}: QueueRowProps) {
  const isInFlight = state === 'in-progress'
  return (
    <li
      className={cn(
        'rounded-md border p-3',
        isInFlight
          ? 'border-emerald-300 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/30'
          : blocked
          ? 'border-amber-200 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/20'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-sm shrink-0">
          {isInFlight ? '⏳' : circleNumber(position ?? 0)}
        </span>
        <code className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
          {taskId}
        </code>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500 tabular-nums whitespace-nowrap">
          {isInFlight ? 'IN-PROGRESS' : `prio ${priority ?? 5}`}
        </span>
      </div>

      <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
        {isInFlight ? (
          <>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {formatRelativeDuration(startedAt)}
            </span>
            <span>·</span>
            <span>Builder</span>
          </>
        ) : (
          <>
            {blocked ? (
              <span className="text-amber-700 dark:text-amber-300">
                blocked by {blockedBy?.join(', ') || 'unknown'}
              </span>
            ) : (
              <span>ready</span>
            )}
          </>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <SmallButton onClick={() => openSpec(filename)}>
          <FileText className="size-3" aria-hidden /> view spec
          <ExternalLink className="size-2.5 ml-0.5" aria-hidden />
        </SmallButton>
        {isInFlight && (
          <SmallButton onClick={() => openLog(taskId)}>
            view live log
            <ExternalLink className="size-2.5 ml-0.5" aria-hidden />
          </SmallButton>
        )}
        {!isInFlight && canManage && (
          <>
            <SmallButton onClick={onPriorityUp} disabled={busy} title="Increase priority (lower number)">
              <ChevronUp className="size-3" aria-hidden />
            </SmallButton>
            <SmallButton onClick={onPriorityDown} disabled={busy} title="Decrease priority (higher number)">
              <ChevronDown className="size-3" aria-hidden />
            </SmallButton>
            <SmallButton onClick={onEdit} disabled={busy}>
              <Pencil className="size-3" aria-hidden /> edit
            </SmallButton>
            <SmallButton
              onClick={onCancel}
              disabled={busy}
              className="hover:border-red-400 hover:bg-red-50/40 dark:hover:bg-red-950/30"
            >
              <Trash2 className="size-3" aria-hidden /> cancel
            </SmallButton>
          </>
        )}
      </div>
    </li>
  )
}

function SmallButton({
  children,
  onClick,
  disabled,
  className,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200 transition-colors',
        'hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-white',
        className,
      )}
    >
      {children}
    </button>
  )
}

function circleNumber(n: number): string {
  if (n <= 0 || n > 20) return '·'
  const codepoints = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳']
  return codepoints[n - 1]
}

function openSpec(filename: string) {
  const url = `https://github.com/cropsintel/io/cropsintel-v3/blob/main/.agent/tasks/queued/${encodeURIComponent(filename)}`
  try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* ignore */ }
}

function openLog(taskId: string) {
  const url = `https://github.com/cropsintel/io/cropsintel-v3/tree/main/.agent/tasks/logs?q=${encodeURIComponent(taskId)}`
  try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* ignore */ }
}

function formatRelativeDuration(iso: string | null | undefined): string {
  if (!iso) return 'just now'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s in`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min in`
  const hr = Math.floor(min / 60)
  return `${hr}h in`
}
