// Phase 1.10bb-c Session 4 — Workshop left-rail session list.
//
// Lists prior + active workshop sessions with status pills and a primary
// "Start new workshop" button at top. Selection is controlled by the
// parent (PlanWorkshop) via `selectedSessionId` + `onSelect`.
//
// 1.10bd-queue-pivot Step 4: cards now expose explicit Queue and Archive
// actions. "Queue this session" runs the atomic /queue handler (master
// plan rewrite + spec drafting + git push). Archive hides the session
// from the default list without deleting state. Sessions in the queue-
// ready group (approved diff, not yet applied, not archived) show 1./2./3.
// priority numbering so the user can see queue order at a glance.

import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Sparkles, Archive, ArchiveRestore, Rocket, Loader2, AlertTriangle, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  listWorkshopSessions,
  archiveWorkshopSession,
  unarchiveWorkshopSession,
  queueWorkshopDiff,
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

// Derived bucket — different from the raw status because we want to split
// 'completed' into "ready to queue" (approved, not yet applied) vs "applied"
// (already pushed to the filesystem). Buckets are rendered in this order.
type CardBucket =
  | 'active'
  | 'awaiting_approval'
  | 'ready_to_queue'
  | 'applied'
  | 'rejected'
  | 'abandoned'
  | 'archived'

const BUCKET_HEADING: Record<CardBucket, string> = {
  active: 'Active',
  awaiting_approval: 'Awaiting approval',
  ready_to_queue: 'Ready to queue',
  applied: 'Applied',
  rejected: 'Rejected',
  abandoned: 'Abandoned',
  archived: 'Archived',
}

function bucketOf(s: WorkshopSessionSummary): CardBucket {
  if (s.archived_at) return 'archived'
  if (s.status === 'active') return 'active'
  if (s.status === 'awaiting_approval') return 'awaiting_approval'
  if (s.status === 'abandoned') return 'abandoned'
  // status === 'completed' — refine by diff timestamps.
  if (s.plan_diff_applied_at) return 'applied'
  if (s.plan_diff_rejected_at) return 'rejected'
  if (s.plan_diff_approved_at) return 'ready_to_queue'
  // Completed but no diff resolution — treat as awaiting_approval visually.
  return 'awaiting_approval'
}

