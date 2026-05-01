import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlanTree, type SpecStatus } from '@/components/atlas-plan/PlanTree'
import { PlanNodeDetail } from '@/components/atlas-plan/PlanNodeDetail'
import { PlanToolbar } from '@/components/atlas-plan/PlanToolbar'
import {
  amendPlan,
  buildFromPlanNode,
  fetchPlan,
  moveArtifactsToDiscussion,
  reorderPlan,
  uploadPlan,
  type PlanNode,
  type PlanResponse,
} from '@/lib/atlas-client'

function findParentAndSiblings(
  root: PlanNode,
  id: string,
): { parent: PlanNode | null; siblings: PlanNode[]; index: number } | null {
  for (const child of root.children) {
    if (child.id === id) {
      return { parent: root, siblings: root.children, index: root.children.indexOf(child) }
    }
    const inner = findParentAndSiblings(child, id)
    if (inner) return inner
  }
  return null
}

function findById(root: PlanNode, id: string): PlanNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const r = findById(child, id)
    if (r) return r
  }
  return null
}

export default function AtlasPlan() {
  const navigate = useNavigate()
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await fetchPlan()
      setPlan(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Status map: shipped/queued/planned/blocked by fuzzy title match.
  // For now this is a heuristic surface — any title containing "phase-1.10ak"
  // etc. flags as queued/done by checking the plan's body for status keywords.
  const statusByTitle = useMemo<Map<string, SpecStatus>>(() => {
    const map = new Map<string, SpecStatus>()
    if (!plan) return map
    function walk(node: PlanNode): void {
      const lower = node.title.toLowerCase()
      const body = node.body.toLowerCase()
      if (lower.includes('shipped') || body.includes('✅') || body.includes('shipped in')) {
        map.set(lower, 'shipped')
      } else if (lower.includes('queued') || body.includes('queued')) {
        map.set(lower, 'queued')
      } else if (lower.includes('blocked') || body.includes('❌')) {
        map.set(lower, 'blocked')
      } else {
        map.set(lower, 'planned')
      }
      node.children.forEach(walk)
    }
    walk(plan.tree)
    return map
  }, [plan])

  const selectedNode = useMemo(() => {
    if (!plan || !selectedId) return null
    return findById(plan.tree, selectedId)
  }, [plan, selectedId])

  const onMove = useCallback(
    async (movedId: string, parentId: string, newIndex: number) => {
      setBusy(true)
      setError(null)
      try {
        await reorderPlan(movedId, parentId, newIndex)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const onMoveUp = useCallback(
    (node: PlanNode) => {
      if (!plan) return
      const ctx = findParentAndSiblings(plan.tree, node.id)
      if (!ctx || ctx.index <= 0) return
      const parentId = ctx.parent ? ctx.parent.id : 'root'
      void onMove(node.id, parentId, ctx.index - 1)
    },
    [plan, onMove],
  )

  const onMoveDown = useCallback(
    (node: PlanNode) => {
      if (!plan) return
      const ctx = findParentAndSiblings(plan.tree, node.id)
      if (!ctx || ctx.index >= ctx.siblings.length - 1) return
      const parentId = ctx.parent ? ctx.parent.id : 'root'
      void onMove(node.id, parentId, ctx.index + 1)
    },
    [plan, onMove],
  )

  const onBuildNow = useCallback(async (node: PlanNode) => {
    setBusy(true)
    setError(null)
    try {
      await buildFromPlanNode(node.title, node.body, `plan-${node.id}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const onDiscuss = useCallback((node: PlanNode) => {
    const message = `Let's discuss: ${node.title}\n\n${node.body.slice(0, 500)}`
    navigate(`/atlas?prefill=${encodeURIComponent(message)}`)
  }, [navigate])

  const onSaveBody = useCallback(async (node: PlanNode, newBody: string) => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      await amendPlan(`Update the body of "${node.title}" (line ${node.source.line}) to:\n\n${newBody}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [plan, refresh])

  const onUpload = useCallback(async (markdown: string) => {
    setBusy(true)
    setError(null)
    try {
      await uploadPlan(markdown)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const onAmend = useCallback(async (instruction: string) => {
    setBusy(true)
    setError(null)
    try {
      await amendPlan(instruction)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const onToggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectedNodes = useMemo(() => {
    if (!plan) return []
    return Array.from(selectedIds).map(id => findById(plan.tree, id)).filter((n): n is PlanNode => !!n)
  }, [plan, selectedIds])

  const onBuildSelected = useCallback(async () => {
    if (!selectedNodes.length) return
    setBusy(true)
    setError(null)
    try {
      for (const n of selectedNodes) {
        await buildFromPlanNode(n.title, n.body, `plan-${n.id}`)
      }
      setSelectedIds(new Set())
      setMultiSelect(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [selectedNodes, refresh])

  const onDiscussSelected = useCallback(() => {
    if (!selectedNodes.length) return
    const summary = selectedNodes.map(n => `- ${n.title}`).join('\n')
    const msg = `Let's discuss these ${selectedNodes.length} plan items:\n\n${summary}\n\nWhat do you want to do with them?`
    navigate(`/atlas?prefill=${encodeURIComponent(msg)}`)
  }, [selectedNodes, navigate])

  const onMoveSelectedToQueue = useCallback(async () => {
    if (!selectedNodes.length) return
    setBusy(true)
    setError(null)
    try {
      await moveArtifactsToDiscussion(
        selectedNodes.map(n => ({
          kind: 'plan_node',
          ref: n.id,
          context: { title: n.title, body: n.body.slice(0, 1000), level: n.level },
        })),
      )
      setSelectedIds(new Set())
      setMultiSelect(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [selectedNodes])

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-3">
        <Link to="/atlas">
          <Button size="icon-sm" variant="ghost" aria-label="Back to Atlas">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <FileText className="size-4 text-emerald-600" />
          <h1 className="text-sm font-semibold">Atlas plan tree</h1>
        </div>
        <div className="text-[11px] text-slate-500 ml-2 truncate">
          {plan ? `HEAD ${plan.sha.slice(0, 7)} · ${plan.flat.length} nodes` : 'Loading…'}
        </div>
      </header>

      <PlanToolbar
        onUpload={onUpload}
        onAmend={onAmend}
        multiSelect={multiSelect}
        onToggleMultiSelect={() => setMultiSelect(v => !v)}
        onRefresh={() => void refresh()}
        busy={busy}
        selectionCount={selectedIds.size}
        onBuildSelected={() => void onBuildSelected()}
        onDiscussSelected={onDiscussSelected}
        onMoveSelectedToQueue={() => void onMoveSelectedToQueue()}
      />

      {error && (
        <div className="mx-4 my-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 p-3 overflow-hidden">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-y-auto">
          {plan ? (
            <PlanTree
              root={plan.tree}
              selectedId={selectedId}
              onSelect={(n) => setSelectedId(n.id)}
              multiSelect={multiSelect}
              selectedIds={selectedIds}
              onToggleSelected={onToggleSelected}
              statusByTitle={statusByTitle}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onBuildNow={(n) => void onBuildNow(n)}
              onDiscuss={onDiscuss}
            />
          ) : (
            <div className="p-6 text-sm text-slate-500">Loading plan…</div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
          <PlanNodeDetail
            node={selectedNode}
            onSave={onSaveBody}
            onCancel={() => setSelectedId(null)}
            onBuildNow={(n) => void onBuildNow(n)}
            onDiscuss={onDiscuss}
            busy={busy}
          />
        </div>
      </div>
    </div>
  )
}
