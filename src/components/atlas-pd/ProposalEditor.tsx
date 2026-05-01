// Phase 1.10ac — ProposalEditor
//
// Create / edit dialog for pd_proposals. Markdown-friendly textarea (no live
// preview yet — keeps the dialog tight for v0). Title + description required.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { createProposal, updateProposal, type PdProposal } from '@/lib/pd-client'

interface Props {
  mode: 'create' | 'edit'
  open: boolean
  initial?: PdProposal | null
  onOpenChange: (open: boolean) => void
  onSaved: (proposal: PdProposal) => void
}

export function ProposalEditor({ mode, open, initial, onOpenChange, onSaved }: Props) {
  const { user } = useAuth()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [motivation, setMotivation] = useState(initial?.motivation ?? '')
  const [relatedPhase, setRelatedPhase] = useState(initial?.related_phase ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      const proposal =
        mode === 'create'
          ? await createProposal({
              title,
              description,
              motivation: motivation || null,
              related_phase: relatedPhase || null,
              proposer_id: user.id,
            })
          : await updateProposal(initial!.id, {
              title,
              description,
              motivation: motivation || null,
              related_phase: relatedPhase || null,
            })
      onSaved(proposal)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New proposal' : 'Edit proposal'}</DialogTitle>
          <DialogDescription>Markdown is supported in description and motivation.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Title" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
              placeholder="Short, specific name (e.g. 'Auto-extract proposal gaps from Builder retrospectives')"
              maxLength={200}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Related phase">
              <input
                type="text"
                value={relatedPhase ?? ''}
                onChange={(e) => setRelatedPhase(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                placeholder="e.g. 1.10ac"
                maxLength={32}
              />
            </Field>
            <Field label="Status">
              <input
                type="text"
                value={initial?.status ?? 'draft'}
                disabled
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-sm text-slate-500"
              />
            </Field>
          </div>

          <Field label="Motivation">
            <textarea
              value={motivation ?? ''}
              onChange={(e) => setMotivation(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40 resize-y"
              placeholder="Why this proposal exists. (1–3 sentences)"
              maxLength={1000}
            />
          </Field>

          <Field label="Description" required>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40 font-mono text-[12px] resize-y"
              placeholder="Markdown body. Cover scope, dependencies, success criteria, NEVER list."
            />
          </Field>

          {error && (
            <p className="text-xs text-red-700 dark:text-red-400" role="alert">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving || !title.trim() || !description.trim()}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mode === 'create' ? 'Create proposal' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
