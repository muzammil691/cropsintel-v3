import { useEffect, useState } from 'react'
import { Search, X, RefreshCw, ExternalLink } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import { AgentPipeline } from '../workflow/AgentPipeline'
import { WorkflowGraph as WorkflowGraphView } from '@/components/atlas-workflow/WorkflowGraph'
import { NodeDetailDrawer } from '@/components/atlas-workflow/NodeDetailDrawer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  fetchWorkflowGraph,
  refreshWorkflowGraph,
  buildFromPlanNode,
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

const MASTER_PLAN_URL = 'https://github.com/cropsintel/cropsintel-v3/blob/main/.agent/master-plan.md'

export default function AtlasWorkflowTab({ status, onOpenAgents, heartbeats }: AtlasWorkflowTabProps) {
  const [graph, setGraph] = useState<WorkflowGraph | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphLoading, setGraphLoading] = useState(true)
  const [openNode, setOpenNode] = useState<WorkflowGraphNode | null>(null)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    let aborted = false
    async function load() {
      setGraphLoading(true)
      try {
        const g = await fetchWorkflowGraph()
        if (!cancelled) {
          setGraph(g)
          setGraphError(null)
        }
      } catch (err) {
        if (!cancelled) setGraphError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setGraphLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      aborted = true
      void aborted
    }
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await refreshWorkflowGraph().catch(() => null)
      const g = await fetchWorkflowGraph()
      setGraph(g)
      setGraphError(null)
    } catch (err) {
      setGraphError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  async function handleBuild(node: WorkflowGraphNode) {
    try {
      await buildFromPlanNode(node.title, node.description ?? '', 'workflow')
    } catch (err) {
      console.warn('[AtlasWorkflowTab] build failed:', err)
    } finally {
      setOpenNode(null)
    }
  }

  function handleDiscuss(node: WorkflowGraphNode) {
    const seed = `Let's discuss workflow: ${node.title}.\n\n${node.description?.slice(0, 400) ?? ''}`
    window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: seed }))
    setOpenNode(null)
  }

  // Empty/error state — only show when both fetch + (implied) baseline failed.
  // Server returns baseline-fallback graph on doc parse failure, so a true
  // empty/error state requires a network/auth failure.
  const showEmptyState = !graphLoading && !graph && graphError

  return (
    <TabFrame
      title="Workflows"
      hint="8-agent pipeline up top, 15 commodity workflows × 8 departments below."
    >
      <div className="space-y-4">
        {/* Search above the diagrams. Filters node titles in real-time;
            matches highlight in emerald, non-matches dim to 30%. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter workflows, departments, models…"
              className="pl-8 pr-8 h-8 text-sm"
              aria-label="Filter workflow graph"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Clear filter"
              >
                <X className="size-3.5 text-slate-400" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Re-parse MAXONS_Workflow_v1.md"
          >
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </Button>
        </div>

        {/* Top: Agent pipeline. Independent of workflow-graph fetch — never
            blocked by graph load/error. */}
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
          {showEmptyState && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-900 dark:text-amber-100">
              <p className="font-medium mb-1">🚧 Workflow data unavailable</p>
              <p className="text-xs leading-relaxed mb-3">
                Atlas couldn't parse <code>docs/MAXONS_Workflow_v1.md</code>. The agent pipeline
                above still works. Re-run the parser via the refresh button or open the master
                plan to verify the workflow doc is intact.
              </p>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mb-3 truncate">
                {graphError}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={MASTER_PLAN_URL} target="_blank" rel="noopener noreferrer">
                    Open master plan
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
                <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
                  Retry parse
                </Button>
              </div>
            </div>
          )}
          {graph && (
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
              <WorkflowGraphView graph={graph} onNodeOpen={setOpenNode} query={query} />
            </div>
          )}
        </section>
      </div>

      {openNode && (
        <NodeDetailDrawer
          node={openNode}
          onClose={() => setOpenNode(null)}
          onBuild={handleBuild}
          onDiscuss={handleDiscuss}
        />
      )}
    </TabFrame>
  )
}
