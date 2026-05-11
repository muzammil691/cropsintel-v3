// 1.10bb-c Session 5 — Verifier-dialog modal popup.
//
// Mounted globally by AtlasCockpit. Renders an overlay whenever any
// atlas_dispatches row carries a non-null builder_pause_token. Operator picks
// RESUME (clears the token, builder loop continues) or ABORT (clears token +
// marks dispatch 'aborted').
//
// Visual style mirrors DecisionLogPanel.tsx: amber-50/40 ground, amber-200/60
// dividers, 11px headings, brown+yellow Maxons palette.

import { useEffect, useState } from 'react'
import { AlertTriangle, X, ShieldAlert, RotateCcw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  resumePausedDispatch,
  abortPausedDispatch,
  type PausedDispatch,
} from '@/lib/atlas-client'

interface VerifierDialogPopupProps {
  /** Paused dispatch the operator must triage. Null hides the popup. */
  paused: PausedDispatch | null
  /** Called after any terminal action (resume/abort) so the parent can refetch. */
  onResolved: () => void
  /** Optional explicit close (X button). Defaults to onResolved. */
  onClose?: () => void
  className?: string
}

export function VerifierDialogPopup({
  paused,
  onResolved,
  onClose,
  className,
}: VerifierDialogPopupProps) {
  const [busy, setBusy] = useState<'resume' | 'abort' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abortReason, setAbortReason] = useState('')
  const [confirmAbort, setConfirmAbort] = useState(false)

  // Reset transient state whenever a new pause surfaces.
  useEffect(() => {
    setBusy(null)
    setError(null)
    setAbortReason('')
    setConfirmAbort(false)
  }, [paused?.id])

  if (!paused) return null

  const { situation, paths } = parsePauseMessage(paused.error_message)
  const minutesRunning = Math.max(
    0,
    Math.round((Date.now() - new Date(paused.initiated_at).getTime()) / 60_000),
  )

  async function handleResume() {
    if (!paused) return
    setBusy('resume')
    setError(null)
    try {
      const r = await resumePausedDispatch(paused.id)
      if (!r.ok) throw new Error(r.reason ?? 'resume failed')
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleAbort() {
    if (!paused) return
    if (!confirmAbort) { setConfirmAbort(true); return }
    if (abortReason.trim().length < 3) {
      setError('Provide a short reason (≥3 chars) so the audit log explains the abort.')
      return
    }
    setBusy('abort')
    setError(null)
    try {
      const r = await abortPausedDispatch(paused.id, abortReason.trim())
      if (!r.ok) throw new Error(r.reason ?? 'abort failed')
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verifier-dialog-title"
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'bg-black/40 backdrop-blur-sm',
        className,
      )}
      onClick={(e) => {
        // Click-outside closes the popup but does NOT resolve the pause —
        // the operator must explicitly resume or abort.
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <section
        className={cn(
          'w-full max-w-lg rounded-lg shadow-xl overflow-hidden',
          'bg-amber-50/95 dark:bg-amber-950/90',
          'border border-amber-300/80 dark:border-amber-800/80',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-3 py-2.5 border-b border-amber-200/60 dark:border-amber-900/40 bg-amber-100/60 dark:bg-amber-950/50">
          <ShieldAlert className="size-4 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />
          <h2
            id="verifier-dialog-title"
            className="text-[11px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 truncate"
          >
            Verifier paused this build
          </h2>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-700/80 dark:text-amber-300/80 tabular-nums">
            <Clock className="size-3" aria-hidden />
            {minutesRunning}m
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded p-0.5 text-amber-700 dark:text-amber-300 hover:bg-amber-200/60 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          )}
        </header>

        <div className="px-3 py-3 space-y-3">
          <section className="rounded-md border border-amber-200 dark:border-amber-900 bg-white/60 dark:bg-amber-950/40 px-2.5 py-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5 mb-1">
              <AlertTriangle className="size-3 text-amber-700 dark:text-amber-300" aria-hidden />
              Situation
            </h3>
            <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
              {situation || 'Verifier paused the build but did not record a reason.'}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>
                <span className="text-slate-400">tool</span>{' '}
                <code className="font-mono text-slate-700 dark:text-slate-200">{paused.tool}</code>
              </span>
              <span>
                <span className="text-slate-400">dispatch</span>{' '}
                <code className="font-mono text-slate-700 dark:text-slate-200">
                  {paused.id.slice(0, 8)}…
                </code>
              </span>
            </div>
          </section>

          {paths.length > 0 && (
            <section className="rounded-md border border-amber-200 dark:border-amber-900 bg-white/60 dark:bg-amber-950/40 px-2.5 py-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 mb-1">
                Options ({paths.length})
              </h3>
              <ul className="space-y-1">
                {paths.slice(0, 4).map((p, i) => (
                  <li
                    key={`${i}-${p.slice(0, 16)}`}
                    className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug flex items-baseline gap-1.5"
                  >
                    <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300 shrink-0">
                      {i + 1}.
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {confirmAbort && (
            <section className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 px-2.5 py-2">
              <label
                htmlFor="verifier-abort-reason"
                className="text-[10px] font-semibold uppercase tracking-wider text-rose-900 dark:text-rose-200 block mb-1"
              >
                Abort reason (logged)
              </label>
              <Textarea
                id="verifier-abort-reason"
                value={abortReason}
                onChange={(e) => setAbortReason(e.target.value)}
                placeholder="e.g. spec was wrong; cancel and re-plan"
                rows={2}
                className="text-[11px] bg-white/80 dark:bg-slate-950/40 border-rose-200 dark:border-rose-800"
              />
            </section>
          )}

          {error && (
            <p
              role="alert"
              className="rounded border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-700 dark:text-rose-300"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-amber-200/60 dark:border-amber-900/40 bg-amber-100/40 dark:bg-amber-950/40">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={handleResume}
            className="h-7 px-2 text-[11px] border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/40"
          >
            <RotateCcw className="size-3 mr-1" aria-hidden />
            {busy === 'resume' ? 'Resuming…' : 'Resume'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={handleAbort}
            className="h-7 px-2 text-[11px] border-rose-300 text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/40"
          >
            <X className="size-3 mr-1" aria-hidden />
            {busy === 'abort' ? 'Aborting…' : confirmAbort ? 'Confirm abort' : 'Abort'}
          </Button>
        </footer>
      </section>
    </div>
  )
}

/**
 * The verifier-dialog WhatsApp message format is:
 *   "[Atlas Verifier] Build paused: <reason>. Options: 1. … / 2. …. Reply RESUME or ABORT."
 *
 * The same text is mirrored into atlas_dispatches.error_message so the cockpit
 * can render situation + paths without an extra round-trip. The parser is
 * tolerant — anything we can't split falls back to "show the raw message as
 * situation, no paths".
 */
function parsePauseMessage(raw: string | null): { situation: string; paths: string[] } {
  if (!raw) return { situation: '', paths: [] }
  const cleaned = raw.replace(/^\[Atlas Verifier\]\s*/i, '').trim()
  const optionsMatch = cleaned.match(/Options?:\s*([^.]+?)(?:\.\s*Reply\s+RESUME\s+or\s+ABORT|$)/i)
  if (!optionsMatch) return { situation: cleaned, paths: [] }
  const beforeOptions = cleaned.slice(0, optionsMatch.index ?? 0).trim().replace(/\.$/, '')
  const optionList = optionsMatch[1]
    .split(/\s*\/\s*|\n+/)
    .map((p) => p.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean)
  return {
    situation: beforeOptions.replace(/^Build paused:\s*/i, ''),
    paths: optionList,
  }
}

export default VerifierDialogPopup
