import { useCallback, useEffect, useMemo, useState } from 'react'
import { Inbox, RefreshCw, RefreshCcw, AlertTriangle } from 'lucide-react'
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
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [forcePickOpen, setForcePickOpen] = useState(false)
  const [forcePickBusy, setForcePickBusy] = useState(false)
  const [forcePickError, setForcePickError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchBuilderQueue()
      setData(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    fetchAtlasMe()
      .then(me => setRole(me.role))
      .catch(() => setRole('viewer'))
    const id = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const canManage = role === 'owner' || role === 'admin'

  const showToast = (msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(null), 3000)
  }

  // Pillar B.1: positional move (replaces the old priority +/- buttons).
  const handleMove = async (taskId: string, direction: 'up' | 'down') => {
    setBusyTaskId(taskId)
    try {
      const r = await moveBuilderPosition(taskId, direction)
      await refresh()
      if (r.moved) {
        showToast(`moved ${taskId} ${direction}`)
      } else {
        showToast(r.reason ?? `${taskId} stayed put`)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'move failed')
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
      showToast(`paused ${taskId}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'pause failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleResume = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      await resumeBuilderTask(taskId)
      await refresh()
      showToast(`resumed ${taskId}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'resume failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  // H.1: force-cancel — works on in-progress zombies. Confirmation prompt
  // because this interrupts a running Builder task.
  const handleForceCancel = async (taskId: string) => {
    if (!window.confirm(
      `Force-cancel ${taskId}?\n\nThis moves the spec from in-progress/ to cancelled/. ` +
      `Builder's running claude session will keep going for a bit but its commit will be ignored. ` +
      `Use this only when a spec is genuinely stuck.`,
    )) return
    setBusyTaskId(taskId)
    try {
      const r = await forceCancelBuilderTask(taskId)
      await refresh()
      showToast(`force-cancelled ${taskId} (was in ${r.from_bucket}/)`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'force-cancel failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleCancel = async (taskId: string) => {
    if (!window.confirm(`Cancel ${taskId}? It will be moved to .agent/tasks/cancelled/.`)) return
    setBusyTaskId(taskId)
    try {
      await cancelBuilderTask(taskId)
      await refresh()
      showToast(`cancelled ${taskId}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'cancel failed')
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleEdit = (taskId: string) => {
    showToast(`Atlas, edit the spec at .agent/tasks/queued/${taskId}.md — describe the change in chat.`)
  }

  const inFlight = data.in_flight[0]
  const total = data.queued.length

  const headerHint = inFlight
    ? `${total} spec${total === 1 ? '' : 's'} queued · Builder is on ${inFlight.id}${
        inFlight.started_at ? ` (${minutesSince(inFlight.started_at)} min in)` : ''
      }`
    : `${total} spec${total === 1 ? '' : 's'} queued · Builder idle`

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
      showToast('Builder redeploy triggered — picking next spec…')
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

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-1.5 text-xs shadow-lg"
        >
          {toastMsg}
        </div>
      )}

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
