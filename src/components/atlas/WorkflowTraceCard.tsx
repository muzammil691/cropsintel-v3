import { useState } from 'react'
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  ShieldCheck,
  Palette,
  BrainCircuit,
  Eye,
} from 'lucide-react'
import type { WorkflowTrace } from '@/hooks/useWorkflowTraces'

interface WorkflowTraceCardProps {
  trace: WorkflowTrace
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
  if (warn) return <MinusCircle className="size-3.5 text-amber-500 shrink-0" />
  return <XCircle className="size-3.5 text-red-500 shrink-0" />
}

interface StageRowProps {
  Icon: typeof ShieldCheck
  label: string
  ok: boolean
  warn?: boolean
  detail?: string | null
  ranAt?: string | null
}

function StageRow({ Icon, label, ok, warn, detail, ranAt }: StageRowProps) {
  return (
    <li className="flex items-center gap-2 text-xs py-1">
      <StatusIcon ok={ok} warn={warn} />
      <Icon className="size-3.5 text-muted-foreground shrink-0" />
      <span className="font-medium text-foreground/80 min-w-[80px]">{label}</span>
      <span className="flex-1 text-muted-foreground line-clamp-1">{detail ?? '—'}</span>
      <span className="text-muted-foreground shrink-0 ml-1 tabular-nums">{relativeTime(ranAt ?? null)}</span>
    </li>
  )
}

export function WorkflowTraceCard({ trace }: WorkflowTraceCardProps) {
  const [expanded, setExpanded] = useState(false)

  const verifierOk = trace.verifier_verdict === 'pass'
  const verifierMissing = trace.verifier_verdict === null
  const designerOk = trace.designer_verdict === 'pass'
  const designerWarn = trace.designer_verdict === null
  const memoryOk = trace.memory_ingested_at !== null
  const atlasOk = trace.atlas_observed_at !== null

  const gaps = trace.verifier_gaps ?? []
  const shipped = relativeTime(trace.shipped_at)

  return (
    <article className="rounded-lg border bg-card text-card-foreground p-3 shadow-sm hover:shadow-md transition-shadow duration-150">
      <header className="flex items-start gap-2 mb-2">
        <span className="grid place-items-center size-7 rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 shrink-0">
          <GitBranch className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Workflow trace
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{shipped}</span>
          </div>
          <p className="font-mono text-xs font-medium truncate" title={trace.task_id}>
            {trace.task_id}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
            {trace.sha ? trace.sha.slice(0, 8) : '—'}
          </p>
        </div>
      </header>

      <ul className="space-y-0.5 border-t border-border/50 pt-2">
        <StageRow
          Icon={ShieldCheck}
          label="Verifier"
          ok={verifierOk}
          warn={verifierMissing}
          detail={
            verifierMissing
              ? 'no audit recorded'
              : `${trace.verifier_verdict}${trace.verifier_confidence != null ? ` · conf ${trace.verifier_confidence.toFixed(2)}` : ''}`
          }
          ranAt={trace.shipped_at}
        />
        <StageRow
          Icon={Palette}
          label="Designer"
          ok={designerOk}
          warn={designerWarn}
          detail={
            designerWarn
              ? 'not run (non-UI commit)'
              : `${trace.designer_verdict}${trace.designer_confidence != null ? ` · conf ${trace.designer_confidence.toFixed(2)}` : ''}`
          }
          ranAt={trace.designer_ran_at}
        />
        <StageRow
          Icon={BrainCircuit}
          label="Memory"
          ok={memoryOk}
          warn={false}
          detail={
            memoryOk
              ? `ingested${trace.memory_chunks_added != null ? ` · +${trace.memory_chunks_added} chunks` : ''}`
              : 'not yet ingested'
          }
          ranAt={trace.memory_ingested_at}
        />
        <StageRow
          Icon={Eye}
          label="Atlas"
          ok={atlasOk}
          warn={false}
          detail={atlasOk ? 'snapshot recorded' : 'no snapshot in window'}
          ranAt={trace.atlas_observed_at}
        />
      </ul>

      {gaps.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {expanded ? 'Hide' : 'Show'} {gaps.length} verifier gap{gaps.length === 1 ? '' : 's'}
          </button>
          {expanded && (
            <ul className="mt-1.5 space-y-1">
              {gaps.slice(0, 6).map((g, i) => (
                <li key={i} className="text-[11px] text-muted-foreground line-clamp-2">
                  <span className="font-mono">{g.check ?? 'check'}:</span>{' '}
                  {g.description ?? '(no description)'}
                </li>
              ))}
              {gaps.length > 6 && (
                <li className="text-[11px] text-muted-foreground italic">
                  +{gaps.length - 6} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <footer className="mt-2 pt-2 border-t border-border/50 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="size-3" />
        <span>7-agent choreography · live from atlas_workflow_trace</span>
      </footer>
    </article>
  )
}
