import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Workflow as WorkflowIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowGraph } from '@/components/atlas-workflow/WorkflowGraph'
import { NodeDetailDrawer } from '@/components/atlas-workflow/NodeDetailDrawer'
import {
  buildFromPlanNode,
  fetchWorkflowGraph,
  type WorkflowGraph as Graph,
  type WorkflowGraphNode,
} from '@/lib/atlas-client'

export default function AtlasWorkflow() {
  const navigate = useNavigate()
  const [graph, setGraph] = useState<Graph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drawerNode, setDrawerNode] = useState<WorkflowGraphNode | null>(null)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    fetchWorkflowGraph()
      .then(g => {
        if (!cancelled) setGraph(g)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => { cancelled = true }
  }, [])

  const onBuild = useCallback(async (node: WorkflowGraphNode) => {
    try {
      await buildFromPlanNode(node.title, node.description, `wf-${node.meta?.number ?? node.id}`)
      setDrawerNode(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const onDiscuss = useCallback((node: WorkflowGraphNode) => {
    const msg = `Let's discuss workflow: ${node.title}\n\n${node.description.slice(0, 500)}`
    navigate(`/atlas?prefill=${encodeURIComponent(msg)}`)
  }, [navigate])

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-3">
        <Link to="/atlas">
          <Button size="icon-sm" variant="ghost" aria-label="Back to Atlas">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <WorkflowIcon className="size-4 text-emerald-600" />
          <h1 className="text-sm font-semibold">Almond-trade workflow</h1>
        </div>
        <div className="text-[11px] text-slate-500 ml-2 truncate">
          {graph ? `${graph.nodes.length} nodes` : busy ? 'Loading…' : ''}
        </div>
      </header>

      {error && (
        <div className="mx-4 my-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4">
        {graph ? (
          <WorkflowGraph graph={graph} onNodeOpen={setDrawerNode} />
        ) : (
          <div className="text-sm text-slate-500">Loading workflow graph…</div>
        )}
      </main>

      <NodeDetailDrawer
        node={drawerNode}
        onClose={() => setDrawerNode(null)}
        onBuild={(n) => void onBuild(n)}
        onDiscuss={onDiscuss}
      />
    </div>
  )
}
