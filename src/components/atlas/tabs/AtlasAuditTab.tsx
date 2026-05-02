import { useEffect, useMemo, useState } from 'react'
import { TabFrame } from './AtlasPlanTab'
import { AuditRow, type AuditRowData, type AuditRowSource, type AuditVerdict } from '../audit/AuditRow'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  fetchRecentVerifierRuns,
  fetchRecentDesignerRuns,
  diagnoseArtifact,
  diagnoseBatch,
  fetchCascadeRelation,
  autoFixQueue,
  recheckArtifact,
  type VerifierRunRow,
  type DesignerRunRow,
  type DiagnosisBucket,
  type BatchDiagnoseItem,
  type BatchDiagnoseResult,
  type CascadeRelation,
} from '@/lib/atlas-client'
import { BatchDiagnoseToolbar } from '../diagnose/BatchDiagnoseToolbar'
import { CombinedDiagnosisCard } from '../diagnose/CombinedDiagnosisCard'
import { CascadeChip } from '../diagnose/CascadeChip'

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
      gaps: r.gaps as unknown[] | undefined,
      raw: r as unknown as Record<string, unknown>,
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
      raw: r as unknown as Record<string, unknown>,
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

  const [diagnosis, setDiagnosis] = useState<{
    rowId: string
    bucket: DiagnosisBucket
    cascade?: Record<number, CascadeRelation>
  } | null>(null)
  const [diagnosing, setDiagnosing] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    result: BatchDiagnoseResult
    items: BatchDiagnoseItem[]
  } | null>(null)
  const [autoFixState, setAutoFixState] = useState<Record<string, 'queueing' | 'queued' | 'failed'>>({})
  const [recheckBusy, setRecheckBusy] = useState<Record<string, boolean>>({})

  async function refetchRuns() {
    const [v, d] = await Promise.all([
      fetchRecentVerifierRuns(50).catch(() => [] as VerifierRunRow[]),
      fetchRecentDesignerRuns(50).catch(() => [] as DesignerRunRow[]),
    ])
    setVerifierRuns(v)
    setDesignerRuns(d)
  }

  const handleAction: React.ComponentProps<typeof AuditRow>['onAction'] = async (kind, row) => {
    if (kind === 'open-commit' && row.commit_sha) {
      const url = `https://github.com/muzammil691/cropsintel-v3/commit/${row.commit_sha}`
      try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* ignore */ }
      return
    }

    // DISCUSS: prefill the cockpit chat with a focused question.
    if (kind === 'discuss') {
      const summary = row.gaps && row.gaps.length > 0
        ? row.gaps.slice(0, 3).map((g, i) => {
            const gap = g as { check?: string; description?: string; remediation?: string }
            return `  ${i + 1}. [${gap.check ?? 'gap'}] ${(gap.description ?? '').slice(0, 200)}`
          }).join('\n')
        : `  (no gap details on this row)`
      const seed = `Discuss the ${row.source} verdict on ${row.task_id} (${row.verdict}, ${row.commit_sha ? row.commit_sha.slice(0, 7) : 'no sha'}).\n\nGaps:\n${summary}\n\nWhat do you think — should we auto-fix, queue a remediation, or escalate?`
      window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: seed }))
      showToast('Question sent to chat — open the chat panel.')
      return
    }

    // DIAGNOSE + COPY CC PROMPT both call /atlas/artifacts/diagnose.
    if (kind === 'diagnose' || kind === 'copy-cc-prompt') {
      setDiagnosing(row.id)
      try {
        const bucket = await diagnoseArtifact({
          kind: row.source === 'verifier' ? 'verifier_run' : 'designer_audit',
          ref: row.id,
          payload: {
            task_id: row.task_id,
            commit_sha: row.commit_sha,
            verdict: row.verdict,
            gaps: row.gaps ?? [],
            raw: row.raw ?? {},
          },
        })

        // Cascade: per-gap relation chip ("introduced by your fix abc123").
        const cascade: Record<number, CascadeRelation> = {}
        if (row.commit_sha && Array.isArray(row.gaps) && row.gaps.length > 0) {
          await Promise.all(
            row.gaps.slice(0, 5).map(async (g, idx) => {
              const gap = g as { check?: string; file?: string }
              if (!gap.file) return
              try {
                const relation = await fetchCascadeRelation(row.commit_sha!, {
                  check: gap.check,
                  file: gap.file,
                })
                cascade[idx] = relation
              } catch {
                /* ignore — chip just won't render */
              }
            }),
          )
        }

        if (kind === 'copy-cc-prompt') {
          if (bucket.bucket === 'claude-code') {
            try {
              await navigator.clipboard.writeText(bucket.prompt)
              showToast('Claude Code prompt copied — paste into VS Code Claude Code.')
            } catch {
              showToast('Clipboard write failed — open Diagnose to view the prompt.')
              setDiagnosis({ rowId: row.id, bucket, cascade })
            }
          } else {
            // Diagnosis didn't classify as claude-code — surface the bucket so user sees why.
            showToast(`Diagnose returned bucket "${bucket.bucket}" — open Diagnose for details.`)
            setDiagnosis({ rowId: row.id, bucket, cascade })
          }
        } else {
          // Diagnose: render result inline below the row.
          setDiagnosis({ rowId: row.id, bucket, cascade })
        }
      } catch (e) {
        showToast(`Diagnose failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setDiagnosing(null)
      }
      return
    }

    if (kind === 'view-gaps') {
      // Open a quick gap dump in the toast for read-only inspection.
      const summary = row.gaps && row.gaps.length > 0
        ? row.gaps.slice(0, 5).map(g => {
            const gap = g as { check?: string; description?: string }
            return `[${gap.check ?? 'gap'}] ${(gap.description ?? '').slice(0, 100)}`
          }).join(' | ')
        : 'No gaps recorded.'
      showToast(summary)
      return
    }

    if (kind === 'recheck') {
      setRecheckBusy(prev => ({ ...prev, [row.id]: true }))
      showToast(`Rechecking ${row.source} for ${row.task_id}…`)
      try {
        const result = await recheckArtifact(row.source, row.task_id)
        if (!result.ok) {
          showToast(`Recheck failed: ${result.error ?? 'unknown error'}`)
          return
        }
        // The new run row was written by the verifier/designer service.
        // Refetch and let the audit-feed dedup decide whether the task
        // should still appear.
        await refetchRuns()
        const verdict = extractRecheckVerdict(result.result)
        if (verdict === 'pass') {
          showToast(`✅ ${row.task_id} now passes — removed from audit.`)
        } else if (verdict) {
          showToast(`Recheck complete: ${verdict}. Row updated.`)
        } else {
          showToast('Recheck complete. List refreshed.')
        }
      } catch (e) {
        showToast(`Recheck failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setRecheckBusy(prev => {
          const next = { ...prev }
          delete next[row.id]
          return next
        })
      }
      return
    }
  }

  const showToast = (msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(null), 3000)
  }

  // Multi-select helpers (Phase 1.10aq).
  const failedRowIds = useMemo(
    () => rows.filter((r) => r.verdict === 'fail').map((r) => r.id),
    [rows],
  )

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function selectAllRows() {
    setSelected(new Set(rows.map((r) => r.id)))
  }
  function selectFailedRows() {
    setSelected(new Set(failedRowIds))
  }
  function clearRowSelection() {
    setSelected(new Set())
  }

  function buildBatchItems(): BatchDiagnoseItem[] {
    const items: BatchDiagnoseItem[] = []
    for (const id of selected) {
      const row = rows.find((r) => r.id === id)
      if (!row) continue
      items.push({
        kind: row.source === 'verifier' ? 'verifier_run' : 'designer_audit',
        ref: row.id,
        payload: {
          task_id: row.task_id,
          commit_sha: row.commit_sha,
          verdict: row.verdict,
          gaps: row.gaps ?? [],
          raw: row.raw ?? {},
        },
      })
    }
    return items
  }

  async function handleDiagnoseAll() {
    const items = buildBatchItems()
    if (items.length === 0) {
      showToast('No rows selected.')
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
      showToast(`Diagnosed ${result.results.length} row${result.results.length === 1 ? '' : 's'}.`)
    } catch (err) {
      showToast(`Batch diagnose failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBatchBusy(false)
    }
  }

  async function handleCopyCcPromptBatch() {
    const items = buildBatchItems()
    if (items.length === 0) {
      showToast('No rows selected.')
      return
    }
    setBatchBusy(true)
    try {
      const result = await diagnoseBatch(items)
      const cc = result.combined.claude_code
      if (!cc) {
        showToast('No Claude Code prompts in the selection.')
        setBatchResult({ result, items })
      } else {
        try {
          await navigator.clipboard.writeText(cc.prompt)
          showToast(`Copied combined CC prompt (${cc.items.length} issue${cc.items.length === 1 ? '' : 's'}).`)
        } catch {
          showToast('Clipboard write failed — open the result card to copy.')
        }
        setBatchResult({ result, items })
      }
    } catch (err) {
      showToast(`Diagnose failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBatchBusy(false)
    }
  }

  function handleDiscussAllBatch() {
    const items = buildBatchItems()
    if (items.length === 0) {
      showToast('No rows selected.')
      return
    }
    const seed = `Discuss ${items.length} audit row${items.length === 1 ? '' : 's'} together:\n\n${items
      .map((it, i) => `${i + 1}. [${it.kind}] ${it.payload['task_id'] ?? it.ref.slice(0, 8)} — ${it.payload['verdict'] ?? '?'}`)
      .join('\n')}\n\nWhat's your take — auto-fix all, escalate, or split?`
    window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: seed }))
    showToast('Sent combined discussion to chat.')
  }

  function handleDismissAllBatch() {
    showToast(`Dismissed ${selected.size} row${selected.size === 1 ? '' : 's'} from this view.`)
    clearRowSelection()
  }

  async function handleAutoFixNow(rowId: string) {
    const row = rows.find((r) => r.id === rowId)
    if (!row || !diagnosis || diagnosis.bucket.bucket !== 'auto-remediate') return
    setAutoFixState((s) => ({ ...s, [rowId]: 'queueing' }))
    try {
      await autoFixQueue({
        kind: row.source === 'verifier' ? 'verifier_run' : 'designer_audit',
        ref: row.id,
        payload: {
          task_id: row.task_id,
          commit_sha: row.commit_sha,
          verdict: row.verdict,
          gaps: row.gaps ?? [],
        },
        spec_filename: diagnosis.bucket.spec_filename,
        spec_body: diagnosis.bucket.spec_body,
      })
      setAutoFixState((s) => ({ ...s, [rowId]: 'queued' }))
      showToast(`Queued ${diagnosis.bucket.spec_filename}. Atlas will report back when Builder ships + audits.`)
    } catch (err) {
      setAutoFixState((s) => ({ ...s, [rowId]: 'failed' }))
      showToast(`Auto-fix queue failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <TabFrame
      title="Audit"
      hint="Live audit feed across the build pipeline."
      rightSlot={
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
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
                  'px-2 sm:px-3 py-1 sm:py-0.5 text-[11px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 min-h-[32px] sm:min-h-0',
                  filter === f.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 active:bg-slate-100 dark:active:bg-slate-900',
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
        <div className="space-y-2">
          <BatchDiagnoseToolbar
            total={rows.length}
            selected={selected.size}
            failedCount={failedRowIds.length}
            onSelectAll={selectAllRows}
            onSelectFailed={selectFailedRows}
            onClearSelection={clearRowSelection}
            onDiagnoseAll={handleDiagnoseAll}
            onDiscussAll={handleDiscussAllBatch}
            onCopyCcPrompt={handleCopyCcPromptBatch}
            onDismissAll={handleDismissAllBatch}
            busy={batchBusy}
            estCostUsd={selected.size * 0.025}
          />
          {batchResult && (
            <CombinedDiagnosisCard
              result={batchResult.result}
              originalItems={batchResult.items}
              onClose={() => setBatchResult(null)}
              onToast={showToast}
            />
          )}
          <ol className="space-y-1.5">
            {rows.map(row => (
              <li key={row.id} className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    className="mt-3 shrink-0"
                    aria-label={`Select audit row ${row.task_id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <AuditRow
                      row={row}
                      onAction={handleAction}
                      recheckBusy={!!recheckBusy[row.id]}
                    />
                  </div>
                </div>
                {diagnosing === row.id && (
                  <div role="status" aria-live="polite" className="ml-6 text-[11px] text-slate-500 italic">
                    Diagnosing…
                  </div>
                )}
                {diagnosis?.rowId === row.id && (
                  <DiagnosisCard
                    row={row}
                    bucket={diagnosis.bucket}
                    cascade={diagnosis.cascade}
                    autoFixState={autoFixState[row.id]}
                    onAutoFixNow={() => handleAutoFixNow(row.id)}
                    onClose={() => setDiagnosis(null)}
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
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

function extractRecheckVerdict(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  // Verifier returns { verdict: 'pass' | 'fail' | 'unknown' }.
  // Designer returns the same shape.
  const v = r.verdict
  return typeof v === 'string' ? v : null
}

function normalizeDesignerVerdict(verdict: string): AuditVerdict {
  if (verdict === 'pass') return 'pass'
  if (verdict === 'fail') return 'fail'
  if (verdict === 'partial') return 'partial'
  return 'unknown'
}

function DiagnosisCard({
  row,
  bucket,
  cascade,
  autoFixState,
  onAutoFixNow,
  onClose,
}: {
  row: AuditRowData
  bucket: DiagnosisBucket
  cascade?: Record<number, CascadeRelation>
  autoFixState?: 'queueing' | 'queued' | 'failed'
  onAutoFixNow?: () => void
  onClose: () => void
}) {
  const baseClass = 'ml-6 rounded-xl border px-3 py-2 text-xs space-y-1.5'
  const buttonFocus = 'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50'

  const cascadeChips = cascade && Object.keys(cascade).length > 0 ? (
    <div className="flex flex-wrap gap-1 pt-1">
      {Object.entries(cascade).map(([idx, rel]) => {
        const gap = (row.gaps?.[Number(idx)] ?? null) as { check?: string; file?: string } | null
        return (
          <div key={idx} className="flex items-center gap-1.5 text-[11px]">
            <span className="text-slate-500">
              {gap?.check ?? `gap ${idx}`}{gap?.file ? ` · ${gap.file.split('/').pop()}` : ''}:
            </span>
            <CascadeChip relation={rel} />
          </div>
        )
      })}
    </div>
  ) : null

  if (bucket.bucket === 'auto-remediate') {
    const buttonsDisabled = autoFixState === 'queueing' || autoFixState === 'queued'
    return (
      <Card className={cn(baseClass, 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200')}>
        <CardHeader className="flex items-center justify-between gap-3 p-3">
          <span className="font-semibold uppercase tracking-wider text-[10px]">Auto-remediate</span>
          <button onClick={onClose} aria-label="Dismiss auto-remediate suggestion" className={cn('text-emerald-700 dark:text-emerald-400 text-[11px] hover:underline', buttonFocus)}>
            Dismiss
          </button>
        </CardHeader>
        <CardContent className="pt-0 space-y-1.5">
          <p>{bucket.reason}</p>
          <p className="font-mono text-[11px]">spec: {bucket.spec_filename}</p>
          {cascadeChips}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onAutoFixNow}
              disabled={buttonsDisabled || !onAutoFixNow}
              className={cn(
                'rounded-md border border-emerald-400 dark:border-emerald-700 bg-emerald-600 text-white px-2 py-1 text-[11px] hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium',
                buttonFocus,
              )}
            >
              {autoFixState === 'queueing' ? 'Queueing…'
                : autoFixState === 'queued' ? '✓ Queued — Atlas watching'
                : 'Auto-fix now'}
            </button>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('atlas:chat-prefill', {
                    detail: `Generate a Claude Code prompt instead of auto-fix for ${row.task_id} — gaps:\n\n${(row.gaps ?? []).map((g, i) => {
                      const gg = g as { check?: string; description?: string }
                      return `${i + 1}. [${gg.check ?? 'gap'}] ${gg.description ?? ''}`
                    }).join('\n')}`,
                  }),
                )
              }}
              className={cn(
                'rounded-md border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] hover:bg-emerald-100 dark:hover:bg-emerald-900/40',
                buttonFocus,
              )}
            >
              Generate Claude Code prompt instead
            </button>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('atlas:chat-prefill', {
                    detail: `Discuss the auto-fix Atlas suggested for ${row.task_id} (${bucket.spec_filename}) before queueing. Reason: ${bucket.reason}`,
                  }),
                )
              }}
              className={cn(
                'rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800',
                buttonFocus,
              )}
            >
              Discuss first
            </button>
          </div>
          {autoFixState === 'queued' && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300 italic">
              Atlas conductor will report ✅ resolved or ❌ failed once Builder ships and the next audit runs.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (bucket.bucket === 'claude-code') {
    return (
      <Card className={cn(baseClass, 'border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 text-sky-900 dark:text-sky-200')}>
        <CardHeader className="flex items-center justify-between gap-3 p-3">
          <span className="font-semibold uppercase tracking-wider text-[10px]">Needs Claude Code</span>
          <button onClick={onClose} aria-label="Dismiss Claude Code suggestion" className={cn('text-sky-700 dark:text-sky-400 text-[11px] hover:underline', buttonFocus)}>
            Dismiss
          </button>
        </CardHeader>
        <CardContent className="pt-0">
          <p>{bucket.reason}</p>
          {bucket.affected_files?.length > 0 && (
            <p className="font-mono text-[11px]">
              files: {bucket.affected_files.slice(0, 3).join(', ')}
              {bucket.affected_files.length > 3 ? ` +${bucket.affected_files.length - 3}` : ''}
            </p>
          )}
          {cascadeChips}
          <div className="flex gap-1.5 mt-1">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(bucket.prompt)
                } catch {
                  /* ignore */
                }
              }}
              className={cn(
                'rounded-md border border-sky-300 dark:border-sky-800 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] hover:bg-sky-100 dark:hover:bg-sky-900/40',
                buttonFocus,
              )}
            >
              Copy prompt
            </button>
            <a
              href="vscode://file/"
              className={cn(
                'rounded-md border border-sky-300 dark:border-sky-800 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] hover:bg-sky-100 dark:hover:bg-sky-900/40 no-underline',
                buttonFocus,
              )}
            >
              Open VS Code
            </a>
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px]">Show full prompt</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-900 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
              {bucket.prompt}
            </pre>
          </details>
        </CardContent>
      </Card>
    )
  }

  if (bucket.bucket === 'in-app-action') {
    return (
      <Card className={cn(baseClass, 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200')}>
        <CardHeader className="flex items-center justify-between gap-3 p-3">
          <span className="font-semibold uppercase tracking-wider text-[10px]">In-app action</span>
          <button onClick={onClose} aria-label="Dismiss in-app action" className={cn('text-amber-700 dark:text-amber-400 text-[11px] hover:underline', buttonFocus)}>
            Dismiss
          </button>
        </CardHeader>
        <CardContent className="pt-0">
          <p>{bucket.reason}</p>
          <p className="font-mono text-[11px]">{bucket.label}</p>
          {cascadeChips}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn(baseClass, 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300')}>
      <CardHeader className="flex items-center justify-between gap-3 p-3">
        <span className="font-semibold uppercase tracking-wider text-[10px]">Discuss</span>
        <button onClick={onClose} aria-label="Dismiss discussion" className={cn('text-slate-500 text-[11px] hover:underline', buttonFocus)}>
          Dismiss
        </button>
      </CardHeader>
      <CardContent className="pt-0">
        <p>{bucket.reason}</p>
        {cascadeChips}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: bucket.chat_seed }))}
          className={cn(
            'mt-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800',
            buttonFocus,
          )}
        >
          Send to chat
        </button>
      </CardContent>
    </Card>
  )
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
