import { useState } from 'react'
import {
  Wrench,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Search,
  Clipboard,
  RotateCw,
} from 'lucide-react'
import type { ToolCallChip } from '@/lib/atlas-client'

interface DiagnoseResult {
  bucket?: 'claude-code' | 'atlas' | 'manual' | string
  summary?: string
  fix_prompt?: string
  detail?: string
}

interface ArtifactCardInChatProps {
  chip: ToolCallChip
  /** True if the underlying tool result represents an error. */
  isError?: boolean
  /** Optional callback to re-execute the same tool with the same args. */
  onRetry?: (chip: ToolCallChip) => void
  /** Optional async diagnoser — wraps 1.10al's /atlas/artifacts/diagnose. */
  diagnose?: (chip: ToolCallChip) => Promise<DiagnoseResult>
}

/**
 * Inline tool-result card. Rendered directly inside a MessageBubble — not in
 * the artifacts pane. Errors get [Diagnose / Copy Fix Prompt / Retry] so the
 * user is never stuck staring at a raw exception.
 */
export function ArtifactCardInChat({
  chip,
  isError,
  onRetry,
  diagnose,
}: ArtifactCardInChatProps) {
  const [expanded, setExpanded] = useState(false)
  const [diag, setDiag] = useState<DiagnoseResult | null>(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)
  const [copyHint, setCopyHint] = useState<string | null>(null)

  const errorBool = isError ?? detectError(chip.result)
  const summary = renderSummary(chip)

  async function handleDiagnose() {
    if (!diagnose) {
      setDiagError('Diagnose endpoint not wired up yet (ships in 1.10al).')
      return
    }
    setDiagLoading(true)
    setDiagError(null)
    try {
      const r = await diagnose(chip)
      setDiag(r)
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiagLoading(false)
    }
  }

  async function handleCopyFix() {
    const text = diag?.fix_prompt ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyHint('Prompt copied — paste in VS Code Claude Code')
    } catch {
      setCopyHint('Copy failed — select manually')
    }
    setTimeout(() => setCopyHint(null), 2400)
  }

  async function handleCopyJson() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ name: chip.name, args: chip.args, result: chip.result }, null, 2),
      )
      setCopyHint('Copied as JSON')
      setTimeout(() => setCopyHint(null), 1800)
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={`my-1.5 rounded-md border text-xs overflow-hidden ${
        errorBool
          ? 'border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900'
      }`}
    >
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-slate-100 dark:hover:bg-slate-800/60"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {errorBool ? (
          <XCircle className="size-3.5 text-red-500 shrink-0" />
        ) : (
          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
        )}
        <Wrench className="size-3 text-slate-400 shrink-0" />
        <span className="font-mono font-medium text-slate-700 dark:text-slate-200 truncate">
          {chip.name || 'tool_call'}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-slate-500 truncate">
          <span className="truncate max-w-[14rem]">{summary}</span>
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-2.5 py-2 space-y-2">
          {/* Args */}
          <CodeBlock label="args" data={chip.args} />

          {/* Result / error */}
          {chip.result !== undefined && <CodeBlock label="result" data={chip.result} />}

          {/* Action row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {errorBool && (
              <button
                type="button"
                onClick={handleDiagnose}
                disabled={diagLoading}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors duration-150 disabled:opacity-60"
              >
                <Search className="size-3" />
                {diagLoading ? 'Diagnosing…' : 'Diagnose'}
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(chip)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors duration-150"
              >
                <RotateCw className="size-3" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyJson}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors duration-150"
            >
              <Clipboard className="size-3" />
              Copy as JSON
            </button>
          </div>

          {/* Diagnosis sub-card */}
          {(diag || diagError) && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 px-2.5 py-2 space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Diagnosis
              </div>
              {diagError && <div className="text-amber-800 dark:text-amber-200">{diagError}</div>}
              {diag?.summary && <div className="text-amber-900 dark:text-amber-100">{diag.summary}</div>}
              {diag?.detail && (
                <pre className="font-mono text-[11px] text-amber-900 dark:text-amber-100 whitespace-pre-wrap break-words">
                  {diag.detail}
                </pre>
              )}
              {diag?.bucket === 'claude-code' && diag.fix_prompt && (
                <button
                  type="button"
                  onClick={handleCopyFix}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors duration-150"
                >
                  <Clipboard className="size-3" />
                  Copy Fix Prompt
                </button>
              )}
            </div>
          )}

          {copyHint && (
            <div role="status" className="text-emerald-700 dark:text-emerald-300">
              {copyHint}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CodeBlock({ label, data }: { label: string; data: unknown }) {
  let body: string
  try {
    body = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  } catch {
    body = String(data)
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
      <pre className="font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto rounded bg-white dark:bg-slate-950 px-2 py-1.5 border border-slate-200 dark:border-slate-800">
        {body}
      </pre>
    </div>
  )
}

function detectError(result: unknown): boolean {
  if (result === undefined || result === null) return false
  if (typeof result === 'string') {
    const s = result.toLowerCase()
    return s.includes('error') || s.startsWith('failed') || s.startsWith('exception')
  }
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (r.ok === false) return true
    if (typeof r.error === 'string' && r.error.length > 0) return true
    if (r.success === false) return true
  }
  return false
}

function renderSummary(chip: ToolCallChip): string {
  if (chip.result === undefined) return 'pending…'
  if (typeof chip.result === 'string') return chip.result.slice(0, 80)
  if (chip.result && typeof chip.result === 'object') {
    const r = chip.result as Record<string, unknown>
    if (typeof r.error === 'string') return r.error.slice(0, 80)
    if (typeof r.message === 'string') return r.message.slice(0, 80)
    if (typeof r.summary === 'string') return r.summary.slice(0, 80)
  }
  return 'success'
}
