import { ChevronUp, ChevronDown, Pencil, Trash2, FileText, Clock, ExternalLink, Pause, Play, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QueueRowProps {
  taskId: string
  filename: string
  state: 'queued' | 'in-progress'
  position?: number
  priority?: number
  blocked?: boolean
  blockedBy?: string[]
  /** Pillar B.2: this spec is paused — Builder will skip it. */
  paused?: boolean
  /** Pillar B.1: edge flags so the Move buttons disable when there's no neighbor. */
  isFirstActive?: boolean
  isLastActive?: boolean
  startedAt?: string | null
  canManage: boolean
  busy?: boolean
  /** Pillar B.1: positional move (replaces the old priority +/- buttons). */
  onMoveUp?: () => void
  onMoveDown?: () => void
  onEdit?: () => void
  onCancel?: () => void
  /** Pillar B.2 */
  onPause?: () => void
  onResume?: () => void
  /** H.1: force-cancel — works on in-progress zombies. Distinct callback from
   *  onCancel because the UI shows a different (warning-styled) button. */
  onForceCancel?: () => void
}

// H.1: when an in-progress spec has been running for longer than this, the
// row shows a "STUCK?" warning and the Force-cancel button gets a more
// prominent (amber) styling. Builder runs longer than this are unusual but
// possible (Phase 1.7 ports, big migrations) — the warning is advisory.
const STUCK_THRESHOLD_MIN = 30

export function QueueRow({
  taskId,
  filename,
  state,
  position,
  priority,
  blocked,
  blockedBy,
  paused,
  isFirstActive,
  isLastActive,
  startedAt,
  canManage,
  busy,
  onMoveUp,
  onMoveDown,
  onEdit,
  onCancel,
  onPause,
  onResume,
  onForceCancel,
}: QueueRowProps) {
  const isInFlight = state === 'in-progress'
  // H.1: detect zombies / stuck-running specs by how long they've been in
  // .agent/tasks/in-progress/. The startedAt prop comes from the file's
  // mtime per server.ts:3504. >30 min = warn the user, surface force-cancel.
  const stuckMinutes = isInFlight && startedAt ? minutesSinceISO(startedAt) : 0
  const isStuck = isInFlight && stuckMinutes >= STUCK_THRESHOLD_MIN
  return (
    <li
      className={cn(
        'rounded-md border p-3',
        isInFlight && isStuck
          ? 'border-amber-400 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/40'
          : isInFlight
          ? 'border-emerald-300 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/30'
          : paused
          ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 opacity-75'
          : blocked
          ? 'border-amber-200 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/20'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-sm shrink-0">
          {isInFlight ? '⏳' : paused ? '⏸' : circleNumber(position ?? 0)}
        </span>
        <code className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
          {taskId}
        </code>
        <span className={cn(
          'ml-auto text-[10px] uppercase tracking-wider tabular-nums whitespace-nowrap',
          isStuck ? 'text-amber-700 dark:text-amber-300 font-semibold' : 'text-slate-500',
        )}>
          {isStuck
            ? `STUCK? ${stuckMinutes}m`
            : isInFlight
            ? 'IN-PROGRESS'
            : paused
            ? 'PAUSED'
            : `prio ${priority ?? 5}`}
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
        ) : paused ? (
          <span className="text-slate-600 dark:text-slate-300">
            paused — Builder will skip until resumed
          </span>
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
        {/* H.1: Force-cancel on in-progress rows. Visible only to admins.
            Styled prominently when the row has been in-progress past the
            STUCK_THRESHOLD so the user can rescue zombies fast. */}
        {isInFlight && canManage && onForceCancel && (
          <SmallButton
            onClick={onForceCancel}
            disabled={busy}
            title={isStuck
              ? `Force-cancel — Builder has been on this for ${stuckMinutes}m. Moves to cancelled/.`
              : 'Force-cancel running spec — moves to cancelled/. Use only if the spec is stuck.'}
            aria-label="Force-cancel running spec"
            className={cn(
              isStuck
                ? 'border-amber-400 bg-amber-100 hover:border-red-400 hover:bg-red-100/60 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                : 'hover:border-red-400 hover:bg-red-50/40 dark:hover:bg-red-950/30',
            )}
          >
            <AlertTriangle className="size-3" aria-hidden /> force-cancel
          </SmallButton>
        )}
        {!isInFlight && canManage && (
          <>
            {/* Pillar B.1: positional move. Disabled when paused (paused rows
                live at the tail of the order and aren't part of the active queue). */}
            <SmallButton
              onClick={onMoveUp}
              disabled={busy || paused || isFirstActive}
              title="Move up one position"
              aria-label="Move up one position"
            >
              <ChevronUp className="size-3" aria-hidden />
            </SmallButton>
            <SmallButton
              onClick={onMoveDown}
              disabled={busy || paused || isLastActive}
              title="Move down one position"
              aria-label="Move down one position"
            >
              <ChevronDown className="size-3" aria-hidden />
            </SmallButton>
            {/* Pillar B.2: pause / resume */}
            {paused ? (
              <SmallButton onClick={onResume} disabled={busy} title="Resume — Builder picks this up again" aria-label="Resume task">
                <Play className="size-3" aria-hidden /> resume
              </SmallButton>
            ) : (
              <SmallButton onClick={onPause} disabled={busy} title="Pause — Builder will skip until resumed" aria-label="Pause task">
                <Pause className="size-3" aria-hidden /> pause
              </SmallButton>
            )}
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
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  title?: string
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200 transition-colors duration-200',
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

function minutesSinceISO(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / 60_000)
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
