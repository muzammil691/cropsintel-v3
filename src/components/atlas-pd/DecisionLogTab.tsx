// Phase 1.10ac — DecisionLogTab
//
// Append-only chronological list of pd_decisions. Filterable by date range and
// verdict. The UI explicitly avoids edit/delete affordances — this is history,
// not a worksheet.

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { usePdDecisions } from '@/hooks/usePdDecisions'
import { listProposals, type PdProposal, type PdDecisionVerdict } from '@/lib/pd-client'
import { cn } from '@/lib/utils'

const VERDICTS: PdDecisionVerdict[] = ['approved', 'rejected', 'changes-requested']

export function DecisionLogTab() {
  const [verdict, setVerdict] = useState<PdDecisionVerdict | undefined>()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [proposals, setProposals] = useState<PdProposal[]>([])

  const { decisions, loading, error } = usePdDecisions({
    verdict,
    fromDate: from || undefined,
    toDate: to ? new Date(new Date(to).getTime() + 24 * 3600 * 1000).toISOString() : undefined,
  })

  useEffect(() => {
    let cancelled = false
    void listProposals().then((p) => { if (!cancelled) setProposals(p) })
    return () => { cancelled = true }
  }, [])

  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of proposals) m.set(p.id, p.title)
    return m
  }, [proposals])

  return (
    <div className="px-4 py-5 max-w-4xl mx-auto">
      <h2 className="text-base font-semibold mb-1">Decision Log</h2>
      <p className="text-xs text-slate-500 mb-4">
        Append-only history of every PD decision. Cannot be edited.
      </p>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <button
          type="button"
          onClick={() => setVerdict(undefined)}
          aria-pressed={verdict == null}
          className={cn(
            'h-7 px-2.5 rounded-full text-[11px] font-medium border',
            verdict == null
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
          )}
        >
          All verdicts
        </button>
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVerdict(v)}
            aria-pressed={verdict === v}
            className={cn(
              'h-7 px-2.5 rounded-full text-[11px] font-medium border capitalize',
              verdict === v
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
            )}
          >
            {v.replace('-', ' ')}
          </button>
        ))}
        <span className="ml-2 text-[11px] text-slate-500">From</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]" />
        <span className="text-[11px] text-slate-500">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]" />
      </div>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading && decisions.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading decisions…
        </div>
      ) : decisions.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No decisions match these filters.</p>
      ) : (
        <ol className="space-y-2">
          {decisions.map((d) => (
            <li
              key={d.id}
              className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
                <time dateTime={d.created_at}>{new Date(d.created_at).toLocaleString()}</time>
                <VerdictBadge verdict={d.verdict} />
              </div>
              <p className="text-sm font-medium mt-0.5">{titleById.get(d.proposal_id) ?? '(deleted proposal)'}</p>
              <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">{d.rationale}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function VerdictBadge({ verdict }: { verdict: PdDecisionVerdict }) {
  const map: Record<PdDecisionVerdict, string> = {
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    'changes-requested': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  }
  return (
    <span className={cn('inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium uppercase tracking-wide', map[verdict])}>
      {verdict.replace('-', ' ')}
    </span>
  )
}
