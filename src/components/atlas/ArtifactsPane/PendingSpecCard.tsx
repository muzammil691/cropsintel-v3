import { useState } from 'react'
import { FileText, ExternalLink, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { PendingSpec } from '@/lib/atlas-client'

interface PendingSpecCardProps {
  spec: PendingSpec
  onDismiss: (id: string) => void
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function PendingSpecCard({ spec, onDismiss }: PendingSpecCardProps) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const preview = spec.spec_markdown.split('\n').slice(0, 3).join(' ').slice(0, 220)

  return (
    <article className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 shadow-sm hover:shadow-md transition-shadow duration-150">
      <header className="flex items-start gap-2 mb-2">
        <span className="grid place-items-center size-7 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 shrink-0">
          <FileText className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400">
              Pending spec
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">{relativeTime(spec.drafted_at)}</span>
          </div>
          <p className="font-mono text-xs font-medium truncate" title={spec.filename}>
            {spec.filename}
          </p>
        </div>
      </header>

      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 mb-3 leading-relaxed">
        {preview}…
      </p>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2.5"
          onClick={() => setViewerOpen(true)}
        >
          <ExternalLink className="size-3 mr-1" />
          View
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => {
            // Queue is achieved by user replying YES in chat (per Atlas trust-mode flow).
            // Surfacing this as guidance keeps the existing flow unbroken.
            onDismiss(spec.id)
          }}
        >
          <Check className="size-3 mr-1" />
          Queue
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs px-2.5 text-slate-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={() => onDismiss(spec.id)}
        >
          <X className="size-3 mr-1" />
          Drop
        </Button>
      </div>

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{spec.filename}</DialogTitle>
            <DialogDescription>
              Drafted {relativeTime(spec.drafted_at)} — preview the markdown before queueing.
            </DialogDescription>
          </DialogHeader>
          <pre className="flex-1 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed bg-slate-50 dark:bg-slate-900 p-3 rounded-md border border-slate-200 dark:border-slate-800">
            {spec.spec_markdown}
          </pre>
        </DialogContent>
      </Dialog>
    </article>
  )
}
