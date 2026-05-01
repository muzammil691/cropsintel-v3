import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, CheckSquare, Inbox, MessagesSquare } from 'lucide-react'
import { PendingSpecCard } from './PendingSpecCard'
import { DesignerAuditCard } from './DesignerAuditCard'
import { OpenForkCard } from './OpenForkCard'
import { WorkflowTraceCard } from '../WorkflowTraceCard'
import { useWorkflowTraces } from '@/hooks/useWorkflowTraces'
import type { UseArtifactsResult } from '@/hooks/useArtifacts'
import {
  buildFromPlanNode,
  fetchDiscussionQueue,
  moveArtifactsToDiscussion,
  resolveDiscussion,
  type ArtifactKind,
  type DesignAudit,
  type DiscussionQueueItem,
  type MoveToDiscussionPayload,
} from '@/lib/atlas-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

interface ArtifactsPaneProps {
  artifacts: UseArtifactsResult
}

type Tab = 'active' | 'discussion'

export function ArtifactsPane({ artifacts }: ArtifactsPaneProps) {
  const navigate = useNavigate()
  const {
    pendingSpecs,
    designAudits,
    openForks,
    loading,
    error,
    resolveFork,
    dismissSpec,
    dismissAudit,
  } = artifacts
  const { traces: workflowTraces } = useWorkflowTraces(30000, 5)

  const total = pendingSpecs.length + designAudits.length + openForks.length + workflowTraces.length

  const [tab, setTab] = useState<Tab>('active')
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Map<string, MoveToDiscussionPayload>>(new Map())
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [discussion, setDiscussion] = useState<DiscussionQueueItem[]>([])
  const [discLoading, setDiscLoading] = useState(false)

  function handleRemediate(audit: DesignAudit) {
    dismissAudit(audit.id)
  }

  const reloadDiscussion = useMemo(() => async () => {
    setDiscLoading(true)
    try {
      const items = await fetchDiscussionQueue()
      setDiscussion(items)
    } catch {
      // ignore — keep prior list
    } finally {
      setDiscLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'discussion') void reloadDiscussion()
  }, [tab, reloadDiscussion])

  function toggleSelect(key: string, payload: MoveToDiscussionPayload) {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, payload)
      return next
    })
  }

  function selectionKey(kind: ArtifactKind, ref: string): string {
    return `${kind}:${ref}`
  }

  async function bulkQueue() {
    if (!selected.size) return
    setBusy(true)
    setActionMsg(null)
    try {
      let queued = 0
      for (const item of selected.values()) {
        const ctx = item.context ?? {}
        const title = (ctx['title'] as string | undefined) ?? `${item.kind}-${item.ref.slice(0, 8)}`
        const body = (ctx['body'] as string | undefined) ?? JSON.stringify(ctx).slice(0, 600)
        await buildFromPlanNode(title, body, item.kind)
        queued++
      }
      setActionMsg(`Queued ${queued} spec${queued === 1 ? '' : 's'}`)
      setSelected(new Map())
      setMultiSelect(false)
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function bulkDismiss() {
    if (!selected.size) return
    for (const item of selected.values()) {
      if (item.kind === 'pending_spec') dismissSpec(item.ref)
      if (item.kind === 'design_audit') dismissAudit(item.ref)
    }
    setActionMsg(`Dismissed ${selected.size}`)
    setSelected(new Map())
    setMultiSelect(false)
  }

  function bulkDiscuss() {
    if (!selected.size) return
    const summary = Array.from(selected.values())
      .map(it => {
        const ctx = it.context ?? {}
        const title = (ctx['title'] as string | undefined) ?? `${it.kind}:${it.ref.slice(0, 8)}`
        return `- [${it.kind}] ${title}`
      })
      .join('\n')
    const msg = `Let's review these ${selected.size} artifacts:\n\n${summary}\n\nWhat do you want to do?`
    navigate(`/atlas?prefill=${encodeURIComponent(msg)}`)
  }

  async function bulkMoveToDiscussion() {
    if (!selected.size) return
    setBusy(true)
    setActionMsg(null)
    try {
      const result = await moveArtifactsToDiscussion(Array.from(selected.values()))
      setActionMsg(`Moved ${result.inserted} to discussion queue`)
      setSelected(new Map())
      setMultiSelect(false)
      void reloadDiscussion()
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] xl:h-[calc(100vh-7rem)] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab('active')}
            className={cn(
              'text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded',
              tab === 'active' ? 'text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800' : 'text-slate-500 hover:text-slate-700',
            )}
            aria-pressed={tab === 'active'}
          >
            Active artifacts
          </button>
          <button
            type="button"
            onClick={() => setTab('discussion')}
            className={cn(
              'text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded',
              tab === 'discussion' ? 'text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800' : 'text-slate-500 hover:text-slate-700',
            )}
            aria-pressed={tab === 'discussion'}
          >
            Discussion ({discussion.length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'active' && total > 0 && (
            <Button
              size="xs"
              variant={multiSelect ? 'default' : 'outline'}
              aria-pressed={multiSelect}
              onClick={() => {
                setMultiSelect(v => !v)
                if (multiSelect) setSelected(new Map())
              }}
            >
              <CheckSquare className="size-3" />
              {multiSelect ? 'Cancel' : 'Multi-select'}
            </Button>
          )}
          {tab === 'active' && total > 0 && (
            <span className="text-[11px] tabular-nums text-slate-500">
              {total} pending
            </span>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className="text-[11px] px-4 py-1.5 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 border-b border-emerald-200/40">
          {actionMsg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === 'active' && (
          <>
            {loading && total === 0 && (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}

            {!loading && total === 0 && !error && (
              <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
                <span className="grid place-items-center size-10 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  <CheckCircle2 className="size-5" />
                </span>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">All clear</p>
                <p className="text-xs text-slate-500 max-w-[200px]">
                  No pending drafts, audits, or open forks waiting for you.
                </p>
              </div>
            )}

            {pendingSpecs.length > 0 && (
              <ArtifactGroup title="Pending specs" count={pendingSpecs.length} icon={Inbox}>
                {pendingSpecs.map((spec) => (
                  <SelectableWrap
                    key={spec.id}
                    visible={multiSelect}
                    selected={selected.has(selectionKey('pending_spec', spec.id))}
                    onToggle={() =>
                      toggleSelect(selectionKey('pending_spec', spec.id), {
                        kind: 'pending_spec',
                        ref: spec.id,
                        context: { title: spec.filename, body: spec.spec_markdown.slice(0, 800) },
                      })
                    }
                  >
                    <PendingSpecCard spec={spec} onDismiss={dismissSpec} />
                  </SelectableWrap>
                ))}
              </ArtifactGroup>
            )}

            {designAudits.length > 0 && (
              <ArtifactGroup title="Designer audits" count={designAudits.length}>
                {designAudits.map((audit) => (
                  <SelectableWrap
                    key={audit.id}
                    visible={multiSelect}
                    selected={selected.has(selectionKey('design_audit', audit.id))}
                    onToggle={() =>
                      toggleSelect(selectionKey('design_audit', audit.id), {
                        kind: 'design_audit',
                        ref: audit.id,
                        context: {
                          title: `${audit.task_id} (${audit.verdict})`,
                          body: JSON.stringify(audit.gaps).slice(0, 800),
                        },
                      })
                    }
                  >
                    <DesignerAuditCard
                      audit={audit}
                      onRemediate={handleRemediate}
                      onDismiss={dismissAudit}
                    />
                  </SelectableWrap>
                ))}
              </ArtifactGroup>
            )}

            {openForks.length > 0 && (
              <ArtifactGroup title="Open forks" count={openForks.length}>
                {openForks.map((fork) => (
                  <SelectableWrap
                    key={fork.id}
                    visible={multiSelect}
                    selected={selected.has(selectionKey('open_fork', fork.id))}
                    onToggle={() =>
                      toggleSelect(selectionKey('open_fork', fork.id), {
                        kind: 'open_fork',
                        ref: fork.id,
                        context: { title: fork.fork_question, body: fork.rationale ?? '' },
                      })
                    }
                  >
                    <OpenForkCard fork={fork} onResolve={resolveFork} />
                  </SelectableWrap>
                ))}
              </ArtifactGroup>
            )}

            {workflowTraces.length > 0 && (
              <ArtifactGroup title="Workflow traces" count={workflowTraces.length}>
                {workflowTraces.map((trace) => (
                  <WorkflowTraceCard key={trace.sha || trace.task_id + trace.shipped_at} trace={trace} />
                ))}
              </ArtifactGroup>
            )}
          </>
        )}

        {tab === 'discussion' && (
          <DiscussionList
            items={discussion}
            loading={discLoading}
            onResolve={async (id, resolution) => {
              try {
                await resolveDiscussion(id, resolution)
                void reloadDiscussion()
              } catch {
                /* ignore */
              }
            }}
          />
        )}
      </div>

      {tab === 'active' && multiSelect && selected.size > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500 mr-auto">{selected.size} selected</span>
          <Button size="xs" onClick={() => void bulkQueue()} disabled={busy}>
            Queue all
          </Button>
          <Button size="xs" variant="outline" onClick={bulkDismiss} disabled={busy}>
            Dismiss all
          </Button>
          <Button size="xs" variant="outline" onClick={bulkDiscuss} disabled={busy}>
            <MessagesSquare className="size-3" />
            Discuss all
          </Button>
          <Button size="xs" variant="outline" onClick={() => void bulkMoveToDiscussion()} disabled={busy}>
            Move to Discussion
          </Button>
        </div>
      )}
    </div>
  )
}

interface SelectableWrapProps {
  visible: boolean
  selected: boolean
  onToggle: () => void
  children: React.ReactNode
}

function SelectableWrap({ visible, selected, onToggle, children }: SelectableWrapProps) {
  if (!visible) return <>{children}</>
  return (
    <div
      className={cn(
        'relative rounded-lg transition-all',
        selected && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950',
      )}
    >
      <Checkbox
        checked={selected}
        onChange={onToggle}
        className="absolute top-2 left-2 z-10 bg-white dark:bg-slate-900"
        aria-label="Select for bulk action"
      />
      <div className="pl-7">{children}</div>
    </div>
  )
}

interface ArtifactGroupProps {
  title: string
  count: number
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}

function ArtifactGroup({ title, count, children }: ArtifactGroupProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
        {title} <span className="tabular-nums">({count})</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

interface DiscussionListProps {
  items: DiscussionQueueItem[]
  loading: boolean
  onResolve: (id: string, resolution: 'queued' | 'dismissed' | 'forked') => void
}

function DiscussionList({ items, loading, onResolve }: DiscussionListProps) {
  if (loading && items.length === 0) {
    return <div className="text-xs text-slate-400 p-3">Loading discussion queue…</div>
  }
  if (items.length === 0) {
    return (
      <div className="text-xs text-slate-400 p-3">
        Nothing parked here yet. Use Move to Discussion on the active list to defer items.
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {items.map(item => {
        const ctx = item.context ?? {}
        const title = (ctx['title'] as string | undefined) ?? `${item.artifact_kind}:${item.artifact_ref.slice(0, 8)}`
        return (
          <li
            key={item.id}
            className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {item.artifact_kind} · {new Date(item.created_at).toLocaleString()}
                </div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {title}
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Button size="xs" onClick={() => onResolve(item.id, 'queued')}>
                Queue
              </Button>
              <Button size="xs" variant="outline" onClick={() => onResolve(item.id, 'dismissed')}>
                Dismiss
              </Button>
              <Button size="xs" variant="outline" onClick={() => onResolve(item.id, 'forked')}>
                Mark forked
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
