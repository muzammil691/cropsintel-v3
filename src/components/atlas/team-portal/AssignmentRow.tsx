import { useState } from 'react'
import { CheckCircle2, AlertTriangle, X, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TeamAssignment } from '@/lib/atlas-client'

interface AssignmentRowProps {
  assignment: TeamAssignment
  /** When false the row is read-only (viewer role). */
  canAct: boolean
  onResolve: (id: string, status: 'fixed' | 'escalated' | 'dismissed', notes?: string) => Promise<void> | void
  busy?: boolean
}

const KIND_LABEL: Record<TeamAssignment['artifact_kind'], string> = {
  verifier_run: 'verifier audit fail',
  designer_audit: 'designer audit',
  open_fork: 'open fork',
  manual_report: 'manual report',
}

const KIND_ICON: Record<TeamAssignment['artifact_kind'], string> = {
  verifier_run: '❌',
  designer_audit: '🎨',
  open_fork: '🔀',
  manual_report: '📝',
}

function formatRelative(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function AssignmentRow({ assignment, canAct, onResolve, busy }: AssignmentRowProps) {
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const taskId = assignment.task_id ?? assignment.artifact_ref.slice(0, 12)
  const title = assignment.title ?? KIND_LABEL[assignment.artifact_kind]

  async function handleAction(status: 'fixed' | 'escalated' | 'dismissed') {
    setSubmitting(true)
    try {
      await onResolve(assignment.id, status, notes.trim() || undefined)
      setEscalateOpen(false)
      setNotes('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <li
      className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2.5"
      data-status={assignment.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span aria-hidden>{KIND_ICON[assignment.artifact_kind]}</span>
            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
              {title}
            </span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-xs text-slate-600 dark:text-slate-300 truncate">
              {taskId}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {formatRelative(assignment.created_at)}
            {assignment.assigned_to_display_name && (
              <> · for {assignment.assigned_to_display_name}</>
            )}
          </p>
        </div>
        <span
          className={
            assignment.status === 'open'
              ? 'shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-[10px] uppercase tracking-wide'
              : 'shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 text-[10px] uppercase tracking-wide'
          }
        >
          {assignment.status}
        </span>
      </div>

      {canAct && assignment.status === 'open' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            disabled={busy || submitting}
            onClick={() => void handleAction('fixed')}
          >
            <CheckCircle2 className="size-3" /> Mark as fixed
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            disabled={busy || submitting}
            onClick={() => setEscalateOpen((v) => !v)}
          >
            <AlertTriangle className="size-3" /> Send to owner
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-slate-500"
            disabled={busy || submitting}
            onClick={() => void handleAction('dismissed')}
          >
            <X className="size-3" /> Dismiss
          </Button>
          <a
            href={`/atlas?tab=artifacts&focus=${encodeURIComponent(assignment.artifact_ref)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <ExternalLink className="size-3" /> View detail
          </a>
        </div>
      )}

      {!canAct && assignment.status === 'open' && (
        <p className="mt-2 text-[11px] italic text-slate-400">
          Read-only view — sign in as operator or admin to take action.
        </p>
      )}

      {escalateOpen && canAct && (
        <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 p-2">
          <label className="block text-[11px] text-amber-900 dark:text-amber-200">
            Escalation note (sent to owner)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-slate-950 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
            placeholder="What does the owner need to know?"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={submitting}
              onClick={() => {
                setEscalateOpen(false)
                setNotes('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={submitting}
              onClick={() => void handleAction('escalated')}
            >
              {submitting ? 'Sending…' : 'Send to owner'}
            </Button>
          </div>
        </div>
      )}

      {assignment.resolution_notes && assignment.status !== 'open' && (
        <p className="mt-1.5 text-[11px] text-slate-500 italic">
          “{assignment.resolution_notes}”
        </p>
      )}
    </li>
  )
}
