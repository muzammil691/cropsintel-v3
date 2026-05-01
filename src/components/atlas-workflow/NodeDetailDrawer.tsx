import { useEffect, useState } from 'react'
import { X, Hammer, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchRelatedSpecs, type RelatedSpecHit, type WorkflowGraphNode } from '@/lib/atlas-client'

interface NodeDetailDrawerProps {
  node: WorkflowGraphNode | null
  onClose: () => void
  onBuild: (node: WorkflowGraphNode) => void
  onDiscuss: (node: WorkflowGraphNode) => void
}

export function NodeDetailDrawer({ node, onClose, onBuild, onDiscuss }: NodeDetailDrawerProps) {
  const [hits, setHits] = useState<RelatedSpecHit[]>([])
  const [loadingHits, setLoadingHits] = useState(false)

  useEffect(() => {
    if (!node) return
    let cancelled = false
    setLoadingHits(true)
    fetchRelatedSpecs(node.title)
      .then(rows => {
        if (!cancelled) setHits(rows)
      })
      .catch(() => {
        if (!cancelled) setHits([])
      })
      .finally(() => {
        if (!cancelled) setLoadingHits(false)
      })
    return () => { cancelled = true }
  }, [node])

  if (!node) return null

  return (
    <aside
      className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col z-40"
      role="dialog"
      aria-label={`Details for ${node.title}`}
    >
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{node.type}</div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{node.title}</h2>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close drawer">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Description</h3>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
            {node.description || 'No description in MAXONS_Workflow_v1.md.'}
          </p>
        </section>

        {node.meta && Object.keys(node.meta).length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Detail</h3>
            <pre className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap font-mono">
              {Object.entries(node.meta)
                .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                .join('\n')}
            </pre>
          </section>
        )}

        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Linked specs</h3>
          {loadingHits ? (
            <div className="text-xs text-slate-400">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="text-xs text-slate-400">No matching specs in queued/done/failed/in-progress.</div>
          ) : (
            <ul className="space-y-1">
              {hits.map(h => (
                <li key={`${h.status}-${h.filename}`} className="text-xs flex items-center gap-2">
                  <span
                    className={
                      h.status === 'done'
                        ? 'inline-block size-2 rounded-full bg-emerald-500'
                        : h.status === 'queued' || h.status === 'in-progress'
                        ? 'inline-block size-2 rounded-full bg-amber-400'
                        : 'inline-block size-2 rounded-full bg-rose-500'
                    }
                  />
                  <span className="font-mono truncate">{h.filename}</span>
                  <span className="text-slate-400 ml-auto">{h.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <Button size="sm" onClick={() => onBuild(node)}>
          <Hammer className="size-3.5" />
          Build this
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDiscuss(node)}>
          <MessageSquare className="size-3.5" />
          Discuss this
        </Button>
      </div>
    </aside>
  )
}
