import { useMemo, useState } from 'react'
import { Boxes } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import { PendingSpecCard } from '../ArtifactsPane/PendingSpecCard'
import { DesignerAuditCard } from '../ArtifactsPane/DesignerAuditCard'
import { OpenForkCard } from '../ArtifactsPane/OpenForkCard'
import { WorkflowTraceCard } from '../WorkflowTraceCard'
import { useWorkflowTraces } from '@/hooks/useWorkflowTraces'
import type { UseArtifactsResult } from '@/hooks/useArtifacts'
import type { DesignAudit } from '@/lib/atlas-client'

interface AtlasArtifactsTabProps {
  artifacts: UseArtifactsResult
}

/**
 * Extracts the artifact list from 1.10w's ArtifactsPane and adds the
 * multi-select scaffold called for in 1.10ak. The actual bulk-action
 * endpoints land in 1.10ak; today the multi-select is local-only and reset on
 * tab change so we don't lie about persistence.
 */
export default function AtlasArtifactsTab({ artifacts }: AtlasArtifactsTabProps) {
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
  const { traces } = useWorkflowTraces(30000, 5)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const total = pendingSpecs.length + designAudits.length + openForks.length + traces.length

  const allIds = useMemo(
    () => [
      ...pendingSpecs.map((s) => `spec:${s.id}`),
      ...designAudits.map((a) => `audit:${a.id}`),
      ...openForks.map((f) => `fork:${f.id}`),
    ],
    [pendingSpecs, designAudits, openForks],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(allIds))
  }
  function clearAll() {
    setSelected(new Set())
  }

  function handleRemediate(audit: DesignAudit) {
    dismissAudit(audit.id)
  }

  return (
    <TabFrame
      title="Artifacts"
      hint="Pending specs, designer audits, open forks, recent shipped traces."
      rightSlot={
        <div className="flex items-center gap-2 text-[11px]">
          {selected.size > 0 && (
            <span className="text-emerald-700 dark:text-emerald-400 tabular-nums">
              {selected.size} selected
            </span>
          )}
          {allIds.length > 0 && (
            <button
              type="button"
              onClick={selected.size === allIds.length ? clearAll : selectAll}
              className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 underline-offset-2 hover:underline transition-colors duration-150"
            >
              {selected.size === allIds.length ? 'Clear' : 'Select all'}
            </button>
          )}
        </div>
      }
    >
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && total === 0 && (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-20 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      )}

      {!loading && total === 0 && !error && (
        <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
          <span className="grid place-items-center size-10 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <Boxes className="size-5" />
          </span>
          <p className="text-sm font-medium">All clear</p>
          <p className="text-xs text-slate-500 max-w-[260px]">
            No pending drafts, audits, or open forks waiting for you.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {pendingSpecs.length > 0 && (
          <ArtifactGroup title="Pending specs" count={pendingSpecs.length}>
            <ul className="space-y-2">
              {pendingSpecs.map((spec) => {
                const id = `spec:${spec.id}`
                return (
                  <li key={spec.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggle(id)}
                      className="mt-1 shrink-0"
                      aria-label={`Select ${spec.filename}`}
                    />
                    <div className="flex-1 min-w-0">
                      <PendingSpecCard spec={spec} onDismiss={dismissSpec} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </ArtifactGroup>
        )}

        {designAudits.length > 0 && (
          <ArtifactGroup title="Designer audits" count={designAudits.length}>
            <ul className="space-y-2">
              {designAudits.map((audit) => {
                const id = `audit:${audit.id}`
                return (
                  <li key={audit.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggle(id)}
                      className="mt-1 shrink-0"
                      aria-label={`Select audit ${audit.task_id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <DesignerAuditCard
                        audit={audit}
                        onRemediate={handleRemediate}
                        onDismiss={dismissAudit}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </ArtifactGroup>
        )}

        {openForks.length > 0 && (
          <ArtifactGroup title="Open forks" count={openForks.length}>
            <ul className="space-y-2">
              {openForks.map((fork) => {
                const id = `fork:${fork.id}`
                return (
                  <li key={fork.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggle(id)}
                      className="mt-1 shrink-0"
                      aria-label={`Select fork ${fork.fork_question}`}
                    />
                    <div className="flex-1 min-w-0">
                      <OpenForkCard fork={fork} onResolve={resolveFork} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </ArtifactGroup>
        )}

        {traces.length > 0 && (
          <ArtifactGroup title="Workflow traces" count={traces.length}>
            <ul className="space-y-2">
              {traces.map((trace) => (
                <li key={trace.sha || trace.task_id + trace.shipped_at}>
                  <WorkflowTraceCard trace={trace} />
                </li>
              ))}
            </ul>
          </ArtifactGroup>
        )}
      </div>
    </TabFrame>
  )
}

function ArtifactGroup({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {title} <span className="tabular-nums">({count})</span>
      </h3>
      {children}
    </section>
  )
}
