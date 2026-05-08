import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, RefreshCw, RefreshCcw, AlertTriangle, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { TabFrame } from './AtlasPlanTab'
import { QueueRow } from '../queue/QueueRow'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  fetchBuilderQueue,
  cancelBuilderTask,
  forceCancelBuilderTask,
  moveBuilderPosition,
  pauseBuilderTask,
  resumeBuilderTask,
  fetchAtlasMe,
  forcePickBuilder,
  type BuilderQueueResponse,
  type AtlasRole,
  type AgentHeartbeat,
} from '@/lib/atlas-client'
import { deriveAgentStatus } from '@/hooks/useAgentHeartbeats'

interface AtlasQueueTabProps {
  heartbeats?: Record<string, AgentHeartbeat>
}

export default function AtlasQueueTab({ heartbeats }: AtlasQueueTabProps = {}) {
  const [data, setData] = useState<BuilderQueueResponse>({ queued: [], in_flight: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<AtlasRole | null>(null)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [forcePickOpen, setForcePickOpen] = useState(false)
  const [forcePickBusy, setForcePickBusy] = useState(false)
  const [forcePickError, setForcePickError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    taskId: string
    mode: 'cancel' | 'force-cancel'
  } | null>(null)
  // 1.10af: track last successful queue fetch so the UI can show a stale-state
  // banner when /atlas/queue has been unreachable for >30s.
  const lastSuccessRef = useRef<number>(Date.now())
  const [lastSuccessAt, setLastSuccessAt] = useState<number>(Date.now())
  const [now, setNow] = useState<number>(Date.now())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchBuilderQueue()
      setData(next)
      setError(null)
      const ts = Date.now()
      lastSuccessRef.current = ts
      setLastSuccessAt(ts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // 1.10af: 5s polling, paused when the tab is hidden. A wall-clock tick keeps
  // "stale since" / "last seen" labels live without a network round-trip.
  useEffect(() => {
    void refresh()
    fetchAtlasMe()
      .then(me => setRole(me.role))
      .catch(() => setRole('viewer'))

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refresh()
    }
    const pollId = window.setInterval(tick, 5_000)

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refresh()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    const wallClockId = window.setInterval(() => setNow(Date.now()), 5_000)

    return () => {
      window.clearInterval(pollId)
      window.clearInterval(wallClockId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [refresh])

  const canManage = role === 'owner' || role === 'admin'

  // Pillar B.1: positional move (replaces the old priority +/- buttons).
  const handleMove = async (taskId: string, direction: 'up' | 'down') => {
    setBusyTaskId(taskId)
    try {
      const r = await moveBuilderPosition(taskId, direction)
      await refresh()
      if (r.moved) {
        toast.success(`moved ${taskId} ${direction}`)
      } else {
        toast.message(r.reason ?? `${taskId} stayed put`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'move failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  // Pillar B.2: pause / resume.
  const handlePause = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      await pauseBuilderTask(taskId)
      await refresh()
      toast.success(`paused ${taskId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'pause failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleResume = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      await resumeBuilderTask(taskId)
      await refresh()
      toast.success(`resumed ${taskId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'resume failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  // H.1: force-cancel — works on in-progress zombies. Opens an accessible
  // shadcn Dialog (replaces window.confirm) so the destructive action is
  // styled and screen-reader friendly.
  const handleForceCancel = (taskId: string) => {
    setConfirmDialog({ taskId, mode: 'force-cancel' })
  }

  const handleCancel = (taskId: string) => {
    setConfirmDialog({ taskId, mode: 'cancel' })
  }

  const handleConfirmDialogAccept = async () => {
    if (!confirmDialog) return
    const { taskId, mode } = confirmDialog
    setConfirmDialog(null)
    setBusyTaskId(taskId)
    try {
      if (mode === 'force-cancel') {
        const r = await forceCancelBuilderTask(taskId)
        await refresh()
        toast.success(`force-cancelled ${taskId} (was in ${r.from_bucket}/)`)
      } else {
        await cancelBuilderTask(taskId)
        await refresh()
        toast.success(`cancelled ${taskId}`)
      }
    } catch (err) {
      const fallback = mode === 'force-cancel' ? 'force-cancel failed' : 'cancel failed'
      toast.error(err instanceof Error ? err.message : fallback)
      // 1.10af: spec may have already moved on the server (e.g. force-cancel
      // succeeded on disk before erroring on push). Refetch so the UI doesn't
      // keep showing the spec the user already cancelled.
      await refresh()
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleEdit = (taskId: string) => {
    toast.message(`Atlas, edit the spec at .agent/tasks/queued/${taskId}.md — describe the change in chat.`)
  }

  const inFlight = data.in_flight[0]
  const total = data.queued.length

  // 1.10af: Builder unresponsive detection. The spec calls for using a
  // `builder_last_heartbeat_at` field on the queue payload (1.10ag). Until
  // that ships we degrade gracefully to the existing per-agent heartbeat:
  // the builder card is "unresponsive" when its heartbeat hasn't refreshed in
  // >120s while a spec is in-progress.
  const builderHeartbeat = heartbeats?.builder
  const builderHeartbeatAgeMs = builderHeartbeat
    ? Math.max(0, now - new Date(builderHeartbeat.updated_at).getTime())
    : null
  // Phase 1.10ai: when the heartbeat is stale BUT the in-flight spec's log
  // file is fresh (updated <5min ago), Builder is in a Verifier/Designer
  // audit — silent on heartbeats but genuinely working. Render that as
  // "in audit phase" rather than scaring the user with "unresponsive."
  const builderInAuditPhase = !!(
    inFlight &&
    inFlight.log_fresh &&
    builderHeartbeatAgeMs !== null &&
    builderHeartbeatAgeMs > 120_000
  )
  const builderUnresponsive = !!(
    inFlight &&
    builderHeartbeatAgeMs !== null &&
    builderHeartbeatAgeMs > 120_000 &&
    !builderInAuditPhase
  )

  const headerHint = inFlight
    ? `${total} spec${total === 1 ? '' : 's'} queued · ${
        builderUnresponsive
          ? `Builder unresponsive — last seen ${minutesFromMs(builderHeartbeatAgeMs ?? 0)}m ago`
          : builderInAuditPhase
          ? `Builder · in audit phase (${inFlight.id})`
          : `Builder is on ${inFlight.id}${
              inFlight.started_at ? ` (${minutesSince(inFlight.started_at)} min in)` : ''
            }`
      }`
    : `${total} spec${total === 1 ? '' : 's'} queued · Builder idle`

  // 1.10af: stale-state banner — if /atlas/queue hasn't returned successfully
  // for >30s, the dashboard is showing frozen data. Make this impossible to
  // miss with a red banner at the top of the queue tab.
  const staleSinceMs = now - lastSuccessAt
  const showStaleBanner = staleSinceMs > 30_000

  // Idle-banner condition: queue has items, no agent in-flight, AND the
  // Builder heartbeat (or any agent's heartbeat) hasn't shown 'running' for >5 min.
  const showIdleBanner = useMemo(() => {
    if (total === 0) return false
    if (inFlight) return false
    const all = heartbeats ? Object.values(heartbeats) : []
    if (all.length === 0) return true
    const anyRunning = all.some(h => deriveAgentStatus(h) === 'running')
    if (anyRunning) return false
    const builder = heartbeats?.builder
    if (!builder) return true
    const ageMin = (Date.now() - new Date(builder.updated_at).getTime()) / 60000
    return ageMin > 5
  }, [total, inFlight, heartbeats])

  async function handleForcePick() {
    setForcePickBusy(true)
    setForcePickError(null)
    try {
      await forcePickBuilder()
      toast.success('Builder redeploy triggered — picking next spec…')
      setForcePickOpen(false)
    } catch (err) {
      setForcePickError(err instanceof Error ? err.message : String(err))
    } finally {
      setForcePickBusy(false)
    }
  }

  return (
    <TabFrame
      title="Queue"
      hint={headerHint}
      rightSlot={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs"
          aria-label="Refresh queue"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      }
    >
      {showStaleBanner && (
        <div
          role="alert"
          data-testid="dashboard-stale-banner"
          className="mb-2 rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200 flex items-start gap-2"
        >
          <WifiOff className="size-4 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Dashboard cannot reach Atlas</p>
            <p className="mt-0.5 text-red-700/80 dark:text-red-300/80">
              Showing stale data from {new Date(lastSuccessAt).toLocaleTimeString()} (
              {minutesFromMs(staleSinceMs) > 0
                ? `${minutesFromMs(staleSinceMs)}m ago`
                : `${Math.floor(staleSinceMs / 1000)}s ago`}
              ).
            </p>
          </div>
        </div>
      )}
      {loading && total === 0 && !inFlight ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-20 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : error && total === 0 && !inFlight ? (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : total === 0 && !inFlight ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
          <span className="grid place-items-center size-10 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Inbox className="size-5" />
          </span>
          <p className="text-sm font-medium">Queue is empty</p>
          <p className="text-xs text-slate-500 max-w-[260px]">
            New specs land here when Atlas drafts them or you /spec from chat.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {showIdleBanner && (
            <li
              role="alert"
              className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    Builder is idle but queue has {total} item{total === 1 ? '' : 's'}.
                  </p>
                  <p className="mt-0.5 text-amber-700/80 dark:text-amber-300/80">
                    The autonomous loop should pick up within 5 min. If it&apos;s stuck, you can manually nudge.
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setForcePickError(null)
                      setForcePickOpen(true)
                    }}
                    className="shrink-0"
                  >
                    <RefreshCcw className="size-3.5 mr-1" />
                    Force Builder pick
                  </Button>
                )}
              </div>
            </li>
          )}
          {inFlight && (
            <QueueRow
              key={`flight:${inFlight.id}`}
              taskId={inFlight.id}
              filename={inFlight.filename}
              state="in-progress"
              startedAt={inFlight.started_at}
              canManage={canManage}
              busy={busyTaskId === inFlight.id}
              builderUnresponsive={builderUnresponsive}
              builderLastSeenMin={
                builderHeartbeatAgeMs !== null ? minutesFromMs(builderHeartbeatAgeMs) : null
              }
              onForceCancel={canManage ? () => void handleForceCancel(inFlight.id) : undefined}
            />
          )}
          {(() => {
            // Pillar B.1: compute the first/last index of the *active* queue
            // (not paused, not blocked) so the move buttons disable at the edges.
            const activeIdxs = data.queued
              .map((s, i) => ({ i, ok: !s.paused && !s.blocked }))
              .filter(x => x.ok)
              .map(x => x.i)
            const firstActive = activeIdxs[0]
            const lastActive = activeIdxs[activeIdxs.length - 1]
            return data.queued.map((spec, i) => (
              <QueueRow
                key={spec.id}
                taskId={spec.id}
                filename={spec.filename}
                state="queued"
                position={i + 1}
                priority={spec.priority}
                blocked={spec.blocked}
                blockedBy={spec.blocked_by}
                paused={spec.paused}
                isFirstActive={i === firstActive}
                isLastActive={i === lastActive}
                canManage={canManage}
                busy={busyTaskId === spec.id}
                onMoveUp={() => void handleMove(spec.id, 'up')}
                onMoveDown={() => void handleMove(spec.id, 'down')}
                onEdit={() => handleEdit(spec.id)}
                onCancel={() => void handleCancel(spec.id)}
                onPause={() => void handlePause(spec.id)}
                onResume={() => void handleResume(spec.id)}
              />
            ))
          })()}
        </ul>
      )}

      <Dialog
        open={confirmDialog !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDialog(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-600" />
              {confirmDialog?.mode === 'force-cancel'
                ? 'Force-cancel running spec?'
                : 'Cancel queued spec?'}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog?.mode === 'force-cancel' ? (
                <>
                  Force-cancel <code className="font-mono">{confirmDialog.taskId}</code>? This
                  moves the spec from <code className="font-mono">in-progress/</code> to{' '}
                  <code className="font-mono">cancelled/</code>. Builder&apos;s running Claude
                  session will keep going for a bit but its commit will be ignored. Use this only
                  when a spec is genuinely stuck.
                </>
              ) : confirmDialog ? (
                <>
                  Cancel <code className="font-mono">{confirmDialog.taskId}</code>? It will be
                  moved to <code className="font-mono">.agent/tasks/cancelled/</code>.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Keep spec
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDialogAccept()}>
              {confirmDialog?.mode === 'force-cancel' ? 'Force-cancel' : 'Cancel spec'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={forcePickOpen} onOpenChange={(o) => !forcePickBusy && setForcePickOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <RefreshCcw className="size-4 text-amber-600" />
              Force-pick Builder?
            </DialogTitle>
            <DialogDescription>
              Force-pick will redeploy Builder. If Builder is currently in flight, that task is interrupted and re-queued. Continue?
            </DialogDescription>
          </DialogHeader>
          {forcePickError && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {forcePickError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForcePickOpen(false)} disabled={forcePickBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleForcePick()} disabled={forcePickBusy}>
              {forcePickBusy ? 'Redeploying…' : 'Force-pick'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabFrame>
  )
}

function minutesSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / 60_000)
}

function minutesFromMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.floor(ms / 60_000)
}
