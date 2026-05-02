import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { WorkflowGraph as Graph, WorkflowGraphNode } from '@/lib/atlas-client'

interface WorkflowGraphProps {
  graph: Graph
  onNodeOpen: (node: WorkflowGraphNode) => void
  // Phase 1.10at — controlled query string. When provided, matches highlight
  // in emerald; non-matches dim to 30% opacity (instead of being hidden).
  query?: string
}

// Light-weight CSS-grid based flowchart. We don't pull reactflow because the
// shadcn aesthetic + the fixed 8-dept / 15-workflow / 3-model topology is a
// known shape; a deterministic layout is more accessible (keyboard focus
// order matches reading order) and adds zero deps.
//
// Mobile (<sm): stacks into a list per the spec's mitigation.

export function WorkflowGraph({ graph, onNodeOpen, query = '' }: WorkflowGraphProps) {
  const departments = useMemo(() => graph.nodes.filter(n => n.type === 'department'), [graph])
  const operatingModels = useMemo(() => graph.nodes.filter(n => n.type === 'operating_model'), [graph])
  const workflows = useMemo(() => {
    const wfs = graph.nodes.filter(n => n.type === 'workflow')
    return wfs.sort((a, b) => {
      const an = Number(a.meta?.number ?? 0)
      const bn = Number(b.meta?.number ?? 0)
      return an - bn
    })
  }, [graph])

  const queryLower = query.trim().toLowerCase()
  const filterActive = queryLower.length > 0
  function matches(node: WorkflowGraphNode): boolean {
    if (!filterActive) return true
    return (
      node.title.toLowerCase().includes(queryLower) ||
      node.description.toLowerCase().includes(queryLower)
    )
  }

  // Tailwind class for non-match visual: 30% opacity per spec.
  const dimCls = 'opacity-30'
  const highlightCls = 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-950'

  return (
    <div className="space-y-4">
      {/* Operating models */}
      {operatingModels.length > 0 && (
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Operating models
          </h3>
          <div className="flex flex-wrap gap-2">
            {operatingModels.map(model => {
              const isMatch = matches(model)
              const code = String(model.meta?.code ?? '')
              const tone = code === 'Model A'
                ? 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900'
                : code === 'Model B'
                ? 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900'
                : 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900'
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onNodeOpen(model)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    tone,
                    !isMatch && filterActive && dimCls,
                    isMatch && filterActive && highlightCls,
                  )}
                >
                  {model.title}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Departments */}
      {departments.length > 0 && (
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Departments ({departments.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {departments.map(dept => {
              const isMatch = matches(dept)
              return (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => onNodeOpen(dept)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-left text-xs hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    !isMatch && filterActive && dimCls,
                    isMatch && filterActive && highlightCls,
                  )}
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      dept.meta?.active ? 'bg-emerald-500' : 'bg-slate-300',
                    )}
                    aria-hidden
                  />
                  <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {dept.title}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Workflows */}
      {workflows.length > 0 && (
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Workflows ({workflows.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
            {workflows.map((wf, i, arr) => {
              const isMatch = matches(wf)
              const ownedBy = graph.edges
                .filter(e => e.target === wf.id && e.source.startsWith('dept-'))
                .map(e => departments.find(d => d.id === e.source)?.title)
                .filter(Boolean) as string[]
              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => onNodeOpen(wf)}
                  className={cn(
                    'text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 hover:border-emerald-400 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    !isMatch && filterActive && dimCls,
                    isMatch && filterActive && highlightCls,
                  )}
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1 flex items-center justify-between">
                    <span>Workflow #{String(wf.meta?.number ?? '?')}</span>
                    {i < arr.length - 1 && <span aria-hidden>→</span>}
                  </div>
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                    {wf.title}
                  </div>
                  {ownedBy.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ownedBy.slice(0, 3).map(d => (
                        <span
                          key={d}
                          className="text-[10px] rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5"
                        >
                          {d}
                        </span>
                      ))}
                      {ownedBy.length > 3 && (
                        <span className="text-[10px] text-slate-400">+{ownedBy.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Mini summary footer */}
      <div className="text-[11px] text-slate-400 text-right">
        {graph.nodes.length} nodes · {graph.edges.length} edges
        {graph.updated_at && (
          <> · updated {new Date(graph.updated_at).toLocaleDateString()}</>
        )}
        {graph.source === 'baseline-fallback' && (
          <span className="ml-2 text-amber-500">(baseline fallback)</span>
        )}
      </div>
    </div>
  )
}
