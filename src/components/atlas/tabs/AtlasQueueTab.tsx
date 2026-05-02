import { useCallback, useEffect, useState } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import { QueueRow } from '../queue/QueueRow'
import { Button } from '@/components/ui/button'
import {
  fetchBuilderQueue,
  setBuilderPriority,
  cancelBuilderTask,
  fetchAtlasMe,
  type BuilderQueueResponse,
  type AtlasRole,
} from '@/lib/atlas-client'

export default function AtlasQueueTab() {
  const [data, setData] = useState<BuilderQueueResponse>({ queued: [], in_flight: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<AtlasRole | null>(null)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

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

  const handlePriority = async (taskId: string, delta: -1 | 1) => {
    const spec = data.queued.find(s => s.id === taskId)
    if (!spec) return
    const next = Math.min(10, Math.max(1, spec.priority + delta))
    if (next === spec.priority) return
    setBusyTaskId(taskId)
    try {
      await setBuilderPriority(taskId, next)
      await refresh()
      showToast(`priority(${taskId}) → ${next}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'set_priority failed')
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
          {inFlight && (
            <QueueRow
              key={`flight:${inFlight.id}`}
              taskId={inFlight.id}
              filename={inFlight.filename}
              state="in-progress"
              startedAt={inFlight.started_at}
              canManage={false}
            />
          )}
          {data.queued.map((spec, i) => (
            <QueueRow
              key={spec.id}
              taskId={spec.id}
              filename={spec.filename}
              state="queued"
              position={i + 1}
              priority={spec.priority}
              blocked={spec.blocked}
              blockedBy={spec.blocked_by}
              canManage={canManage}
              busy={busyTaskId === spec.id}
              onPriorityUp={() => void handlePriority(spec.id, -1)}
              onPriorityDown={() => void handlePriority(spec.id, 1)}
              onEdit={() => handleEdit(spec.id)}
              onCancel={() => void handleCancel(spec.id)}
            />
          ))}
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
    </TabFrame>
  )
}

function minutesSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  return Math.floor(ms / 60_000)
}
