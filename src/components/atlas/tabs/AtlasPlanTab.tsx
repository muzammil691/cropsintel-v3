import { useEffect, useMemo, useState } from 'react'
import { Layers, RefreshCw } from 'lucide-react'
import { fetchPlan, buildFromPlanNode, type PlanNode } from '@/lib/atlas-client'
import { Button } from '@/components/ui/button'
import { PlanTree, type SpecStatus } from '@/components/atlas-plan/PlanTree'

export default function AtlasPlanTab() {
  const [tree, setTree] = useState<PlanNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [busyNode, setBusyNode] = useState<string | null>(null)

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

  return (
    <section className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 shrink-0">
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
          aria-label="Refresh plan"
          className="shrink-0 text-xs min-h-[44px] sm:min-h-0 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-600/50"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
          <span className="sr-only">Refresh plan</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-slate-50/40 dark:bg-slate-900/20">
        {loading && !tree && (
          <div className="text-xs text-slate-500 text-center py-12">Loading plan…</div>
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
            onMoveUp={() => {}}
            onMoveDown={() => {}}
            onBuildNow={onBuild}
            onDiscuss={() => {}}
          />
        )}
        {busy && busyNode && (
          <div className="mt-2 text-[11px] text-slate-500">Queueing spec for {busyNode}…</div>
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
