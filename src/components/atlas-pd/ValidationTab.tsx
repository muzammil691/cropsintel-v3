// Phase 1.10ac — ValidationTab
//
// List of pd_auto_validation rows (latest first). Each row → expand to view
// full reasoning and gap list via ValidationCard.

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  listValidations,
  listProposals,
  type PdAutoValidation,
  type PdProposal,
} from '@/lib/pd-client'
import { ValidationCard } from './ValidationCard'

export function ValidationTab() {
  const [rows, setRows] = useState<PdAutoValidation[]>([])
  const [proposals, setProposals] = useState<PdProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([listValidations(), listProposals()])
      .then(([v, p]) => {
        if (cancelled) return
        setRows(v)
        setProposals(p)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of proposals) m.set(p.id, p.title)
    return m
  }, [proposals])

  return (
    <div className="px-4 py-5 max-w-4xl mx-auto">
      <h2 className="text-base font-semibold mb-1">Validation</h2>
      <p className="text-xs text-slate-500 mb-4">
        AI quality reviews of proposals (Claude). Advice — not a verdict.
      </p>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading validations…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">
          No AI reviews yet. Trigger one from a proposal modal's <strong>AI Review</strong> button.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const open = expanded === r.id
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                  aria-expanded={open}
                >
                  <span className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{titleById.get(r.proposal_id) ?? '(deleted proposal)'}</p>
                    <p className="text-[11px] text-slate-500">
                      {r.ai_model} · {new Date(r.created_at).toLocaleString()} · ${r.cost_usd.toFixed(4)}
                    </p>
                  </span>
                  <span className="text-[11px] uppercase font-semibold tracking-wide text-slate-500">
                    {r.verdict}
                  </span>
                </button>
                {open && (
                  <div className="mt-2">
                    <ValidationCard validation={r} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
