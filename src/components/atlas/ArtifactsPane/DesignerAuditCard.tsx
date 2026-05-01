import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, X, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DesignAudit, DesignAuditGap } from '@/lib/atlas-client'

interface DesignerAuditCardProps {
  audit: DesignAudit
  onRemediate: (audit: DesignAudit) => void
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

function severityClass(severity?: DesignAuditGap['severity']): string {
  if (severity === 'high') return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900'
  if (severity === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900'
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
}

export function DesignerAuditCard({ audit, onRemediate, onDismiss }: DesignerAuditCardProps) {
  const [expanded, setExpanded] = useState(false)
  const gaps = audit.gaps ?? []

  return (
    <article className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-3 shadow-sm hover:shadow-md transition-shadow duration-150">
      <header className="flex items-start gap-2 mb-2">
        <span className="grid place-items-center size-7 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 shrink-0">
          <AlertTriangle className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-800 dark:text-amber-300">
              Designer audit · failed
            </span>
            <span className="text-[10px] text-slate-500 tabular-nums">{relativeTime(audit.created_at)}</span>
          </div>
          <p className="font-mono text-xs font-medium truncate">{audit.task_id}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {audit.operation} · {gaps.length} gap{gaps.length === 1 ? '' : 's'}
            {audit.confidence !== null && ` · conf ${audit.confidence}`}
          </p>
        </div>
      </header>

      {gaps.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-150"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {expanded ? 'Hide gaps' : 'Show gaps'}
          </button>

          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {gaps.map((gap, i) => (
                <li
                  key={i}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${severityClass(gap.severity)}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase font-semibold tracking-wider">
                      {gap.severity ?? 'info'}
                    </span>
                    {gap.check && (
                      <span className="text-[10px] font-mono opacity-70">{gap.check}</span>
                    )}
                  </div>
                  {gap.description && <p className="mt-0.5">{gap.description}</p>}
                  {gap.fix && (
                    <p className="mt-1 text-[11px] opacity-80">
                      <span className="font-semibold">Fix:</span> {gap.fix}
                    </p>
                  )}
                  {(gap.file || gap.line) && (
                    <p className="mt-0.5 text-[10px] font-mono opacity-70">
                      {gap.file}{gap.line ? `:${gap.line}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs px-2.5 bg-amber-600 hover:bg-amber-700 text-white"
          onClick={() => onRemediate(audit)}
        >
          <Wrench className="size-3 mr-1" />
          Remediate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs px-2.5 text-slate-500 hover:text-slate-900"
          onClick={() => onDismiss(audit.id)}
        >
          <X className="size-3 mr-1" />
          Dismiss
        </Button>
      </div>
    </article>
  )
}
