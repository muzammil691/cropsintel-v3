// Phase 1.10ac — ProposalsTab
//
// Group-by-status table of pd_proposals with filter chips and a New Proposal
// button. Row click opens ProposalDetailModal. Filter state persists in URL.

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Loader2 } from 'lucide-react'
import { usePdProposals } from '@/hooks/usePdProposals'
import type { PdProposal, PdProposalStatus } from '@/lib/pd-client'
import { Button } from '@/components/ui/button'
import { ProposalDetailModal } from './ProposalDetailModal'
import { ProposalEditor } from './ProposalEditor'
import { cn } from '@/lib/utils'
import { StatusPill } from './StatusPill'

const STATUSES: PdProposalStatus[] = ['draft', 'in-review', 'approved', 'rejected', 'shipped', 'archived']

export function ProposalsTab() {
  const { proposals, loading, error, refresh } = usePdProposals()
  const [params, setParams] = useSearchParams()
  const filterParam = params.get('status')
  const filters = useMemo<Set<PdProposalStatus>>(() => {
    if (!filterParam) return new Set()
    return new Set(filterParam.split(',').filter((s) => STATUSES.includes(s as PdProposalStatus)) as PdProposalStatus[])
  }, [filterParam])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const setFilter = (status: PdProposalStatus) => {
    const next = new Set(filters)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    const newParams = new URLSearchParams(params)
    if (next.size === 0) newParams.delete('status')
    else newParams.set('status', Array.from(next).join(','))
    setParams(newParams, { replace: true })
  }

  const visible = useMemo(() => {
    if (filters.size === 0) return proposals
    return proposals.filter((p) => filters.has(p.status))
  }, [proposals, filters])

  const grouped = useMemo(() => {
    const map = new Map<PdProposalStatus, PdProposal[]>()
    for (const s of STATUSES) map.set(s, [])
    for (const p of visible) {
      map.get(p.status)?.push(p)
    }
    return map
  }, [visible])

  const counts = useMemo(() => {
    const c = new Map<PdProposalStatus, number>()
    for (const s of STATUSES) c.set(s, 0)
    for (const p of proposals) c.set(p.status, (c.get(p.status) ?? 0) + 1)
    return c
  }, [proposals])

  const selected = selectedId ? proposals.find((p) => p.id === selectedId) ?? null : null

  return (
    <div className="px-4 py-5 max-w-6xl mx-auto">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold">Proposals</h2>
          <p className="text-xs text-slate-500">Lifecycle: draft → in-review → approved | rejected → shipped.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> New proposal
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUSES.map((s) => {
          const active = filters.has(s)
          const count = counts.get(s) ?? 0
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={active}
              className={cn(
                'h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors duration-200 flex items-center gap-1 sm:gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                active
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              <span className="capitalize">{s.replace('-', ' ')}</span>
              <span className={cn('text-[10px] tabular-nums', active ? 'text-emerald-100' : 'text-slate-500')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading && proposals.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading proposals…
        </div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">
          No proposals match. Create your first with <strong>New proposal</strong>.
        </div>
      ) : (
        <div className="space-y-5">
          {STATUSES.map((s) => {
            const items = grouped.get(s) ?? []
            if (items.length === 0) return null
            return (
              <section key={s}>
                <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1.5 flex items-center gap-2">
                  {s.replace('-', ' ')}
                  <span className="text-slate-400">({items.length})</span>
                </h3>
                <ul className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.title}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {p.related_phase ? `${p.related_phase} · ` : ''}
                            updated {new Date(p.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <StatusPill status={p.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {selected && (
        <ProposalDetailModal
          proposal={selected}
          open={!!selected}
          onOpenChange={(o) => { if (!o) setSelectedId(null) }}
          onChanged={refresh}
        />
      )}

      {creating && (
        <ProposalEditor
          mode="create"
          open={creating}
          onOpenChange={(o) => { if (!o) setCreating(false) }}
          onSaved={(p) => {
            setCreating(false)
            setSelectedId(p.id)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
