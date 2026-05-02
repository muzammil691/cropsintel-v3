import { useEffect, useState } from 'react'
import { TabFrame } from './AtlasPlanTab'
import { AgentPipeline } from '../workflow/AgentPipeline'
import { WorkflowGraph as WorkflowGraphView } from '@/components/atlas-workflow/WorkflowGraph'
import { NodeDetailDrawer } from '@/components/atlas-workflow/NodeDetailDrawer'
import {
  fetchWorkflowGraph,
  type AtlasStatus,
  type WorkflowGraph,
  type WorkflowGraphNode,
  type AgentHeartbeat,
} from '@/lib/atlas-client'

interface AtlasWorkflowTabProps {
  status: AtlasStatus | null
  onOpenAgents: () => void
  heartbeats?: Record<string, AgentHeartbeat>
}

export default function AtlasWorkflowTab({ status, onOpenAgents, heartbeats }: AtlasWorkflowTabProps) {
  const [graph, setGraph] = useState<WorkflowGraph | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphLoading, setGraphLoading] = useState(true)
  const [openNode, setOpenNode] = useState<WorkflowGraphNode | null>(null)

  useEffect(() => {
    let cancelled = false
    setGraphLoading(true)
    fetchWorkflowGraph()
      .then(g => {
        if (!cancelled) {
          setGraph(g)
          setGraphError(null)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setGraphError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <TabFrame
      title="Workflows"
      hint="7-agent pipeline up top, 15 commodity workflows × 8 departments below."
    >
      <div className="space-y-4">
        <AgentPipeline status={status} onOpenAgents={onOpenAgents} heartbeats={heartbeats} />

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Commodity trade workflow graph
          </h3>
          {graphLoading && !graph && (
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 text-xs text-slate-500">
              Loading workflow graph…
            </div>
          )}
          {graphError && !graph && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <p className="font-medium">Workflow graph unavailable.</p>
              <p className="mt-0.5">
                Master plan §1.8 specifies 15 workflows × 8 departments — graph data pending.
              </p>
              <p className="mt-1 text-[10px] text-amber-700/70 dark:text-amber-300/70 truncate">
                {graphError}
              </p>
            </div>
          )}
          {graph && (
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
              <WorkflowGraphView graph={graph} onNodeOpen={setOpenNode} />
            </div>
          )}
        </section>
      </div>

      {openNode && (
        <NodeDetailDrawer
          node={openNode}
          onClose={() => setOpenNode(null)}
          onBuild={() => setOpenNode(null)}
          onDiscuss={() => setOpenNode(null)}
        />
      )}
    </TabFrame>
  )
}
