// Phase 1.10bb-c Session 4 — Plan diff preview + approval gate.
//
// Renders the proposed plan diff from finalizeWorkshopSession (Q2: "Direct
// mutation with mandatory diff approval"). Each op is rendered with diff
// highlighting (added=green, removed=red, edited=blue, reordered=yellow)
// and an expandable detail row. Bottom action bar exposes Approve, Reject
// (requires reason), and Revise (re-opens the session for refinement).
//
// Approve currently calls a Session-3 stub endpoint (Session 6 wires real
// plan-mutator + autonomous queue trigger). Reject + Revise are fully
// implemented server-side already.

import { useState } from 'react'
import {
  Check,
  CircleDashed,
  Edit3,
  FileDiff,
  Loader2,
  RotateCcw,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  approvePlanDiff,
  rejectPlanDiff,
  reviseWorkshopDiff,
  type PlanDiffOp,
  type PlanDiffRow,
} from '@/lib/atlas-client'

interface PlanDiffPreviewProps {
  diff: PlanDiffRow
  /** Called after a terminal action (approve/reject/revise) lands so the
   *  parent (PlanWorkshop) can refresh the session list + rail panels. */
  onResolved: (next: 'approved' | 'rejected' | 'revised') => void
  className?: string
}

const OP_META: Record<PlanDiffOp['op'], { label: string; icon: React.ComponentType<{ className?: string }>; toneClass: string }> = {
  add: {
    label: 'Add',
    icon: Edit3,
    toneClass: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30',
  },
  edit: {
    label: 'Edit',
    icon: Edit3,
    toneClass: 'border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30',
  },
  remove: {
    label: 'Remove',
    icon: Trash2,
    toneClass: 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30',
  },
  reorder: {
    label: 'Reorder',
    icon: CircleDashed,
    toneClass: 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30',
  },
}

