// Phase 1.3a — Background-check checklist used inside the verified-tier review queue.
//
// Six structured checks from the spec — business reg, LinkedIn, website,
// references, trade history, WhatsApp confirmation. Each row has a checkbox,
// notes textarea, and an optional URL field. Auto-save on blur (debounced 1s)
// when the parent gives us a writable verification request. Read-only when
// the request is approved or rejected.

import { useEffect, useId, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

export type ChecklistDraft = {
  business_registration_verified?: boolean
  business_registration_notes?: string
  business_registration_url?: string
  linkedin_verified?: boolean
  linkedin_notes?: string
  linkedin_url?: string
  website_verified?: boolean
  website_notes?: string
  website_url?: string
  references_checked_count?: number
  references_notes?: string
  trade_history_reviewed?: boolean
  trade_history_notes?: string
  whatsapp_confirmation_done?: boolean
}

export interface BackgroundCheckChecklistProps {
  requestId: string
  initial: ChecklistDraft
  readOnly?: boolean
  onSaved?: (next: ChecklistDraft) => void
}

const DEBOUNCE_MS = 1000

export function BackgroundCheckChecklist({
  requestId,
  initial,
  readOnly = false,
  onSaved,
}: BackgroundCheckChecklistProps) {
  const [draft, setDraft] = useState<ChecklistDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    setDraft(initial)
    dirtyRef.current = false
  }, [initial, requestId])

  // Debounced auto-save
  useEffect(() => {
    if (readOnly || !dirtyRef.current) return
    const handle = setTimeout(async () => {
      setSaving(true)
      setError(null)
      const { error: updErr } = await supabase
        .from('verification_requests')
        .update(draft)
        .eq('id', requestId)
      setSaving(false)
      if (updErr) {
        setError(updErr.message)
        return
      }
      setSavedAt(Date.now())
      dirtyRef.current = false
      onSaved?.(draft)
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [draft, requestId, readOnly, onSaved])

  function update<K extends keyof ChecklistDraft>(key: K, value: ChecklistDraft[K]) {
    dirtyRef.current = true
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const completed = countCompleted(draft)
  const baseId = useId()
  const refsCountId = `${baseId}-refs-count`
  const refsNotesId = `${baseId}-refs-notes`
  const waConfirmId = `${baseId}-wa-confirm`

  return (
    <div className="space-y-2 sm:space-y-4">
      <div className="flex items-center justify-between text-xs sm:text-sm text-slate-500">
        <span>{completed}/6 checks complete</span>
        <span aria-live="polite">
          {error
            ? <span className="text-red-600">Error: {error}</span>
            : saving
              ? 'Saving…'
              : savedAt
                ? `Saved`
                : ''}
        </span>
      </div>

      <CheckRow
        idPrefix={`${baseId}-biz`}
        label="Business registration verified"
        verified={draft.business_registration_verified}
        notes={draft.business_registration_notes}
        url={draft.business_registration_url}
        readOnly={readOnly}
        onChange={(p) => {
          if (p.verified !== undefined) update('business_registration_verified', p.verified)
          if (p.notes !== undefined) update('business_registration_notes', p.notes)
          if (p.url !== undefined) update('business_registration_url', p.url)
        }}
      />

      <CheckRow
        idPrefix={`${baseId}-li`}
        label="LinkedIn profile verified"
        verified={draft.linkedin_verified}
        notes={draft.linkedin_notes}
        url={draft.linkedin_url}
        readOnly={readOnly}
        onChange={(p) => {
          if (p.verified !== undefined) update('linkedin_verified', p.verified)
          if (p.notes !== undefined) update('linkedin_notes', p.notes)
          if (p.url !== undefined) update('linkedin_url', p.url)
        }}
      />

      <CheckRow
        idPrefix={`${baseId}-web`}
        label="Website verified"
        verified={draft.website_verified}
        notes={draft.website_notes}
        url={draft.website_url}
        readOnly={readOnly}
        onChange={(p) => {
          if (p.verified !== undefined) update('website_verified', p.verified)
          if (p.notes !== undefined) update('website_notes', p.notes)
          if (p.url !== undefined) update('website_url', p.url)
        }}
      />

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <Label htmlFor={refsCountId} className="text-sm sm:text-base font-medium">References checked</Label>
          <Input
            id={refsCountId}
            type="number"
            min={0}
            max={20}
            value={draft.references_checked_count ?? 0}
            onChange={(e) => update('references_checked_count', Number(e.target.value) || 0)}
            disabled={readOnly}
            className="w-full sm:w-20 text-sm sm:text-base min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <Label htmlFor={refsNotesId} className="sr-only">Reference notes</Label>
        <Textarea
          id={refsNotesId}
          placeholder="Reference notes"
          value={draft.references_notes ?? ''}
          onChange={(e) => update('references_notes', e.target.value)}
          disabled={readOnly}
          className="w-full text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <CheckRow
        idPrefix={`${baseId}-trade`}
        label="Trade history reviewed"
        verified={draft.trade_history_reviewed}
        notes={draft.trade_history_notes}
        readOnly={readOnly}
        onChange={(p) => {
          if (p.verified !== undefined) update('trade_history_reviewed', p.verified)
          if (p.notes !== undefined) update('trade_history_notes', p.notes)
        }}
      />

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3">
        <Checkbox
          id={waConfirmId}
          checked={!!draft.whatsapp_confirmation_done}
          onChange={(e) => update('whatsapp_confirmation_done', e.target.checked)}
          disabled={readOnly}
          className="disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Label htmlFor={waConfirmId} className="flex-1 text-sm sm:text-base cursor-pointer">
          WhatsApp confirmation call completed
        </Label>
      </div>

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            dirtyRef.current = true
            setSaving(true)
            setError(null)
            const { error: updErr } = await supabase
              .from('verification_requests')
              .update(draft)
              .eq('id', requestId)
            setSaving(false)
            if (updErr) setError(updErr.message)
            else {
              setSavedAt(Date.now())
              dirtyRef.current = false
              onSaved?.(draft)
            }
          }}
          disabled={saving}
          className="w-full sm:w-auto min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3 transition-colors duration-200"
        >
          Save now
        </Button>
      )}
    </div>
  )
}

