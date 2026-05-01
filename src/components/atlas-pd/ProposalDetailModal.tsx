// Phase 1.10ac — ProposalDetailModal
//
// Full proposal view: title, status pill, related-phase, motivation,
// description (markdown), evidence list, decision history, AI Review
// summary card. Inline buttons for: Submit-for-review (draft → in-review),
// Mark-shipped (approved → shipped), Edit, Archive.

import { useEffect, useState } from 'react'
import { Loader2, Pencil, Send, Package, Archive } from 'lucide-react'
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
import {
  listEvidenceByProposal,
  listDecisionsByProposal,
  listValidationsByProposal,
  transitionProposal,
  createEvidence,
  uploadEvidenceFile,
  signedEvidenceUrl,
  type PdProposal,
  type PdEvidence,
  type PdDecision,
  type PdAutoValidation,
} from '@/lib/pd-client'
import { drAtlas } from '@/lib/drAtlas'
import { StatusPill } from './StatusPill'
import { ProposalEditor } from './ProposalEditor'
import { AiReviewButton } from './AiReviewButton'
import { ValidationCard } from './ValidationCard'

interface Props {
  proposal: PdProposal
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ProposalDetailModal({ proposal, open, onOpenChange, onChanged }: Props) {
  const { user } = useAuth()
  const [evidence, setEvidence] = useState<PdEvidence[]>([])
  const [decisions, setDecisions] = useState<PdDecision[]>([])
  const [validations, setValidations] = useState<PdAutoValidation[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkType, setLinkType] = useState<'commit' | 'note'>('note')

  const refresh = async () => {
    setLoading(true)
    try {
      const [ev, dec, val] = await Promise.all([
        listEvidenceByProposal(proposal.id),
        listDecisionsByProposal(proposal.id),
        listValidationsByProposal(proposal.id),
      ])
      setEvidence(ev)
      setDecisions(dec)
      setValidations(val)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposal.id])

  const submitForReview = async () => {
    if (!user) return
    setActing(true); setError(null)
    try {
      await transitionProposal(proposal, 'in-review', null)
      drAtlas.log('pd_proposal_submitted', 'ui', `Proposal "${proposal.title}" submitted for review`)
      onChanged()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  const markShipped = async () => {
    if (!user) return
    setActing(true); setError(null)
    try {
      await transitionProposal(proposal, 'shipped', {
        verdict: 'approved',
        rationale: 'Marked shipped after deployment.',
        decided_by: user.id,
      })
      drAtlas.log('pd_proposal_shipped', 'ui', `Proposal "${proposal.title}" shipped`)
      onChanged()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  const archive = async () => {
    if (!user) return
    setActing(true); setError(null)
    try {
      await transitionProposal(proposal, 'archived', null)
      drAtlas.log('pd_proposal_archived', 'ui', `Proposal "${proposal.title}" archived`)
      onChanged()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return
    setActing(true); setError(null)
    try {
      for (const f of Array.from(files)) {
        await uploadEvidenceFile(proposal.id, f, user.id)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  const addLink = async () => {
    if (!linkUrl.trim() || !user) return
    setActing(true); setError(null)
    try {
      await createEvidence({
        proposal_id: proposal.id,
        artefact_type: linkType,
        artefact_url: linkUrl.trim(),
        description: linkUrl.trim(),
        uploaded_by: user.id,
      })
      setLinkUrl('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (text && /^https?:\/\//.test(text)) {
              e.preventDefault()
              setLinkUrl(text)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            void onFiles(e.dataTransfer.files)
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <DialogTitle className="break-words">{proposal.title}</DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <StatusPill status={proposal.status} />
                  {proposal.related_phase && <span className="text-slate-500">phase {proposal.related_phase}</span>}
                  <span className="text-slate-500">created {new Date(proposal.created_at).toLocaleDateString()}</span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {error && (
            <div className="px-3 py-2 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          <Section title="Description">
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{proposal.description}</div>
          </Section>

          {proposal.motivation && (
            <Section title="Motivation">
              <div className="text-sm whitespace-pre-wrap text-slate-600 dark:text-slate-400">{proposal.motivation}</div>
            </Section>
          )}

          <Section title="AI Review">
            <div className="flex items-center gap-2 mb-2">
              <AiReviewButton proposalId={proposal.id} onComplete={() => refresh()} />
              <p className="text-[11px] text-slate-500">
                Sends the proposal to Claude for verdict + gap analysis.
              </p>
            </div>
            {validations.length === 0 ? (
              <p className="text-xs text-slate-500">No AI review yet.</p>
            ) : (
              <div className="space-y-2">
                {validations.map((v) => <ValidationCard key={v.id} validation={v} />)}
              </div>
            )}
          </Section>

          <Section title={`Evidence (${evidence.length})`}>
            <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-3 mb-2 text-xs text-slate-500 text-center">
              Drag &amp; drop files here, or paste a URL — both attach as evidence.
            </div>
            <div className="flex gap-2 mb-2">
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value as 'commit' | 'note')}
                aria-label="Evidence link type"
                className="h-8 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
              >
                <option value="note">note / link</option>
                <option value="commit">commit</option>
              </select>
              <input
                id="evidence-link-url"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Evidence link URL"
                className="flex-1 h-8 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
              />
              <Button size="sm" variant="outline" onClick={addLink} disabled={!linkUrl.trim() || acting}>
                Attach link
              </Button>
              <label className="inline-flex items-center h-8 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-200">
                Upload
                <input
                  id="evidence-file-upload"
                  type="file"
                  multiple
                  aria-label="Upload evidence files"
                  className="sr-only"
                  onChange={(e) => onFiles(e.target.files)}
                />
              </label>
            </div>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-slate-500" />
            ) : evidence.length === 0 ? (
              <p className="text-xs text-slate-500">No evidence attached.</p>
            ) : (
              <ul className="space-y-1">
                {evidence.map((e) => <EvidenceRow key={e.id} item={e} />)}
              </ul>
            )}
          </Section>

          <Section title={`Decisions (${decisions.length})`}>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-slate-500" />
            ) : decisions.length === 0 ? (
              <p className="text-xs text-slate-500">No decisions yet — go to Approvals to act on this proposal.</p>
            ) : (
              <ul className="space-y-2">
                {decisions.map((d) => (
                  <li key={d.id} className="text-xs border-l-2 border-slate-200 dark:border-slate-700 pl-2">
                    <p className="text-slate-600 dark:text-slate-400">
                      {new Date(d.created_at).toLocaleString()} · <span className="font-medium uppercase">{d.verdict}</span>
                    </p>
                    <p className="text-slate-800 dark:text-slate-200 mt-0.5">{d.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <DialogFooter className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={proposal.status === 'archived' || proposal.status === 'shipped'}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            {proposal.status === 'draft' && (
              <Button size="sm" onClick={submitForReview} disabled={acting}>
                <Send className="size-3.5" /> Submit for review
              </Button>
            )}
            {proposal.status === 'approved' && (
              <Button size="sm" onClick={markShipped} disabled={acting}>
                <Package className="size-3.5" /> Mark shipped
              </Button>
            )}
            {proposal.status !== 'archived' && (
              <Button variant="ghost" size="sm" onClick={archive} disabled={acting}>
                <Archive className="size-3.5" /> Archive
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && (
        <ProposalEditor
          mode="edit"
          initial={proposal}
          open={editing}
          onOpenChange={(o) => { if (!o) setEditing(false) }}
          onSaved={() => {
            setEditing(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 dark:border-slate-800 pt-3 mt-3 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">{title}</h3>
      {children}
    </section>
  )
}

function EvidenceRow({ item }: { item: PdEvidence }) {
  const [resolved, setResolved] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (item.artefact_url && !/^https?:\/\//.test(item.artefact_url)) {
      // storage bucket path → resolve to signed URL on demand
      void signedEvidenceUrl(item.artefact_url).then((u) => {
        if (!cancelled) setResolved(u)
      })
    }
    return () => { cancelled = true }
  }, [item.artefact_url])
  const href = item.artefact_url && /^https?:\/\//.test(item.artefact_url) ? item.artefact_url : resolved
  return (
    <li className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
      <span className="uppercase tracking-wide text-[10px] font-semibold text-slate-500 shrink-0 w-20">
        {item.artefact_type}
      </span>
      <span className="flex-1 min-w-0 truncate">{item.description ?? item.artefact_url ?? '(no description)'}</span>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 transition-colors duration-200">
          Open
        </a>
      )}
    </li>
  )
}
