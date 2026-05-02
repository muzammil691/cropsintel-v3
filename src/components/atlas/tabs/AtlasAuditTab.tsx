import { useEffect, useMemo, useState } from 'react'
import { TabFrame } from './AtlasPlanTab'
import { AuditRow, type AuditRowData, type AuditRowSource, type AuditVerdict } from '../audit/AuditRow'
import { cn } from '@/lib/utils'
import {
  fetchRecentVerifierRuns,
  fetchRecentDesignerRuns,
  type VerifierRunRow,
  type DesignerRunRow,
} from '@/lib/atlas-client'

type FilterKey = 'all' | 'verifier' | 'designer'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'verifier', label: 'Verifier' },
  { key: 'designer', label: 'Designer' },
]

export default function AtlasAuditTab() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [verifierRuns, setVerifierRuns] = useState<VerifierRunRow[]>([])
  const [designerRuns, setDesignerRuns] = useState<DesignerRunRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchRecentVerifierRuns(50).catch(() => [] as VerifierRunRow[]),
      fetchRecentDesignerRuns(50).catch(() => [] as DesignerRunRow[]),
    ])
      .then(([v, d]) => {
        if (cancelled) return
        setVerifierRuns(v)
        setDesignerRuns(d)
        setError(null)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const verifierRows: AuditRowData[] = verifierRuns.map(r => ({
      id: `v:${r.id}`,
      source: 'verifier' as AuditRowSource,
      verdict: (r.passed ? 'pass' : 'fail') as AuditVerdict,
      task_id: r.task_id,
      summary: r.passed
        ? `passed (${r.mode})`
        : `failed${r.gaps?.length ? ` (${r.gaps.length} gap${r.gaps.length === 1 ? '' : 's'})` : ''}`,
      commit_sha: r.commit_sha,
      created_at: r.ran_at,
      gap_count: r.gaps?.length ?? 0,
    }))
    const designerRows: AuditRowData[] = designerRuns.map(r => ({
      id: `d:${r.id}`,
      source: 'designer' as AuditRowSource,
      verdict: normalizeDesignerVerdict(r.verdict),
      task_id: r.task_id,
      summary: summarizeJudgment(r),
      commit_sha: null,
      created_at: r.created_at,
      gap_count: countGapsFromJudgment(r.ai_judgment),
    }))

    let merged: AuditRowData[]
    if (filter === 'verifier') merged = verifierRows
    else if (filter === 'designer') merged = designerRows
    else merged = [...verifierRows, ...designerRows]

    return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [verifierRuns, designerRuns, filter])

  const failed24hCount = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000
    return verifierRuns.filter(
      r => !r.passed && new Date(r.ran_at).getTime() >= cutoff,
    ).length
  }, [verifierRuns])

  const handleAction: React.ComponentProps<typeof AuditRow>['onAction'] = (kind, row) => {
    if (kind === 'open-commit' && row.commit_sha) {
      const url = `https://github.com/cropsintel/io/cropsintel-v3/commit/${row.commit_sha}`
      try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* ignore */ }
      return
    }
    showToast(`${labelFor(kind)} flow ships in Phase B (${row.task_id}).`)
  }

  const showToast = (msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(null), 3000)
  }

  return (
    <TabFrame
      title="Audit"
      hint="Live audit feed across the build pipeline."
      rightSlot={
        <div className="flex items-center gap-3">
          {failed24hCount > 0 && (
            <span className="text-[11px] text-red-600 dark:text-red-400 tabular-nums">
              {failed24hCount} failed (24h)
            </span>
          )}
          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'px-2 py-0.5 text-[11px] transition-colors',
                  filter === f.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {loading && rows.length === 0 ? (
        <ul className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-14 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : error && rows.length === 0 ? (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">
          No {filter === 'all' ? 'audit' : filter} activity to show.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map(row => (
            <AuditRow key={row.id} row={row} onAction={handleAction} />
          ))}
        </ol>
      )}

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-1.5 text-xs shadow-lg"
        >
          {toastMsg}
        </div>
      )}
    </TabFrame>
  )
}

function labelFor(kind: 'diagnose' | 'discuss' | 'copy-cc-prompt' | 'view-gaps' | 'open-commit'): string {
  switch (kind) {
    case 'diagnose': return 'Diagnose'
    case 'discuss': return 'Discuss'
    case 'copy-cc-prompt': return 'Copy CC Prompt'
    case 'view-gaps': return 'View gaps'
    case 'open-commit': return 'Open commit'
  }
}

function normalizeDesignerVerdict(verdict: string): AuditVerdict {
  if (verdict === 'pass') return 'pass'
  if (verdict === 'fail') return 'fail'
  if (verdict === 'partial') return 'partial'
  return 'unknown'
}

function summarizeJudgment(r: DesignerRunRow): string {
  const j = r.ai_judgment
  if (j && typeof j === 'object') {
    const summary = (j as Record<string, unknown>).summary
    if (typeof summary === 'string' && summary.length > 0) return summary
    const reason = (j as Record<string, unknown>).reason
    if (typeof reason === 'string' && reason.length > 0) return reason
  }
  return r.verdict === 'pass' ? 'designer pass' : `designer ${r.verdict}`
}

function countGapsFromJudgment(judgment: Record<string, unknown> | null): number {
  if (!judgment) return 0
  const gaps = judgment.gaps
  if (Array.isArray(gaps)) return gaps.length
  return 0
}
