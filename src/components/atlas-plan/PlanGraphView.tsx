// Phase A.3 of Pillar A — ReactFlow architecture graph view.
//
// Renders the master-plan tree as a free-form node graph with auto-layout
// so the user can SEE phases laid out horizontally and click any node to
// open the action panel docked on the right. Pairs with the existing
// vertical PlanTree via a toggle in AtlasPlanTab.
//
// Layout strategy: simple breadth-first columnar layout — root's children
// in column 1, their children in column 2, etc. Y-positions distributed
// evenly per column. ReactFlow handles dragging / zooming / fit-to-screen.
//
// We deliberately don't auto-layout on every re-render — only on mount and
// when the tree's id-set changes — because manual node positions (when the
// user drags) should persist within a session.

import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeChange,
  applyNodeChanges,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { cn } from '@/lib/utils'
import type { PlanNode } from '@/lib/atlas-client'
import type { SpecStatus } from './PlanTree'
import { PlanNodeActions, type PlanNodeActionHandlers } from './PlanNodeActions'

interface PlanGraphViewProps extends PlanNodeActionHandlers {
  root: PlanNode
  selectedId: string | null
  onSelect: (node: PlanNode) => void
  statusByTitle: Map<string, SpecStatus>
  /** Filter: 'all' or a specific status. Non-matching nodes dim to 30% opacity. */
  statusFilter?: 'all' | SpecStatus
  /** Free-text filter — same dimming behavior as statusFilter. */
  query?: string
  /** Sets used by PlanNodeActions to swap Recover↔Void / hide Add-to-queue / show Undeploy. */
  voidedIds?: Set<string>
  queuedIds?: Set<string>
  shippedIds?: Set<string>
}

// Status → background color class for graph nodes. Matches the dot palette
// used in PlanTree so the two views stay visually consistent.
const STATUS_BG: Record<SpecStatus, string> = {
  shipped: 'bg-emerald-50 border-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800',
  queued: 'bg-amber-50 border-amber-400 dark:bg-amber-950/40 dark:border-amber-800',
  planned: 'bg-slate-50 border-slate-300 dark:bg-slate-900 dark:border-slate-700',
  blocked: 'bg-rose-50 border-rose-400 dark:bg-rose-950/40 dark:border-rose-800',
}

const COL_WIDTH = 240
const ROW_HEIGHT = 96

// Walk the tree breadth-first; assign each node an (x, y) by column depth.
// Returns flat arrays of nodes + edges suitable for ReactFlow.
function layoutTree(
  root: PlanNode,
  inferStatus: (n: PlanNode) => SpecStatus,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  // Per-column y cursor — counts how many nodes have already been placed in
  // each column, so the next one drops below.
  const yByCol = new Map<number, number>()

  function place(node: PlanNode, depth: number, parentId: string | null): void {
    const y = yByCol.get(depth) ?? 0
    yByCol.set(depth, y + 1)
    const status = inferStatus(node)
    nodes.push({
      id: node.id,
      type: 'default',
      position: { x: depth * COL_WIDTH, y: y * ROW_HEIGHT },
      data: { label: node.title, status, planNode: node },
      className: cn('plan-graph-node', STATUS_BG[status]),
    })
    if (parentId) {
      edges.push({
        id: `${parentId}->${node.id}`,
        source: parentId,
        target: node.id,
        type: 'smoothstep',
        animated: status === 'queued',
      })
    }
    for (const child of node.children) {
      place(child, depth + 1, node.id)
    }
  }
  // Skip the root itself — its children become the first column.
  for (const child of root.children) place(child, 0, null)
  return { nodes, edges }
}

function inferStatusFor(title: string, statusByTitle: Map<string, SpecStatus>): SpecStatus {
  const norm = title.toLowerCase()
  for (const [key, status] of statusByTitle.entries()) {
    if (norm.includes(key) || key.includes(norm)) return status
  }
  return 'planned'
}

export function PlanGraphView(props: PlanGraphViewProps) {
  const { root, statusByTitle, statusFilter = 'all', query = '' } = props

  const inferStatus = useCallback(
    (n: PlanNode) => inferStatusFor(n.title, statusByTitle),
    [statusByTitle],
  )

  // Initial layout — recomputed when the tree shape changes (id-set delta).
  const initialLayout = useMemo(() => layoutTree(root, inferStatus), [root, inferStatus])
  const [nodes, setNodes] = useState<Node[]>(initialLayout.nodes)
  const edges = initialLayout.edges

  // Re-seed positions when the tree changes (a refresh load() call). Keeps
  // any pre-existing user-drag positions for nodes that still exist.
  useEffect(() => {
    setNodes(prev => {
      const prevById = new Map(prev.map(n => [n.id, n]))
      return initialLayout.nodes.map(n => {
        const existing = prevById.get(n.id)
        return existing
          ? { ...n, position: existing.position } // preserve dragged position
          : n
      })
    })
  }, [initialLayout])

  // Apply ReactFlow's drag/select changes. Only x/y drags update local state;
  // selection is handled separately via onNodeClick below.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(curr => applyNodeChanges(changes, curr))
  }, [])

  // Visibility filter: dims (not hides) non-matching nodes so the user keeps
  // the architectural overview but the matches pop. Same UX as WorkflowGraph.
  const queryLower = query.trim().toLowerCase()
  const filteredNodes = useMemo(() => nodes.map(n => {
    const data = n.data as { planNode: PlanNode; status: SpecStatus }
    const titleMatch = !queryLower || data.planNode.title.toLowerCase().includes(queryLower)
    const statusMatch = statusFilter === 'all' || data.status === statusFilter
    const dim = !(titleMatch && statusMatch)
    return {
      ...n,
      style: { ...(n.style ?? {}), opacity: dim ? 0.3 : 1 },
      selected: n.id === props.selectedId,
    }
  }), [nodes, queryLower, statusFilter, props.selectedId])

  const selectedNode: PlanNode | null = useMemo(() => {
    if (!props.selectedId) return null
    const found = nodes.find(n => n.id === props.selectedId)
    if (!found) return null
    return (found.data as { planNode: PlanNode }).planNode
  }, [nodes, props.selectedId])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3 h-full min-h-125">
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
        <ReactFlow
          nodes={filteredNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={(_e, node) => {
            const data = node.data as { planNode: PlanNode }
            props.onSelect(data.planNode)
          }}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="bg-slate-100! dark:bg-slate-900!" />
        </ReactFlow>
      </div>
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 flex flex-col gap-3 max-h-125 overflow-y-auto">
        {selectedNode ? (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                {inferStatus(selectedNode)}
              </p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {selectedNode.title}
              </h3>
              {selectedNode.body && (
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-6">
                  {selectedNode.body}
                </p>
              )}
            </div>
            <PlanNodeActions
              node={selectedNode}
              variant="panel"
              isVoided={props.voidedIds?.has(selectedNode.id) ?? false}
              isQueued={props.queuedIds?.has(selectedNode.id) ?? false}
              isShipped={props.shippedIds?.has(selectedNode.id) ?? false}
              onMoveUp={props.onMoveUp}
              onMoveDown={props.onMoveDown}
              onBuildNow={props.onBuildNow}
              onDiscuss={props.onDiscuss}
              onVoid={props.onVoid}
              onRecover={props.onRecover}
              onUndeploy={props.onUndeploy}
              onAddToQueue={props.onAddToQueue}
              onChangePhase={props.onChangePhase}
            />
          </>
        ) : (
          <p className="text-xs text-slate-500 italic">
            Click a node in the graph to see details + actions.
          </p>
        )}
      </div>
    </div>
  )
}
