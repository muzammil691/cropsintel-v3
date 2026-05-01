// Phase 1.10ac — ReviewBundlesTab
//
// List of pd_review_bundles with a Create dialog (title, description,
// multi-select proposals). Selected bundle renders as full-width markdown
// with copy + download buttons.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Copy, Download } from 'lucide-react'
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
  listReviewBundles,
  createReviewBundle,
  listProposals,
  listAllDecisions,
  listAllEvidence,
  renderBundleMarkdown,
  type PdReviewBundle,
  type PdProposal,
  type PdDecision,
  type PdEvidence,
} from '@/lib/pd-client'
import { cn } from '@/lib/utils'

export function ReviewBundlesTab() {
  const { user } = useAuth()
  const [bundles, setBundles] = useState<PdReviewBundle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<PdReviewBundle | null>(null)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const data = await listReviewBundles()
      setBundles(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  return (
    <div className="px-4 py-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold">Review Bundles</h2>
          <p className="text-xs text-slate-500">Group proposals + evidence + decisions for stakeholder share.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={!user}>
          <Plus className="size-3.5" /> Create bundle
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 mb-3 text-xs rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading bundles…
        </div>
      ) : bundles.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No bundles yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ul className="lg:col-span-1 space-y-1.5">
            {bundles.map((b) => {
              const isSelected = selected?.id === b.id
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(b)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                      isSelected
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-800',
                    )}
                  >
                    <p className="text-sm font-medium truncate">{b.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {b.proposal_ids.length} proposal{b.proposal_ids.length === 1 ? '' : 's'} · {new Date(b.created_at).toLocaleDateString()}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="lg:col-span-2">
            {selected ? (
              <BundlePreview bundle={selected} />
            ) : (
              <p className="text-sm text-slate-500 py-12 text-center">Select a bundle to preview.</p>
            )}
          </div>
        </div>
      )}

      {creating && (
        <CreateBundleDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false)
            setSelected(b)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function BundlePreview({ bundle }: { bundle: PdReviewBundle }) {
  const md = bundle.exported_markdown ?? '(no rendered markdown)'

  const onCopy = async () => {
    try { await navigator.clipboard.writeText(md) } catch { /* no-op */ }
  }

  const onDownload = () => {
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bundle.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <h3 className="text-sm font-semibold flex-1 truncate">{bundle.title}</h3>
        <Button size="xs" variant="outline" onClick={onCopy}>
          <Copy className="size-3" /> Copy
        </Button>
        <Button size="xs" variant="outline" onClick={onDownload}>
          <Download className="size-3" /> Download .md
        </Button>
      </div>
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono p-3 max-h-[60vh] overflow-auto">
        {md}
      </pre>
    </div>
  )
}

function CreateBundleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (bundle: PdReviewBundle) => void
}) {
  const { user } = useAuth()
  const [proposals, setProposals] = useState<PdProposal[]>([])
  const [decisions, setDecisions] = useState<PdDecision[]>([])
  const [evidence, setEvidence] = useState<PdEvidence[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listProposals(), listAllDecisions(), listAllEvidence()])
      .then(([p, d, e]) => {
        if (cancelled) return
        setProposals(p)
        setDecisions(d)
        setEvidence(e)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const decisionsByProposal = useMemo(() => {
    const m: Record<string, PdDecision[]> = {}
    for (const d of decisions) (m[d.proposal_id] ??= []).push(d)
    return m
  }, [decisions])

  const evidenceByProposal = useMemo(() => {
    const m: Record<string, PdEvidence[]> = {}
    for (const e of evidence) (m[e.proposal_id] ??= []).push(e)
    return m
  }, [evidence])

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (!user || selectedIds.size === 0 || !title.trim()) return
    setSaving(true); setError(null)
    try {
      const ids = Array.from(selectedIds)
      const md = await renderBundleMarkdown(
        { title, description, proposal_ids: ids },
        proposals,
        decisionsByProposal,
        evidenceByProposal,
      )
      const bundle = await createReviewBundle({
        title,
        description,
        proposal_ids: ids,
        exported_markdown: md,
        created_by: user.id,
      })
      onCreated(bundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create review bundle</DialogTitle>
          <DialogDescription>
            Pick proposals to include. Markdown is generated at create time and stored on the bundle.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            id="bundle-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bundle title (e.g. 'Phase 1.10 deliverables — week of May 1')"
            aria-label="Bundle title"
            className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
            maxLength={200}
          />
          <textarea
            id="bundle-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description / context for stakeholders."
            aria-label="Bundle description"
            className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
            maxLength={1000}
          />

          <div className="border border-slate-200 dark:border-slate-800 rounded-md max-h-72 overflow-y-auto">
            {loading ? (
              <p className="p-3 text-xs text-slate-500"><Loader2 className="size-3 animate-spin inline mr-1" /> Loading…</p>
            ) : proposals.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">No proposals yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {proposals.map((p) => {
                  const checked = selectedIds.has(p.id)
                  return (
                    <li key={p.id}>
                      <label htmlFor={`bundle-proposal-${p.id}`} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-200">
                        <input
                          id={`bundle-proposal-${p.id}`}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(p.id)}
                          aria-label={`Include "${p.title}" in bundle`}
                          className="mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-medium truncate">{p.title}</span>
                          <span className="block text-[10px] text-slate-500">
                            {p.status} · {p.related_phase ?? 'no phase'}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-slate-500">{selectedIds.size} selected</p>
          {error && <p className="text-xs text-red-700 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving || selectedIds.size === 0 || !title.trim()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Generate bundle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
