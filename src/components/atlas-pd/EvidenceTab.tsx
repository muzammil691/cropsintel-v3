// Phase 1.10ac — EvidenceTab
//
// Flat list of all pd_evidence rows, grouped by proposal. Filter by proposal
// title via search box.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import {
  listAllEvidence,
  listProposals,
  signedEvidenceUrl,
  type PdEvidence,
  type PdProposal,
} from '@/lib/pd-client'

export function EvidenceTab() {
  const [evidence, setEvidence] = useState<PdEvidence[]>([])
  const [proposals, setProposals] = useState<PdProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([listAllEvidence(), listProposals()])
      .then(([ev, props]) => {
        if (cancelled) return
        setEvidence(ev)
        setProposals(props)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const proposalById = useMemo(() => {
    const m = new Map<string, PdProposal>()
    for (const p of proposals) m.set(p.id, p)
    return m
  }, [proposals])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return evidence
    return evidence.filter((e) => {
      const proposal = proposalById.get(e.proposal_id)
      if (!proposal) return false
      return (
        proposal.title.toLowerCase().includes(s) ||
        (e.description ?? '').toLowerCase().includes(s) ||
        (e.artefact_url ?? '').toLowerCase().includes(s)
      )
    })
  }, [evidence, search, proposalById])

  const grouped = useMemo(() => {
    const m = new Map<string, PdEvidence[]>()
    for (const e of filtered) {
      const arr = m.get(e.proposal_id) ?? []
      arr.push(e)
      m.set(e.proposal_id, arr)
    }
    return m
  }, [filtered])

  return (
    <div className="px-4 py-5 max-w-5xl mx-auto">
      <h2 className="text-base font-semibold mb-1">Evidence</h2>
      <p className="text-xs text-slate-500 mb-4">
        Artefacts attached to proposals: commits, screenshots, audit reports, notes.
      </p>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by proposal or description…"
          aria-label="Filter evidence by proposal or description"
          id="evidence-search"
          className="w-full pl-7 pr-2 h-8 text-xs rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
        />
      </div>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading evidence…
        </div>
      ) : grouped.size === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">
          No evidence yet. Attach artefacts from a proposal modal.
        </p>
      ) : (
        <div className="space-y-5">
          {Array.from(grouped).map(([pid, items]) => {
            const proposal = proposalById.get(pid)
            return (
              <section key={pid}>
                <h3 className="text-sm font-semibold mb-1.5">
                  {proposal?.title ?? '(unknown proposal)'}
                  <span className="ml-2 text-[11px] font-normal text-slate-500">{items.length} item{items.length === 1 ? '' : 's'}</span>
                </h3>
                <ul className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((e) => <Row key={e.id} item={e} />)}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({ item }: { item: PdEvidence }) {
  const [resolved, setResolved] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (item.artefact_url && !/^https?:\/\//.test(item.artefact_url)) {
      void signedEvidenceUrl(item.artefact_url).then((u) => {
        if (!cancelled) setResolved(u)
      })
    }
    return () => { cancelled = true }
  }, [item.artefact_url])
  const href = item.artefact_url && /^https?:\/\//.test(item.artefact_url) ? item.artefact_url : resolved
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-xs">
      <span className="uppercase tracking-wide text-[10px] font-semibold text-slate-500 shrink-0 w-24">
        {item.artefact_type}
      </span>
      <span className="flex-1 min-w-0 truncate">{item.description ?? item.artefact_url ?? '(no description)'}</span>
      <span className="text-slate-500 text-[10px] shrink-0">{new Date(item.created_at).toLocaleDateString()}</span>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 transition-colors duration-200 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50">
          Open
        </a>
      )}
    </li>
  )
}
