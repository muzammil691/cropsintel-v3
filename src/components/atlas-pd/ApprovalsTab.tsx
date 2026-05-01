// Phase 1.10ac — ApprovalsTab
//
// Dense list of proposals where status = 'in-review'. Each row has inline
// Approve / Reject / Request-Changes buttons; clicking opens a dialog for
// rationale (required), which logs to pd_decisions and transitions the
// proposal status.

import { useState } from 'react'
import { Loader2, Check, X, MessageSquare } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { usePdProposals } from '@/hooks/usePdProposals'
import { transitionProposal, type PdProposal, type PdDecisionVerdict, type PdProposalStatus } from '@/lib/pd-client'
import { drAtlas } from '@/lib/drAtlas'

interface PendingDecision {
  proposal: PdProposal
  verdict: PdDecisionVerdict
}

export function ApprovalsTab() {
  const { proposals, loading, error, refresh } = usePdProposals({ status: 'in-review' })
  const [pending, setPending] = useState<PendingDecision | null>(null)

  return (
    <div className="px-4 py-5 max-w-4xl mx-auto">
      <h2 className="text-base font-semibold mb-1">Approvals</h2>
      <p className="text-xs text-slate-500 mb-4">
        Proposals waiting on a decision. Approve, reject, or request changes — rationale required.
      </p>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading && proposals.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : proposals.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">
          Inbox zero. No proposals waiting for review.
        </div>
      ) : (
        <ul className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {proposals.map((p) => (
            <li key={p.id} className="px-3 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {p.related_phase ? `${p.related_phase} · ` : ''}
                    submitted {new Date(p.updated_at).toLocaleString()}
                  </p>
                  {p.motivation && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-3">{p.motivation}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={() => setPending({ proposal: p, verdict: 'approved' })}>
                  <Check className="size-3.5" /> Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setPending({ proposal: p, verdict: 'rejected' })}>
                  <X className="size-3.5" /> Reject
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPending({ proposal: p, verdict: 'changes-requested' })}>
                  <MessageSquare className="size-3.5" /> Request changes
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <DecisionDialog
          decision={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function DecisionDialog({
  decision,
  onClose,
  onDone,
}: {
  decision: PendingDecision
  onClose: () => void
  onDone: () => void
}) {
  const { user } = useAuth()
  const [rationale, setRationale] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!user) return
    if (!rationale.trim()) {
      setError('Rationale required.')
      return
    }
    setSaving(true); setError(null)
    try {
      const next: PdProposalStatus =
        decision.verdict === 'approved' ? 'approved' :
        decision.verdict === 'rejected' ? 'rejected' :
        'draft' // changes-requested → back to draft for the proposer to revise
      await transitionProposal(decision.proposal, next, {
        verdict: decision.verdict,
        rationale,
        decided_by: user.id,
      })
      drAtlas.log('pd_decision', 'ui',
        `${decision.verdict} on "${decision.proposal.title}"`,
        { metadata: { proposal_id: decision.proposal.id, verdict: decision.verdict } },
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {decision.verdict === 'approved' && 'Approve proposal'}
            {decision.verdict === 'rejected' && 'Reject proposal'}
            {decision.verdict === 'changes-requested' && 'Request changes'}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-slate-700 dark:text-slate-300">{decision.proposal.title}</span>
            <span className="block mt-1 text-[11px]">
              Rationale is logged to the Decision Log immutably.
            </span>
          </DialogDescription>
        </DialogHeader>

        <textarea
          autoFocus
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
          placeholder="Why this decision? (required)"
        />

        {error && <p className="text-xs text-red-700 dark:text-red-400" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving || !rationale.trim()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