export function PlanDiffPreview({ diff, onResolved, className }: PlanDiffPreviewProps) {
  const planDiff = diff.diff_jsonb
  const isResolved = !!(diff.approved_at || diff.rejected_at)
  const [busy, setBusy] = useState<'approve' | 'reject' | 'revise' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  async function handleApprove() {
    setBusy('approve')
    setError(null)
    try {
      await approvePlanDiff(diff.id)
      onResolved('approved')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleReject() {
    if (rejectReason.trim().length < 3) {
      setError('Reason required (≥3 characters).')
      return
    }
    setBusy('reject')
    setError(null)
    try {
      await rejectPlanDiff(diff.id, rejectReason.trim())
      onResolved('rejected')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleRevise() {
    setBusy('revise')
    setError(null)
    try {
      await reviseWorkshopDiff(diff.id)
      onResolved('revised')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      <header className="px-2 sm:px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-amber-50/60 dark:bg-amber-950/30">
        <div className="flex items-center gap-2 mb-1">
          <FileDiff className="size-4 text-amber-700 dark:text-amber-300" aria-hidden />
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Proposed plan diff
          </h2>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500 tabular-nums">
            {planDiff.ops.length} op{planDiff.ops.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          {planDiff.summary}
        </p>
        {planDiff.risks.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-100/60 dark:bg-amber-950/50 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-amber-900 dark:text-amber-200 mb-1">
              <AlertTriangle className="size-3" aria-hidden /> Risks called out by Atlas
            </div>
            <ul className="text-xs text-amber-900 dark:text-amber-100 space-y-0.5 list-disc pl-4">
              {planDiff.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2">
        {planDiff.ops.length === 0 ? (
          <p className="text-xs text-slate-500 italic px-2 py-3">
            No ops in this diff. Atlas concluded that the current plan is correct as-is. Click Approve to record that judgment without changes, Reject to discard, or Revise to keep refining.
          </p>
        ) : (
          planDiff.ops.map((op, i) => <OpCard key={i} op={op} index={i + 1} />)
        )}

        {planDiff.cited_decisions.length > 0 && (
          <section className="mt-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2">
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
              Cited decisions ({planDiff.cited_decisions.length})
            </h3>
            <ul className="space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
              {planDiff.cited_decisions.map((c, i) => (
                <li key={`${c.kind}-${c.ref}-${i}`} className="flex gap-1.5">
                  <span className="text-slate-400 shrink-0">•</span>
                  <div className="min-w-0">
                    <span className="font-medium">{c.label}</span>
                    {c.excerpt && (
                      <span className="text-slate-500 dark:text-slate-400">
                        {' '}— {c.excerpt}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 sm:px-3 py-2.5 space-y-2">
        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {isResolved && (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
            {diff.approved_at
              ? `Approved at ${new Date(diff.approved_at).toLocaleString()}.`
              : `Rejected at ${diff.rejected_at ? new Date(diff.rejected_at).toLocaleString() : 'unknown'}${diff.rejection_reason ? ` — ${diff.rejection_reason}` : ''}.`}
          </div>
        )}
        {showRejectInput && !isResolved && (
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Why reject? (required)
            </label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              placeholder="e.g. Phase 1.6 ordering doesn't match the launch tier I want."
              className="text-xs resize-none"
            />
          </div>
        )}
        {!isResolved && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRevise}
              disabled={busy !== null}
              className="text-xs h-8"
            >
              {busy === 'revise' ? (
                <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3 mr-1" aria-hidden />
              )}
              Revise
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (showRejectInput) {
                  void handleReject()
                } else {
                  setShowRejectInput(true)
                }
              }}
              disabled={busy !== null}
              className={cn(
                'text-xs h-8',
                showRejectInput && 'border-rose-400 text-rose-700 dark:border-rose-700 dark:text-rose-300',
              )}
            >
              {busy === 'reject' ? (
                <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
              ) : (
                <X className="size-3 mr-1" aria-hidden />
              )}
              {showRejectInput ? 'Confirm reject' : 'Reject'}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleApprove}
              disabled={busy !== null}
              className="text-xs h-8 sm:ml-auto bg-amber-700 hover:bg-amber-800 text-white transition-colors duration-200"
            >
              {busy === 'approve' ? (
                <Loader2 className="size-3 mr-1 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3 mr-1" aria-hidden />
              )}
              Approve
            </Button>
          </div>
        )}
      </footer>
    </div>
  )
}

function OpCard({ op, index }: { op: PlanDiffOp; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const meta = OP_META[op.op]
  const Icon = meta.icon

  return (
    <article
      className={cn(
        'rounded-md border px-3 py-2 transition-colors duration-150 cursor-pointer',
        meta.toneClass,
      )}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setExpanded((v) => !v)
        }
      }}
    >
      <header className="flex items-baseline gap-2 text-xs">
        <Icon className="size-3.5 mt-0.5 shrink-0 text-slate-700 dark:text-slate-200" aria-hidden />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-700 dark:text-slate-200">
          {index}. {meta.label}
        </span>
        <code className="font-mono text-[10px] text-slate-600 dark:text-slate-400 truncate">
          {opPrimaryLabel(op)}
        </code>
        {op.op === 'add' && (
          <span className="ml-auto text-[10px] text-emerald-700 dark:text-emerald-300">
            new phase
          </span>
        )}
        {op.op === 'remove' && (
          <span className="ml-auto text-[10px] text-rose-700 dark:text-rose-300">
            removed
          </span>
        )}
      </header>
      {expanded && (
        <div className="mt-2 text-[11px] text-slate-700 dark:text-slate-300 space-y-1 pl-5">
          <OpDetailBody op={op} />
        </div>
      )}
    </article>
  )
}

function opPrimaryLabel(op: PlanDiffOp): string {
  switch (op.op) {
    case 'add':
      return `${op.phase_id} — ${op.title}`
    case 'edit':
      return op.phase_id
    case 'remove':
      return op.phase_id
    case 'reorder':
      return `parent=${op.parent_id ?? '<root>'} (${op.ordered_phase_ids.length} children)`
  }
}

function OpDetailBody({ op }: { op: PlanDiffOp }) {
  switch (op.op) {
    case 'add':
      return (
        <>
          <KeyVal k="phase_id" v={op.phase_id} />
          <KeyVal k="parent_id" v={op.parent_id ?? '<root>'} />
          <KeyVal k="title" v={op.title} />
          {op.launch_tier && <KeyVal k="launch_tier" v={op.launch_tier} />}
          {op.body && (
            <div>
              <span className="text-slate-500">body:</span>
              <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 px-2 py-1 mt-0.5 max-h-48 overflow-y-auto">
                {op.body}
              </pre>
            </div>
          )}
        </>
      )
    case 'edit':
      return (
        <>
          <KeyVal k="phase_id" v={op.phase_id} />
          {op.title && <KeyVal k="new title" v={op.title} />}
          {op.launch_tier && <KeyVal k="new launch_tier" v={op.launch_tier} />}
          {op.body && (
            <div>
              <span className="text-slate-500">new body:</span>
              <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 px-2 py-1 mt-0.5 max-h-48 overflow-y-auto">
                {op.body}
              </pre>
            </div>
          )}
        </>
      )
    case 'remove':
      return (
        <>
          <KeyVal k="phase_id" v={op.phase_id} />
          {op.reason && <KeyVal k="reason" v={op.reason} />}
        </>
      )
    case 'reorder':
      return (
        <>
          <KeyVal k="parent_id" v={op.parent_id ?? '<root>'} />
          <div>
            <span className="text-slate-500">new order:</span>
            <ol className="list-decimal pl-4 mt-0.5 space-y-0">
              {op.ordered_phase_ids.map((pid, i) => (
                <li key={`${pid}-${i}`} className="font-mono text-[10px]">
                  {pid}
                </li>
              ))}
            </ol>
          </div>
        </>
      )
  }
}

function KeyVal({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="text-slate-500">{k}:</span>{' '}
      <span className="font-mono text-[10px] text-slate-700 dark:text-slate-300">{v}</span>
    </div>
  )
}

export default PlanDiffPreview
