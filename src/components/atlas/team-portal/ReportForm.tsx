import { useRef, useState, type FormEvent, type ChangeEvent } from 'react'
import { Paperclip, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  submitTeamReport,
  uploadChatAttachments,
  type ChatAttachment,
  type SubmitTeamReportInput,
  type TeamReportSeverity,
} from '@/lib/atlas-client'

interface ReportFormProps {
  onSubmitted?: (info: { whatsappSent: boolean; severity: TeamReportSeverity }) => void
}

const SEVERITIES: TeamReportSeverity[] = ['low', 'medium', 'high']
const SEVERITY_BLURB: Record<TeamReportSeverity, string> = {
  low: 'minor — owner sees it in the daily summary',
  medium: 'normal — owner sees it in the daily summary',
  high: 'urgent — owner gets a WhatsApp ping immediately',
}

export function ReportForm({ onSubmitted }: ReportFormProps) {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<TeamReportSeverity>('medium')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setSubject('')
    setDescription('')
    setSeverity('medium')
    setAttachments([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const result = await uploadChatAttachments(files, 'team-portal-report')
      if (result.ok) {
        setAttachments((prev) => [...prev, ...result.attachments])
      } else {
        setError(`Upload failed: ${result.error}${result.detail ? ` — ${result.detail}` : ''}`)
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !description.trim()) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const payload: SubmitTeamReportInput = {
        subject: subject.trim(),
        description: description.trim(),
        severity,
        attachments,
      }
      const result = await submitTeamReport(payload)
      const note = severity === 'high'
        ? `Report sent. Owner pinged via WhatsApp${result.whatsapp_sent ? '' : ' (delivery pending)'}.`
        : 'Report sent. Owner will see it in the daily summary.'
      setInfo(note)
      onSubmitted?.({ whatsappSent: result.whatsapp_sent, severity })
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 space-y-3"
    >
      <div>
        <Label htmlFor="report-subject" className="text-[11px]">Subject</Label>
        <Input
          id="report-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="One-line summary"
          disabled={busy}
          className="mt-1"
          maxLength={140}
          required
        />
      </div>

      <div>
        <Label htmlFor="report-description" className="text-[11px]">Description</Label>
        <Textarea
          id="report-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened? Steps to reproduce, screenshots, anything that helps."
          disabled={busy}
          rows={4}
          className="mt-1"
          maxLength={4000}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <Label htmlFor="report-severity" className="text-[11px]">Severity</Label>
          <select
            id="report-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as TeamReportSeverity)}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">{SEVERITY_BLURB[severity]}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,application/pdf"
            onChange={(e) => void handleFiles(e)}
            disabled={busy || uploading}
            className="hidden"
            id="report-attachments"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={busy || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-3.5" />
            {uploading ? 'Uploading…' : 'Attach'}
          </Button>
          <Button
            type="submit"
            size="sm"
            className="h-9 gap-1.5"
            disabled={busy || uploading || !subject.trim() || !description.trim()}
          >
            <Send className="size-3.5" />
            {busy ? 'Sending…' : 'Submit report'}
          </Button>
        </div>
      </div>

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-[11px]">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1"
            >
              <span className="truncate max-w-[180px]" title={a.name}>{a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 rounded"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" aria-live="assertive" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {info && !error && (
        <p role="status" aria-live="polite" className="text-xs text-emerald-700 dark:text-emerald-400">
          {info}
        </p>
      )}
    </form>
  )
}
