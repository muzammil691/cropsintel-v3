import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Inbox } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import { PendingSpecCard } from '../ArtifactsPane/PendingSpecCard'
import { DesignerAuditCard } from '../ArtifactsPane/DesignerAuditCard'
import { OpenForkCard } from '../ArtifactsPane/OpenForkCard'
import { WorkflowTraceCard } from '../WorkflowTraceCard'
import { AssignToTeamMenu } from '../team-portal/AssignToTeamMenu'
import { useWorkflowTraces } from '@/hooks/useWorkflowTraces'
import type { UseArtifactsResult } from '@/hooks/useArtifacts'
import {
  diagnoseBatch,
  fetchAtlasMe,
  fetchTeamPortalReports,
  triageTeamReport,
  type AtlasMe,
  type BatchDiagnoseItem,
  type BatchDiagnoseResult,
  type DesignAudit,
  type DesignAuditGap,
  type TeamReport,
} from '@/lib/atlas-client'
import { BatchDiagnoseToolbar } from '../diagnose/BatchDiagnoseToolbar'
import { CombinedDiagnosisCard } from '../diagnose/CombinedDiagnosisCard'

interface AtlasArtifactsTabProps {
  artifacts: UseArtifactsResult
}

const POLISH_HIDE_KEY = 'atlas:polish-hide-until'
const POLISH_HIDE_TTL_MS = 24 * 60 * 60 * 1000
const HIGH_PRIORITY_CHECKS = new Set([
  'files-exist',
  'components-implemented',
  'accessibility:critical',
  'verifier_audit_missing',
])

function isHighPriorityAudit(audit: DesignAudit): boolean {
  if (!Array.isArray(audit.gaps) || audit.gaps.length === 0) {
    return audit.verdict === 'fail'
  }
  return audit.gaps.some((g: DesignAuditGap) => {
    if (g.severity === 'high') return true
    if (g.check && HIGH_PRIORITY_CHECKS.has(g.check)) return true
    return false
  })
}

function readPolishHide(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(POLISH_HIDE_KEY)
    if (!raw) return false
    const until = Number(raw)
    if (!Number.isFinite(until)) return false
    return until > Date.now()
  } catch {
    return false
  }
}

