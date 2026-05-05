import { useEffect, useMemo, useState } from 'react'
import { Layers, RefreshCw } from 'lucide-react'
import {
  fetchPlan,
  buildFromPlanNode,
  reorderPlan,
  voidPlanNode,
  recoverPlanNode,
  undeployPlanNode,
  addPlanNodeToQueue,
  type PlanNode,
} from '@/lib/atlas-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PlanTree, type SpecStatus } from '@/components/atlas-plan/PlanTree'

type StatusFilter = 'all' | SpecStatus

const FILTER_PILLS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'queued', label: 'Queued' },
  { key: 'planned', label: 'Planned' },
  { key: 'blocked', label: 'Blocked' },
]

// Walk the tree to find a node's parent and its index in parent.children.
// Returns null when not found or for the root (which has no parent in the
// reorder API's sense).
function findParentAndIndex(
  root: PlanNode,
  targetId: string,
): { parent: PlanNode; index: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === targetId) {
      return { parent: root, index: i }
    }
    const found = findParentAndIndex(root.children[i], targetId)
    if (found) return found
  }
  return null
}

// Count how many nodes in the (sub)tree have each status. Used to populate
// the count pills in the filter bar.
function countByStatus(node: PlanNode, infer: (n: PlanNode) => SpecStatus): Record<SpecStatus, number> {
  const out: Record<SpecStatus, number> = { shipped: 0, queued: 0, planned: 0, blocked: 0 }
  function walk(n: PlanNode): void {
    out[infer(n)]++
    for (const c of n.children) walk(c)
  }
  for (const c of node.children) walk(c)
  return out
}