type ConfirmKind = 'queue' | 'archive' | 'unarchive'
interface ConfirmState {
  kind: ConfirmKind
  session: WorkshopSessionSummary
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
  const [includeArchived, setIncludeArchived] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null) // session id

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listWorkshopSessions({ includeArchived })
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
  }, [refreshKey, includeArchived, reloadTick])

  const grouped = useMemo(() => {
    const order: CardBucket[] = ['active', 'awaiting_approval', 'ready_to_queue', 'applied', 'rejected', 'abandoned', 'archived']
    const buckets = new Map<CardBucket, WorkshopSessionSummary[]>()
    for (const s of sessions) {
      const b = bucketOf(s)
      const arr = buckets.get(b) ?? []
      arr.push(s)
      buckets.set(b, arr)
    }
    const out: Array<[CardBucket, WorkshopSessionSummary[]]> = []
    for (const b of order) {
      const list = buckets.get(b)
      if (list && list.length > 0) {
        // Within ready_to_queue, oldest started_at first (FIFO).
        if (b === 'ready_to_queue') list.sort((a, c) => a.started_at.localeCompare(c.started_at))
        out.push([b, list])
      }
    }
    return out
  }, [sessions])

  async function handleConfirmedAction() {
    if (!confirm) return
    const { kind, session } = confirm
    setActionBusy(session.id)
    setConfirm(null)
    try {
      if (kind === 'queue') {
        if (!session.plan_diff_id) {
          toast.error('Session has no plan diff to queue')
          return
        }
        const result = await queueWorkshopDiff(session.plan_diff_id)
        if (result.ok) {
          toast.success(
            `Queued ${result.specs_drafted} spec${result.specs_drafted === 1 ? '' : 's'}${result.commit_sha ? ` — ${result.commit_sha.slice(0, 7)}` : ''}`,
            { duration: 6000 },
          )
        } else if (result.status === 'rolled_back') {
          toast.error(`Push failed; working tree reset to origin/main. Retry or inspect /health. ${result.error ?? ''}`, { duration: 10000 })
        } else {
          toast.error(`Queue failed: ${result.error ?? 'unknown error'}`, { duration: 10000 })
        }
      } else if (kind === 'archive') {
        await archiveWorkshopSession(session.id)
        toast.success('Session archived', { duration: 3000 })
      } else if (kind === 'unarchive') {
        await unarchiveWorkshopSession(session.id)
        toast.success('Session restored', { duration: 3000 })
      }
      setReloadTick((t) => t + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { duration: 8000 })
    } finally {
      setActionBusy(null)
    }
  }

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
          aria-label="Start new workshop session"
          className="w-full bg-amber-700 hover:bg-amber-800 text-white text-xs h-8 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="size-3.5 mr-1" aria-hidden />
          Start new workshop
        </Button>
        <button
          type="button"
          onClick={() => setIncludeArchived((v) => !v)}
          aria-label={includeArchived ? 'Hide archived sessions' : 'Show archived sessions'}
          aria-pressed={includeArchived}
          className="mt-2 w-full text-[10px] text-amber-900/80 dark:text-amber-200/70 hover:text-amber-900 dark:hover:text-amber-100 flex items-center justify-center gap-1.5 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none rounded"
        >
          <Eye className="size-3" aria-hidden />
          {includeArchived ? 'Hide archived' : 'Show archived'}
        </button>
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
        {!loading && grouped.map(([bucket, list]) => (
          <section key={bucket} className="space-y-1">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
              {BUCKET_HEADING[bucket]}{' '}
              <span className="tabular-nums">({list.length})</span>
            </h4>
            <ul className="space-y-1">
              {list.map((s, idx) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  bucket={bucket}
                  priority={bucket === 'ready_to_queue' ? idx + 1 : null}
                  isSelected={s.id === selectedSessionId}
                  isBusy={actionBusy === s.id}
                  onSelect={() => onSelect(s.id)}
                  onAction={(kind) => setConfirm({ kind, session: s })}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <ConfirmActionDialog
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirmedAction}
        busy={actionBusy !== null}
      />
    </aside>
  )
}

interface SessionCardProps {
  session: WorkshopSessionSummary
  bucket: CardBucket
  priority: number | null
  isSelected: boolean
  isBusy: boolean
  onSelect: () => void
  onAction: (kind: ConfirmKind) => void
}

function SessionCard({ session, bucket, priority, isSelected, isBusy, onSelect, onAction }: SessionCardProps) {
  const startedDate = session.started_at ? new Date(session.started_at).toLocaleDateString() : ''
  const archived = !!session.archived_at
  const pill = STATUS_PILL[session.status]

  return (
    <li>
      <div
        className={cn(
          'group rounded-md border transition-colors duration-200',
          'focus-within:ring-2 focus-within:ring-emerald-600/50',
          isSelected
            ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700'
            : archived
              ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-70'
              : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-800',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={isSelected ? 'true' : 'false'}
          aria-label={`Select workshop session ${session.id.slice(0, 8)}`}
          className={cn(
            'w-full text-left px-2 py-1.5 text-[10px] sm:text-[11px] min-h-11 sm:min-h-0',
            'transition-colors duration-200 rounded-t-md',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
            isSelected ? 'text-amber-900 dark:text-amber-100' : 'text-slate-700 dark:text-slate-200',
          )}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {priority !== null && (
              <span
                className="inline-flex items-center justify-center min-w-5 h-5 px-1 text-[10px] font-semibold tabular-nums rounded-full bg-emerald-600 text-white"
                aria-label={`Queue priority ${priority}`}
                title={`Priority ${priority} — earliest sessions queue first`}
              >
                {priority}
              </span>
            )}
            <span
              className={cn(
                'inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded',
                pill.className,
              )}
            >
              {pill.label}
            </span>
            {bucket === 'applied' && (
              <span className="inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-emerald-600 text-white">
                Applied
              </span>
            )}
            <span className="text-slate-400 ml-auto tabular-nums">{startedDate}</span>
          </div>
          <div className="truncate font-mono text-[10px] text-slate-500">
            {session.id.slice(0, 8)}…
          </div>
          <div className="text-slate-500 mt-0.5">
            {session.total_turns} turn{session.total_turns === 1 ? '' : 's'}
            {session.total_cost_usd > 0 && (
              <>
                {' · '}
                <span className="tabular-nums">${session.total_cost_usd.toFixed(2)}</span>
              </>
            )}
          </div>
        </button>

        {/* Action row — Queue, Archive / Unarchive. Rendered conditionally
            so non-actionable cards stay compact. */}
        {(bucket === 'ready_to_queue' || (!archived && (bucket === 'applied' || bucket === 'rejected' || bucket === 'abandoned')) || archived) && (
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5 border-t border-slate-100 dark:border-slate-800/60">
            {bucket === 'ready_to_queue' && (
              <Button
                type="button"
                size="sm"
                aria-label="Queue this workshop session"
                onClick={(e) => { e.stopPropagation(); onAction('queue') }}
                disabled={isBusy}
                className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBusy ? (
                  <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                ) : (
                  <Rocket className="size-3 mr-1" aria-hidden />
                )}
                Queue this session
              </Button>
            )}
            <div className="ml-auto">
              {archived ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="Restore archived workshop session"
                  onClick={(e) => { e.stopPropagation(); onAction('unarchive') }}
                  disabled={isBusy}
                  className="h-6 text-[10px] px-2 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBusy ? (
                    <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                  ) : (
                    <ArchiveRestore className="size-3 mr-1" aria-hidden />
                  )}
                  Restore
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Archive workshop session"
                  onClick={(e) => { e.stopPropagation(); onAction('archive') }}
                  disabled={isBusy}
                  className="h-6 text-[10px] px-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBusy ? (
                    <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
                  ) : (
                    <Archive className="size-3 mr-1" aria-hidden />
                  )}
                  Archive
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

interface ConfirmActionDialogProps {
  confirm: ConfirmState | null
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}

function ConfirmActionDialog({ confirm, onCancel, onConfirm, busy = false }: ConfirmActionDialogProps) {
  const kind = confirm?.kind
  const isQueue = kind === 'queue'
  const isArchive = kind === 'archive'
  // const isUnarchive = kind === 'unarchive'

  return (
    <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isQueue && <Rocket className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />}
            {isArchive && <Archive className="size-4 text-slate-600 dark:text-slate-400 shrink-0" aria-hidden />}
            {!isQueue && !isArchive && <ArchiveRestore className="size-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden />}
            {isQueue && 'Queue this session?'}
            {isArchive && 'Archive this session?'}
            {!isQueue && !isArchive && 'Restore this session?'}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
            {isQueue && (
              <>
                Atlas will rewrite <code className="font-mono text-[11px]">.agent/master-plan.md</code>, synthesize spec files for every add/edit op, and push a single commit to <code className="font-mono text-[11px]">origin/main</code>. The builder picks up specs from <code className="font-mono text-[11px]">.agent/tasks/queued/</code> on its next cycle. If the push fails, the working tree resets cleanly to <code className="font-mono text-[11px]">origin/main</code> — no half-applied state.
              </>
            )}
            {isArchive && (
              'Hides this session from the default list. State is preserved and recoverable via "Show archived" → Restore. Active/awaiting_approval sessions can also be archived.'
            )}
            {!isQueue && !isArchive && (
              'Clears archived_at so the session reappears in the default list.'
            )}
          </DialogDescription>
        </DialogHeader>
        {isQueue && (
          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
              <span>
                This commits + pushes to <code className="font-mono">main</code>. Make sure the diff is what you want before confirming.
              </span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
            className="transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >Cancel</Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            aria-label={isQueue ? 'Confirm queue and push' : isArchive ? 'Confirm archive session' : 'Confirm restore session'}
            className={cn(
              'transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
              isQueue && 'bg-emerald-600 hover:bg-emerald-700 text-white',
              isArchive && 'bg-slate-700 hover:bg-slate-800 text-white',
              !isQueue && !isArchive && 'bg-amber-600 hover:bg-amber-700 text-white',
            )}
          >
            {isQueue && (<><Rocket className="size-3 mr-1.5" aria-hidden />Queue + push</>)}
            {isArchive && (<><Archive className="size-3 mr-1.5" aria-hidden />Archive</>)}
            {!isQueue && !isArchive && (<><ArchiveRestore className="size-3 mr-1.5" aria-hidden />Restore</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default WorkshopSessionList
