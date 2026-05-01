import { useEffect, useState } from 'react'
import { Hammer, MessageSquare, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PlanNode } from '@/lib/atlas-client'

interface PlanNodeDetailProps {
  node: PlanNode | null
  onSave: (node: PlanNode, newBody: string) => Promise<void> | void
  onCancel: () => void
  onBuildNow: (node: PlanNode) => void
  onDiscuss: (node: PlanNode) => void
  busy: boolean
}

export function PlanNodeDetail({ node, onSave, onCancel, onBuildNow, onDiscuss, busy }: PlanNodeDetailProps) {
  const [draft, setDraft] = useState(node?.body ?? '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(node?.body ?? '')
    setDirty(false)
  }, [node?.id, node?.body])

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="text-sm text-slate-500">
          Select a plan node to view or edit it. Tip: every change is committed to git so the history is auditable.
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Level H{node.level} · line {node.source.line}
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {node.title}
            </h2>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setDirty(e.target.value !== node.body)
          }}
          placeholder="Body — supports markdown."
          className="min-h-[60vh] font-mono text-xs"
          disabled={busy}
        />
      </div>

      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void onSave(node, draft)}
          disabled={busy || !dirty}
        >
          <Save className="size-3.5" />
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(node.body)
            setDirty(false)
            onCancel()
          }}
          disabled={busy || !dirty}
        >
          <X className="size-3.5" />
          Cancel
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => onBuildNow(node)} disabled={busy}>
          <Hammer className="size-3.5" />
          Build now
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDiscuss(node)} disabled={busy}>
          <MessageSquare className="size-3.5" />
          Discuss with Atlas
        </Button>
      </div>
    </div>
  )
}
