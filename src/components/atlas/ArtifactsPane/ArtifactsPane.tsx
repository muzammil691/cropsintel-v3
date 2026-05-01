import { CheckCircle2, Inbox } from 'lucide-react'
import { PendingSpecCard } from './PendingSpecCard'
import { DesignerAuditCard } from './DesignerAuditCard'
import { OpenForkCard } from './OpenForkCard'
import { WorkflowTraceCard } from '../WorkflowTraceCard'
import { useWorkflowTraces } from '@/hooks/useWorkflowTraces'
import type { UseArtifactsResult } from '@/hooks/useArtifacts'
import type { DesignAudit } from '@/lib/atlas-client'

interface ArtifactsPaneProps {
  artifacts: UseArtifactsResult
}

export function ArtifactsPane({ artifacts }: ArtifactsPaneProps) {
  const {
    pendingSpecs,
    designAudits,
    openForks,
    loading,
    error,
    resolveFork,
    dismissSpec,
    dismissAudit,
  } = artifacts
  // 1.10ad: surface the most recent shipped commits with their full 7-agent trace.
  // Pulls from the atlas_workflow_trace view (view migration in 20260501080000).
  const { traces: workflowTraces } = useWorkflowTraces(30000, 5)

  const total = pendingSpecs.length + designAudits.length + openForks.length + workflowTraces.length

  function handleRemediate(audit: DesignAudit) {
    // Builder-side remediation flow lives in 1.10p. Surfacing the audit details
    // and dismissing the card is sufficient here — the actual remediation is
    // triggered by the agent loop on the next pickup.
    dismissAudit(audit.id)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] xl:h-[calc(100vh-7rem)] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Active artifacts
        </h2>
        {total > 0 && (
          <span className="text-[11px] tabular-nums text-slate-500">
            {total} pending
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && total === 0 && (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && total === 0 && !error && (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
            <span className="grid place-items-center size-10 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
            </span>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">All clear</p>
            <p className="text-xs text-slate-500 max-w-[200px]">
              No pending drafts, audits, or open forks waiting for you.
            </p>
          </div>
        )}

        {pendingSpecs.length > 0 && (
          <ArtifactGroup title="Pending specs" count={pendingSpecs.length} icon={Inbox}>
            {pendingSpecs.map((spec) => (
              <PendingSpecCard key={spec.id} spec={spec} onDismiss={dismissSpec} />
            ))}
          </ArtifactGroup>
        )}

        {designAudits.length > 0 && (
          <ArtifactGroup title="Designer audits" count={designAudits.length}>
            {designAudits.map((audit) => (
              <DesignerAuditCard
                key={audit.id}
                audit={audit}
                onRemediate={handleRemediate}
                onDismiss={dismissAudit}
              />
            ))}
          </ArtifactGroup>
        )}

        {openForks.length > 0 && (
          <ArtifactGroup title="Open forks" count={openForks.length}>
            {openForks.map((fork) => (
              <OpenForkCard key={fork.id} fork={fork} onResolve={resolveFork} />
            ))}
          </ArtifactGroup>
        )}

        {workflowTraces.length > 0 && (
          <ArtifactGroup title="Workflow traces" count={workflowTraces.length}>
            {workflowTraces.map((trace) => (
              <WorkflowTraceCard key={trace.sha || trace.task_id + trace.shipped_at} trace={trace} />
            ))}
          </ArtifactGroup>
        )}
      </div>
    </div>
  )
}

interface ArtifactGroupProps {
  title: string
  count: number
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}

function ArtifactGroup({ title, count, children }: ArtifactGroupProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
        {title} <span className="tabular-nums">({count})</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}
