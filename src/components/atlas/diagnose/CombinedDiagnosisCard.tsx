import { useState } from 'react'
import { cn } from '@/lib/utils'
import { autoFixQueue, type BatchDiagnoseResult, type BatchDiagnoseItem } from '@/lib/atlas-client'

interface CombinedDiagnosisCardProps {
  result: BatchDiagnoseResult
  /**
   * The original batch input — needed to reattach kind/ref/payload when the
   * user clicks [Queue auto-fixes], since the per-row spec is keyed by ref.
   */
  originalItems: BatchDiagnoseItem[]
  onClose: () => void
  onToast: (msg: string) => void
}

export function CombinedDiagnosisCard({
  result,
  originalItems,
  onClose,
  onToast,
}: CombinedDiagnosisCardProps) {
  const [busy, setBusy] = useState<'queue' | 'cc' | 'discuss' | null>(null)
  const auto = result.combined.auto_remediate
  const cc = result.combined.claude_code
  const inApp = result.combined.in_app
  const discuss = result.combined.discuss
  const totalProcessed = result.results.length

  const buttonFocus =
    'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50'

  async function handleQueueAutoFixes() {
    if (busy || auto.length === 0) return
    setBusy('queue')
    let queued = 0
    for (const row of auto) {
      const orig = originalItems.find((i) => i.ref === row.ref && i.kind === row.kind)
      try {
        await autoFixQueue({
          kind: row.kind,
          ref: row.ref,
          payload: orig?.payload ?? {},
          spec_filename: row.spec_filename,
          spec_body: row.spec_body,
        })
        queued++
      } catch (err) {
        console.warn('[batch-diagnose] auto-fix queue failed for', row.ref, err)
      }
    }
    setBusy(null)
    onToast(`Queued ${queued} of ${auto.length} auto-fix specs.`)
  }

  async function handleCopyCc() {
    if (!cc || busy) return
    setBusy('cc')
    try {
      await navigator.clipboard.writeText(cc.prompt)
      onToast(
        `Copied combined Claude Code prompt covering ${cc.items.length} issue${cc.items.length === 1 ? '' : 's'}.`,
      )
    } catch {
      onToast('Clipboard write failed — open the prompt panel below to copy manually.')
    }
    setBusy(null)
  }

  function handleSendDiscuss() {
    if (!discuss || busy) return
    setBusy('discuss')
    window.dispatchEvent(new CustomEvent('atlas:chat-prefill', { detail: discuss.seed }))
    onToast('Combined discussion seeded into chat.')
    setBusy(null)
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-3 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Diagnosis result
          </p>
          <p className="text-sm font-medium">
            {totalProcessed} artifact{totalProcessed === 1 ? '' : 's'} processed
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close diagnosis result"
          className={cn(
            'text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100',
            buttonFocus,
          )}
        >
          Close
        </button>
      </div>

      <ul className="space-y-1 text-[11px]">
        <li className="flex items-center gap-2">
          <span aria-hidden>🟢</span>
          <span className="font-medium tabular-nums">{auto.length}</span>
          <span className="text-slate-600 dark:text-slate-300">
            Auto-fix candidate{auto.length === 1 ? '' : 's'}
            {auto.length > 0 && ' — 1 click to queue all'}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden>🔵</span>
          <span className="font-medium tabular-nums">{cc?.items.length ?? 0}</span>
          <span className="text-slate-600 dark:text-slate-300">
            Need Claude Code{cc && cc.items.length > 0 ? ' — 1 prompt covers all' : ''}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden>🟡</span>
          <span className="font-medium tabular-nums">{inApp.length}</span>
          <span className="text-slate-600 dark:text-slate-300">
            In-app action{inApp.length === 1 ? '' : 's'}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden>⚪</span>
          <span className="font-medium tabular-nums">{discuss?.items.length ?? 0}</span>
          <span className="text-slate-600 dark:text-slate-300">Discuss</span>
        </li>
      </ul>

      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={handleQueueAutoFixes}
          disabled={busy !== null || auto.length === 0}
          className={cn(
            'rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-[11px] hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed',
            buttonFocus,
          )}
        >
          {busy === 'queue' ? 'Queueing…' : `Queue ${auto.length} auto-fix${auto.length === 1 ? '' : 'es'}`}
        </button>
        <button
          type="button"
          onClick={handleCopyCc}
          disabled={busy !== null || !cc}
          className={cn(
            'rounded-md border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-2 py-1 text-[11px] hover:bg-sky-100 dark:hover:bg-sky-900/40 disabled:opacity-50 disabled:cursor-not-allowed',
            buttonFocus,
          )}
        >
          Copy combined CC prompt ({cc?.items.length ?? 0} issues)
        </button>
        <button
          type="button"
          onClick={handleSendDiscuss}
          disabled={busy !== null || !discuss}
          className={cn(
            'rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed',
            buttonFocus,
          )}
        >
          Send {discuss?.items.length ?? 0} to chat
        </button>
      </div>

      {cc && cc.items.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] text-slate-500">
            Show full combined Claude Code prompt
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
            {cc.prompt}
          </pre>
        </details>
      )}

      {inApp.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] text-slate-500">
            Show in-app actions ({inApp.length})
          </summary>
          <ul className="mt-1 space-y-1 text-[11px]">
            {inApp.map((a) => (
              <li key={a.ref} className="font-mono">
                <span className="font-semibold">{a.action_id}</span>
                <span className="text-slate-500"> — {a.label}</span>
                <span className="text-slate-400"> · {a.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