export default function AtlasPlanTab() {
  const [tree, setTree] = useState<PlanNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [busyNode, setBusyNode] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const load = () => {
    setLoading(true)
    setError(null)
    fetchPlan()
      .then((res) => setTree(res.tree))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const statusByTitle = useMemo(() => new Map<string, SpecStatus>(), [])

  // Same status inference as PlanTree uses internally — duplicated here so
  // we can compute counts + filtering at the parent level. Stays in sync with
  // PlanTree's inferStatus by sharing the statusByTitle map.
  const inferStatus = useMemo(() => {
    return (n: PlanNode): SpecStatus => {
      const norm = n.title.toLowerCase()
      for (const [key, status] of statusByTitle.entries()) {
        if (norm.includes(key) || key.includes(norm)) return status
      }
      return 'planned'
    }
  }, [statusByTitle])

  const counts = useMemo(() => {
    if (!tree) return { shipped: 0, queued: 0, planned: 0, blocked: 0 } as Record<SpecStatus, number>
    return countByStatus(tree, inferStatus)
  }, [tree, inferStatus])

  const onBuild = async (node: PlanNode) => {
    setBusy(true)
    setBusyNode(node.id)
    try {
      await buildFromPlanNode(node.title, node.body ?? '', 'plan')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setBusyNode(null)
    }
  }

  const reorder = async (node: PlanNode, direction: 'up' | 'down') => {
    if (!tree) return
    const found = findParentAndIndex(tree, node.id)
    if (!found) {
      setError(`Could not locate ${node.title} in the plan tree`)
      return
    }
    const { parent, index } = found
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= parent.children.length) return // edge of siblings
    setBusy(true)
    setBusyNode(node.id)
    try {
      await reorderPlan(node.id, parent.id, newIndex)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setBusyNode(null)
    }
  }

  const onMoveUp = (node: PlanNode) => void reorder(node, 'up')
  const onMoveDown = (node: PlanNode) => void reorder(node, 'down')

  // Phase A.2 state-mutation handlers. Each: set busy → call client → reload
  // → clear busy. Errors surface in the existing red banner. Optimistic UI
  // (toggling voidedIds / queuedIds locally before reload) is intentionally
  // skipped — the round-trip is fast and a stale view is worse than 1 sec
  // of "loading" feedback.
  const [voidedIds, setVoidedIds] = useState<Set<string>>(new Set())
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())
  const [shippedIds] = useState<Set<string>>(new Set()) // populated in A.5 from build_attempts

  const runWithBusy = async (node: PlanNode, fn: () => Promise<unknown>) => {
    setBusy(true)
    setBusyNode(node.id)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setBusyNode(null)
    }
  }

  const onVoid = (node: PlanNode) => void runWithBusy(node, async () => {
    await voidPlanNode(node.id)
    setVoidedIds(prev => new Set(prev).add(node.id))
  })

  const onRecover = (node: PlanNode) => void runWithBusy(node, async () => {
    await recoverPlanNode(node.id)
    setVoidedIds(prev => {
      const next = new Set(prev); next.delete(node.id); return next
    })
  })

  const onUndeploy = (node: PlanNode) => void runWithBusy(node, async () => {
    await undeployPlanNode(node.id)
  })

  const onAddToQueue = (node: PlanNode) => void runWithBusy(node, async () => {
    await addPlanNodeToQueue(node.id, node.title, node.body ?? '', 'plan')
    setQueuedIds(prev => new Set(prev).add(node.id))
  })

  const onChangePhase = (_node: PlanNode) => {
    // Phase A.2 ships the backend; the UI picker is part of A.4 (multi-select
    // + bulk operations) where we have a target-phase chooser. For now this
    // surfaces a hint rather than no-op silently.
    setError('Change phase: coming with A.4 (target picker). Backend ready; UI picker pending.')
  }

  const onDiscuss = (node: PlanNode) => {
    // Seed the cockpit chat with the node title + body excerpt so Atlas can
    // discuss this specific phase. CockpitChat listens for this event and
    // pre-fills the input. Existing pattern used by AuditTab.
    const bodyExcerpt = (node.body ?? '').replace(/\s+/g, ' ').slice(0, 600)
    const seed = [
      `Discuss plan node "${node.title}" with me.`,
      '',
      bodyExcerpt ? `Current spec excerpt:\n${bodyExcerpt}` : '(No spec body yet — this is a planning placeholder.)',
      '',
      'Should we deploy it as-is, narrow the scope, or block on a dependency? Recommend.',
    ].join('\n')
    window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: seed }))
  }

  return (
    <section className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Layers className="size-3.5" /> Plan
            </h2>
            <p className="text-[11px] text-slate-500 truncate">
              Knowledge tree of phases, sub-tasks, and ADRs from master plan.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            disabled={loading}
            className="shrink-0 text-xs min-h-[44px] sm:min-h-0 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50"
          >
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
            <span className="sr-only">Refresh plan</span>
          </Button>
        </div>
        {/* Phase A.1: status filter pills. Single-select. Counts come from
            countByStatus() which uses the same status inference as PlanTree. */}
        <div role="tablist" aria-label="Filter plan by status" className="flex flex-wrap items-center gap-1">
          {FILTER_PILLS.map((pill) => {
            const isActive = filter === pill.key
            const count = pill.key === 'all'
              ? counts.shipped + counts.queued + counts.planned + counts.blocked
              : counts[pill.key]
            return (
              <button
                key={pill.key}
                type="button"
                role="tab"
                aria-selected={isActive ? 'true' : 'false'}
                onClick={() => setFilter(pill.key)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                  isActive
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-emerald-400',
                )}
              >
                {pill.label}
                <span className={cn(
                  'tabular-nums text-[10px]',
                  isActive ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400',
                )}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-slate-50/40 dark:bg-slate-900/20">
        {loading && !tree && (
          <div className="space-y-3 p-3">
            <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-6 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {tree && (
          <PlanTree
            root={tree}
            selectedId={selectedId}
            onSelect={(n) => setSelectedId(n.id)}
            multiSelect={false}
            selectedIds={selectedIds}
            onToggleSelected={(id) => {
              setSelectedIds((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }}
            statusByTitle={statusByTitle}
            statusFilter={filter}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onBuildNow={onBuild}
            onDiscuss={onDiscuss}
            onVoid={onVoid}
            onRecover={onRecover}
            onUndeploy={onUndeploy}
            onAddToQueue={onAddToQueue}
            onChangePhase={onChangePhase}
            voidedIds={voidedIds}
            queuedIds={queuedIds}
            shippedIds={shippedIds}
          />
        )}
        {busy && busyNode && (
          <div role="status" aria-live="polite" className="mt-2 text-[11px] text-slate-500">Queueing spec for {busyNode}…</div>
        )}
      </div>
    </section>
  )
}

// Re-exported for sibling tabs (AtlasAgentsTab, AtlasAuditTab, AtlasQueueTab,
// AtlasTeamTab, AtlasArtifactsTab, AtlasWorkflowTab) that still use these
// helpers as their shell. Kept here to avoid an import-shuffle PR.
export function TabFrame({
  title,
  hint,
  rightSlot,
  children,
}: {
  title: string
  hint?: string
  rightSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 shrink-0">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            {title}
          </h2>
          {hint && <p className="text-[11px] text-slate-500 truncate">{hint}</p>}
        </div>
        {rightSlot}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-slate-50/40 dark:bg-slate-900/20">{children}</div>
    </section>
  )
}

export function ComingSoon({
  icon: Icon,
  feature,
  owner,
}: {
  icon: React.ComponentType<{ className?: string }>
  feature: string
  owner: string
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
      <span className="grid place-items-center size-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <Icon className="size-6" />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{feature}</p>
        <p className="text-xs text-slate-500 mt-0.5">Coming soon — ships in {owner}.</p>
      </div>
      <div className="grid grid-cols-3 gap-1.5 w-full max-w-xs">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