interface CheckRowProps {
  idPrefix: string
  label: string
  verified?: boolean
  notes?: string
  url?: string
  readOnly?: boolean
  onChange: (p: { verified?: boolean; notes?: string; url?: string }) => void
}

function CheckRow({ idPrefix, label, verified, notes, url, readOnly, onChange }: CheckRowProps) {
  const checkId = `${idPrefix}-check`
  const urlId = `${idPrefix}-url`
  const notesId = `${idPrefix}-notes`
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <div className="flex items-center gap-3">
        <Checkbox
          id={checkId}
          checked={!!verified}
          onChange={(e) => onChange({ verified: e.target.checked })}
          disabled={readOnly}
          className="disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Label htmlFor={checkId} className="flex-1 text-sm sm:text-base font-medium cursor-pointer">
          {label}
        </Label>
      </div>
      {url !== undefined && (
        <>
          <Label htmlFor={urlId} className="sr-only">{label} reference URL</Label>
          <Input
            id={urlId}
            type="url"
            placeholder="Reference URL"
            value={url ?? ''}
            onChange={(e) => onChange({ url: e.target.value })}
            disabled={readOnly}
            className="w-full text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </>
      )}
      <Label htmlFor={notesId} className="sr-only">{label} notes</Label>
      <Textarea
        id={notesId}
        placeholder="Notes"
        value={notes ?? ''}
        onChange={(e) => onChange({ notes: e.target.value })}
        disabled={readOnly}
        className="w-full text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  )
}

function countCompleted(d: ChecklistDraft): number {
  let n = 0
  if (d.business_registration_verified) n++
  if (d.linkedin_verified) n++
  if (d.website_verified) n++
  if ((d.references_checked_count ?? 0) > 0) n++
  if (d.trade_history_reviewed) n++
  if (d.whatsapp_confirmation_done) n++
  return n
}
