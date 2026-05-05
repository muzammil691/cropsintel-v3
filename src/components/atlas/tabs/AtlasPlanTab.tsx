import { useEffect, useMemo, useState } from 'react'
import { Layers, RefreshCw, ListTree, Network, CheckSquare, X } from 'lucide-react'
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
import { PlanGraphView } from '@/components/atlas-plan/PlanGraphView'

type ViewMode = 'tree' | 'graph'

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

// Phase A.4: locate a PlanNode by id anywhere in the tree. Used by bulk
// operations to translate the selectedIds Set into actual PlanNode objects.
function findNodeById(root: PlanNode, targetId: string): PlanNode | null {
  if (root.id === targetId) return root
  for (const child of root.children) {
    const hit = findNodeById(child, targetId)
    if (hit) return hit
  }
  return null
}

// Phase A.4: tiny worker-pool that runs `task(item)` for each item with a
// concurrency cap of 3 (matches the batch-diagnose pattern in
// AtlasArtifactsTab so we don't slam Atlas's API). Returns counts of
// successes vs failures so the UI can toast a single summary line.
async function runWithConcurrency<T>(
  items: T[],
  task: (item: T) => Promise<unknown>,
  concurrency = 3,
): Promise<{ ok: number; failed: number; errors: string[] }> {
  let ok = 0
  let failed = 0
  const errors: string[] = []
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor++
      try {
        await task(items[idx])
        ok++
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        if (errors.length < 5) errors.push(msg.slice(0, 160))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()))
  return { ok, failed, errors }
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
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  // Phase A.2/A.5 state-overlay sets. Declared up front so load() can
  // populate them without a use-before-declare warning.
  const [voidedIds, setVoidedIds] = useState<Set<string>>(new Set())
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set())
  const [shippedIds] = useState<Set<string>>(new Set())

  const load = () => {
    setLoading(true)
    setError(null)
    fetchPlan()
      .then((res) => {
        setTree(res.tree)
        // Phase A.5: paint state overlays from server. nodeStates is
        // map<plan_node_id, string[]> — each id can carry multiple
        // active states (queued-no-build + suggested-by-X simultaneously).
        const states = res.nodeStates ?? {}
        const newVoided = new Set<string>()
        const newQueued = new Set<string>()
        const newSuggested = new Set<string>()
        for (const [id, list] of Object.entries(states)) {
          if (list.includes('voided')) newVoided.add(id)
          if (list.includes('queued-no-build')) newQueued.add(id)
          if (list.includes('suggested-by-multi-brain') || list.includes('suggested-by-verifier')) {
            newSuggested.add(id)
          }
        }
        setVoidedIds(newVoided)
        setQueuedIds(newQueued)
        setSuggestedIds(newSuggested)
      })
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
    // Backend route /atlas/plan/change-phase is live (A.2). A target-phase
    // picker UI is a future polish; for now surface a hint so the action
    // doesn't silently no-op.
    setError('Change phase: backend ready, target-picker UI pending. Use Move up/down or chat to relocate for now.')
  }

  // ─── Phase A.4 — multi-select + bulk operations ───────────────────────────
  const selectedNodes: PlanNode[] = useMemo(() => {
    if (!tree || selectedIds.size === 0) return []
    const out: PlanNode[] = []
    for (const id of selectedIds) {
      const found = findNodeById(tree, id)
      if (found) out.push(found)
    }
    return out
  }, [tree, selectedIds])

  const clearSelection = () => setSelectedIds(new Set())

  const runBulk = async (
    label: string,
    nodes: PlanNode[],
    task: (n: PlanNode) => Promise<unknown>,
  ) => {
    if (nodes.length === 0) return
    setBulkBusy(true)
    setBulkResult(null)
    setError(null)
    const result = await runWithConcurrency(nodes, task, 3)
    setBulkBusy(false)
    setBulkResult(
      result.failed > 0
        ? `${label}: ${result.ok}/${nodes.length} succeeded; ${result.failed} failed (${result.errors[0] ?? 'see console'})`
        : `${label}: ${result.ok}/${nodes.length} succeeded.`,
    )
    load()
  }

  const onBulkAddToQueue = () => void runBulk('Queue', selectedNodes, n =>
    addPlanNodeToQueue(n.id, n.title, n.body ?? '', 'plan').then(() => {
      setQueuedIds(prev => new Set(prev).add(n.id))
    }),
  )

  const onBulkVoid = () => void runBulk('Void', selectedNodes, n =>
    voidPlanNode(n.id).then(() => {
      setVoidedIds(prev => new Set(prev).add(n.id))
    }),
  )

  const onBulkDiscuss = () => {
    if (selectedNodes.length === 0) return
    const seed = [
      `Discuss ${selectedNodes.length} plan nodes with me:`,
      '',
      ...selectedNodes.slice(0, 8).map((n, i) => {
        const excerpt = (n.body ?? '').replace(/\s+/g, ' ').slice(0, 140)
        return `${i + 1}. ${n.title}${excerpt ? `\n   ${excerpt}` : ''}`
      }),
      selectedNodes.length > 8 ? `… and ${selectedNodes.length - 8} more` : '',
      '',
      'Suggest a deploy order based on dependencies + scope. Flag risks.',
    ].filter(Boolean).join('\n')
    window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: seed }))
    setBulkResult(`Discussion seeded with ${selectedNodes.length} nodes — open chat.`)
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
          <div className="flex items-center gap-1 shrink-0">
            {/* Multi-select toggle (Phase A.4) */}
            <Button
              type="button"
              size="sm"
              variant={multiSelectMode ? 'default' : 'ghost'}
              onClick={() => {
                setMultiSelectMode(v => !v)
                if (multiSelectMode) clearSelection()
              }}
              aria-pressed={multiSelectMode}
              className="text-[11px] h-7 px-2 gap-1 transition-colors duration-200"
            >
              <CheckSquare className="size-3" />
              {multiSelectMode ? 'Selecting' : 'Select'}
            </Button>
            {/* Tree ↔ Graph view toggle (Phase A.3) */}
            <div role="tablist" aria-label="View mode" className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'tree' ? 'true' : 'false'}
                onClick={() => setViewMode('tree')}
                className={cn(
                  'px-2 py-1 text-[11px] font-medium inline-flex items-center gap-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-inset',
                  viewMode === 'tree'
                    ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <ListTree className="size-3" /> Tree
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'graph' ? 'true' : 'false'}
                onClick={() => setViewMode('graph')}
                className={cn(
                  'px-2 py-1 text-[11px] font-medium inline-flex items-center gap-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-inset border-l border-slate-200 dark:border-slate-700',
                  viewMode === 'graph'
                    ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <Network className="size-3" /> Graph
              </button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={load}
              disabled={loading}
              className="shrink-0 text-xs min-h-11 sm:min-h-0 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50"
            >
              <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              <span className="sr-only">Refresh plan</span>
            </Button>
          </div>
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

      {/* Phase A.4 — bulk action bar. Shown when multi-select mode is on AND
          at least one node is selected. Buttons fan out concurrency=3. */}
      {multiSelectMode && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/60 dark:bg-emerald-950/30">
          <span className="text-[11px] font-medium text-emerald-900 dark:text-emerald-200 mr-1">
            {selectedIds.size} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={onBulkAddToQueue}
            className="text-[11px] h-7 px-2 transition-colors duration-200"
          >
            Add all to queue
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={onBulkVoid}
            className="text-[11px] h-7 px-2 transition-colors duration-200"
          >
            Void all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={onBulkDiscuss}
            className="text-[11px] h-7 px-2 transition-colors duration-200"
          >
            Discuss all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={clearSelection}
            className="ml-auto text-[11px] h-7 px-2 transition-colors duration-200"
          >
            <X className="size-3" /> Clear
          </Button>
        </div>
      )}
      {bulkResult && (
        <div role="status" aria-live="polite" className="px-3 sm:px-4 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/40 dark:bg-emerald-950/20">
          {bulkResult}
        </div>
      )}

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
        {tree && viewMode === 'tree' && (
          <PlanTree
            root={tree}
            selectedId={selectedId}
            onSelect={(n) => setSelectedId(n.id)}
            multiSelect={multiSelectMode}
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
            suggestedIds={suggestedIds}
          />
        )}
        {tree && viewMode === 'graph' && (
          <PlanGraphView
            root={tree}
            selectedId={selectedId}
            onSelect={(n) => setSelectedId(n.id)}
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