function setPolishHide(hide: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (hide) {
      window.localStorage.setItem(POLISH_HIDE_KEY, String(Date.now() + POLISH_HIDE_TTL_MS))
    } else {
      window.localStorage.removeItem(POLISH_HIDE_KEY)
    }
  } catch {
    /* ignore */
  }
}

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
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    result: BatchDiagnoseResult
    items: BatchDiagnoseItem[]
  } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [polishHidden, setPolishHidden] = useState<boolean>(() => readPolishHide())
  const [me, setMe] = useState<AtlasMe | null>(null)
  const [reports, setReports] = useState<TeamReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)

  // Owner / admin can view + assign + triage reports.
  const isOwnerOrAdmin = me?.role === 'owner' || me?.role === 'admin'
  const isOwner = me?.role === 'owner'

  // Refresh hidden flag once a minute so it auto-uncollapses after the TTL.
  useEffect(() => {
    const id = window.setInterval(() => setPolishHidden(readPolishHide()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Load principal once so we can gate owner-only affordances.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchAtlasMe()
        if (!cancelled) setMe(data)
      } catch {
        // silent — affordances simply stay hidden
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshReports = useCallback(async () => {
    if (!isOwnerOrAdmin) return
    setReportsLoading(true)
    try {
      const data = await fetchTeamPortalReports()
      setReports(data)
    } catch {
      // non-fatal — leave previous list
    } finally {
      setReportsLoading(false)
    }
  }, [isOwnerOrAdmin])

  useEffect(() => {
    if (!isOwnerOrAdmin) return
    void refreshReports()
    const t = window.setInterval(() => void refreshReports(), 20_000)
    return () => window.clearInterval(t)
  }, [isOwnerOrAdmin, refreshReports])

  const total = pendingSpecs.length + designAudits.length + openForks.length + traces.length

  const { highAudits, polishAudits } = useMemo(() => {
    const high: DesignAudit[] = []
    const polish: DesignAudit[] = []
    for (const a of designAudits) {
      if (isHighPriorityAudit(a)) high.push(a)
      else polish.push(a)
    }
    return { highAudits: high, polishAudits: polish }
  }, [designAudits])

  const allIds = useMemo(
    () => [
      ...pendingSpecs.map((s) => `spec:${s.id}`),
      ...designAudits.map((a) => `audit:${a.id}`),
      ...openForks.map((f) => `fork:${f.id}`),
    ],
    [pendingSpecs, designAudits, openForks],
  )

  const failedIds = useMemo(
    () => designAudits.filter((a) => a.verdict === 'fail').map((a) => `audit:${a.id}`),
    [designAudits],
  )

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3000)
  }

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
  function selectFailed() {
    setSelected(new Set(failedIds))
  }
  function clearAll() {
    setSelected(new Set())
  }

  function buildBatchItems(): BatchDiagnoseItem[] {
    const items: BatchDiagnoseItem[] = []
    for (const id of selected) {
      if (id.startsWith('audit:')) {
        const auditId = id.slice('audit:'.length)
        const audit = designAudits.find((a) => a.id === auditId)
        if (!audit) continue
        items.push({
          kind: 'designer_audit',
          ref: audit.id,
          payload: {
            task_id: audit.task_id,
            verdict: audit.verdict,
            gaps: audit.gaps,
            confidence: audit.confidence,
          },
        })
      } else if (id.startsWith('spec:')) {
        const specId = id.slice('spec:'.length)
        const spec = pendingSpecs.find((s) => s.id === specId)
        if (!spec) continue
        items.push({
          kind: 'pending_spec',
          ref: spec.id,
          payload: { filename: spec.filename, drafted_at: spec.drafted_at },
        })
      } else if (id.startsWith('fork:')) {
        const forkId = id.slice('fork:'.length)
        const fork = openForks.find((f) => f.id === forkId)
        if (!fork) continue
        items.push({
          kind: 'open_fork',
          ref: fork.id,
          payload: {
            decided_at: fork.decided_at,
            fork_question: fork.fork_question,
            rationale: fork.rationale,
          },
        })
      }
    }
    return items
  }

  async function handleDiagnoseAll() {
    const items = buildBatchItems()
    if (items.length === 0) {
      showToast('No batch-eligible rows selected.')
      return
    }
    if (items.length > 8) {
      showToast('Batch capped at 8 — narrow your selection.')
      return
    }
    setBatchBusy(true)
    try {
      const result = await diagnoseBatch(items)
      setBatchResult({ result, items })
      const skipped = result.skipped_resolved?.length ?? 0
      const note = skipped > 0
        ? ` (skipped ${skipped} already-resolved row${skipped === 1 ? '' : 's'})`
        : ''
      showToast(`Diagnosed ${result.results.length} artifact${result.results.length === 1 ? '' : 's'}${note}.`)
    } catch (err) {
      showToast(`Diagnose batch failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBatchBusy(false)
    }
  }

  async function handleCopyCcPrompt() {
    const items = buildBatchItems()
    if (items.length === 0) {
      showToast('No rows selected.')
      return
    }
    setBatchBusy(true)
    try {
      const result = await diagnoseBatch(items)
      const cc = result.combined.claude_code
      const skipped = result.skipped_resolved?.length ?? 0
      const skippedNote = skipped > 0 ? ` (${skipped} already-resolved skipped)` : ''
      if (!cc) {
        showToast(`No Claude Code prompts in the selection${skippedNote} — see the result card.`)
        setBatchResult({ result, items })
      } else {
        try {
          await navigator.clipboard.writeText(cc.prompt)
          showToast(`Copied combined CC prompt (${cc.items.length} issue${cc.items.length === 1 ? '' : 's'})${skippedNote}.`)
          setBatchResult({ result, items })
        } catch {
          showToast('Clipboard write failed — open the result card to copy manually.')
          setBatchResult({ result, items })
        }
      }
    } catch (err) {
      showToast(`Diagnose failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBatchBusy(false)
    }
  }

  function handleDiscussAll() {
    const items = buildBatchItems()
    if (items.length === 0) {
      showToast('No rows selected.')
      return
    }
    const seed = `Discuss ${items.length} artifact${items.length === 1 ? '' : 's'} together:\n\n${items
      .map((it, i) => {
        const taskId = (it.payload['task_id'] as string | undefined) ?? it.ref.slice(0, 8)
        return `${i + 1}. [${it.kind}] ${taskId}`
      })
      .join('\n')}\n\nWhat's your take — auto-fix, escalate, or split?`
    window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: seed }))
    showToast('Sent combined discussion to chat.')
  }

  function handleDismissAll() {
    let n = 0
    for (const id of selected) {
      if (id.startsWith('spec:')) { dismissSpec(id.slice('spec:'.length)); n++ }
      else if (id.startsWith('audit:')) { dismissAudit(id.slice('audit:'.length)); n++ }
    }
    showToast(`Dismissed ${n} item${n === 1 ? '' : 's'}.`)
    clearAll()
  }

  function togglePolishHide() {
    const next = !polishHidden
    setPolishHide(next)
    setPolishHidden(next)
  }

  function handleRemediate(audit: DesignAudit) {
    dismissAudit(audit.id)
  }

  async function handleTriageReport(id: string, status: 'triaged' | 'resolved' | 'dismissed') {
    try {
      await triageTeamReport(id, { status })
      const verb = status === 'triaged' ? 'triaged' : status === 'resolved' ? 'resolved' : 'dismissed'
      showToast(`Report ${verb}.`)
      await refreshReports()
    } catch (err) {
      showToast(`Triage failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const newReportCount = reports.filter((r) => r.status === 'new').length

  // Cost estimate: ~$0.025 per heuristic / Claude classification call (rough).
  const estCostUsd = selected.size * 0.025

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

      {total > 0 && (
        <div className="mb-3">
          <BatchDiagnoseToolbar
            total={allIds.length}
            selected={selected.size}
            failedCount={failedIds.length}
            onSelectAll={selectAll}
            onSelectFailed={selectFailed}
            onClearSelection={clearAll}
            onDiagnoseAll={handleDiagnoseAll}
            onDiscussAll={handleDiscussAll}
            onCopyCcPrompt={handleCopyCcPrompt}
            onDismissAll={handleDismissAll}
            busy={batchBusy}
            estCostUsd={estCostUsd}
          />
        </div>
      )}

      {batchResult && (
        <div className="mb-3">
          <CombinedDiagnosisCard
            result={batchResult.result}
            originalItems={batchResult.items}
            onClose={() => setBatchResult(null)}
            onToast={showToast}
          />
        </div>
      )}

      {isOwnerOrAdmin && (
        <ReportsInbox
          reports={reports}
          loading={reportsLoading}
          newCount={newReportCount}
          canTriage={isOwner}
          onTriage={handleTriageReport}
        />
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
                      {isOwner && (
                        <div className="mt-1.5 flex justify-end">
                          <AssignToTeamMenu
                            artifactKind="manual_report"
                            artifactRef={spec.id}
                            taskId={spec.filename}
                            title={`Pending spec: ${spec.filename}`}
                            onAssigned={(label) => showToast(`Assigned to ${label}.`)}
                            onError={(msg) => showToast(`Assign failed: ${msg}`)}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </ArtifactGroup>
        )}

        {highAudits.length > 0 && (
          <ArtifactGroup
            title="Designer audits — high priority"
            count={highAudits.length}
          >
            <ul className="space-y-2">
              {highAudits.map((audit) => {
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
                      {isOwner && (
                        <div className="mt-1.5 flex justify-end">
                          <AssignToTeamMenu
                            artifactKind="designer_audit"
                            artifactRef={audit.id}
                            taskId={audit.task_id}
                            title={`Designer audit: ${audit.task_id} (${audit.verdict})`}
                            onAssigned={(label) => showToast(`Assigned to ${label}.`)}
                            onError={(msg) => showToast(`Assign failed: ${msg}`)}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </ArtifactGroup>
        )}

        {polishAudits.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Designer audits — polish{' '}
                <span className="tabular-nums">({polishAudits.length})</span>
              </h3>
              <button
                type="button"
                onClick={togglePolishHide}
                className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 underline-offset-2 hover:underline transition-colors duration-150"
              >
                {polishHidden ? `Show (${polishAudits.length})` : 'Hide polish until next ship'}
              </button>
            </div>
            {!polishHidden && (
              <ul className="space-y-2">
                {polishAudits.map((audit) => {
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
            )}
          </section>
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
                      {isOwner && (
                        <div className="mt-1.5 flex justify-end">
                          <AssignToTeamMenu
                            artifactKind="open_fork"
                            artifactRef={fork.id}
                            taskId={fork.related_phase ?? fork.id.slice(0, 8)}
                            title={`Open fork: ${fork.fork_question.slice(0, 60)}`}
                            onAssigned={(label) => showToast(`Assigned to ${label}.`)}
                            onError={(msg) => showToast(`Assign failed: ${msg}`)}
                          />
                        </div>
                      )}
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

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-1.5 text-xs shadow-lg"
        >
          {toast}
        </div>
      )}
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

const SEVERITY_TONE: Record<TeamReport['severity'], string> = {
  high: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200',
  medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200',
  low: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
}

function ReportsInbox({
  reports,
  loading,
  newCount,
  canTriage,
  onTriage,
}: {
  reports: TeamReport[]
  loading: boolean
  newCount: number
  canTriage: boolean
  onTriage: (id: string, status: 'triaged' | 'resolved' | 'dismissed') => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(true)
  const visible = reports.slice(0, 8)
  return (
    <section className="mb-4 rounded-md border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <Inbox className="size-4 text-slate-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Reports inbox
        </span>
        <span className="tabular-nums text-xs text-slate-500">
          ({reports.length} total
          {newCount > 0 && (
            <>
              {' · '}
              <span className="text-amber-700 dark:text-amber-300 font-semibold">{newCount} new</span>
            </>
          )}
          )
        </span>
        <span className="ml-auto text-[11px] text-slate-400">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {loading && reports.length === 0 ? (
            <ul className="space-y-1.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <li
                  key={i}
                  className="h-12 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse"
                />
              ))}
            </ul>
          ) : reports.length === 0 ? (
            <p className="text-xs text-slate-500">No reports yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${SEVERITY_TONE[r.severity]}`}
                    >
                      {r.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {r.subject}
                      </p>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{r.description}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {r.reporter_display_name ?? r.reporter_phone ?? 'Unknown reporter'}
                        <> · {new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</>
                        <> · {r.status}</>
                        {r.attachments?.length > 0 && <> · {r.attachments.length} attachment{r.attachments.length === 1 ? '' : 's'}</>}
                      </p>
                    </div>
                    {canTriage && r.status === 'new' && (
                      <div className="shrink-0 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => void onTriage(r.id, 'triaged')}
                          className="text-[10px] rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors duration-200"
                        >
                          Triage
                        </button>
                        <button
                          type="button"
                          onClick={() => void onTriage(r.id, 'dismissed')}
                          className="text-[10px] rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors duration-200"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {reports.length > visible.length && (
                <li className="text-[11px] text-slate-400 italic">
                  +{reports.length - visible.length} older report{reports.length - visible.length === 1 ? '' : 's'} not shown.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
