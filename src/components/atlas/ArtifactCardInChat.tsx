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
  FileDiff,
  Loader2,
} from 'lucide-react'
import type { ToolCallChip } from '@/lib/atlas-client'
import { applyPlanAmendment } from '@/lib/atlas-client'

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
 *
 * Phase A.6c: when the chip is a successful plan.draft_amendment or
 * plan.draft_new result, we render a dedicated proposal card with a diff
 * preview + Apply / Reject buttons (gated diff-and-confirm flow).
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

  // A.6c: hand off to the dedicated proposal card when this chip is a
  // successful plan-draft tool call. Falls through to the default rendering
  // when the draft errored (so the user still sees the diagnosis path).
  if (!errorBool && isPlanDraftChip(chip)) {
    return <PlanAmendProposalCard chip={chip} />
  }

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

// ─── A.6c: plan-amend-proposal artifact card ────────────────────────────────

interface PlanDraftResult {
  ok?: boolean
  proposed_markdown?: string
  current_markdown?: string
  diff?: {
    addedLines: number
    removedLines: number
    unchangedLines?: number
    sample?: { added?: string[]; removed?: string[] }
  }
  reasoning?: string
}

function isPlanDraftChip(chip: ToolCallChip): boolean {
  if (chip.name !== 'plan.draft_amendment' && chip.name !== 'plan.draft_new') return false
  const r = chip.result
  if (!r || typeof r !== 'object') return false
  const draft = r as PlanDraftResult
  return typeof draft.proposed_markdown === 'string' && draft.proposed_markdown.length > 0
}

function PlanAmendProposalCard({ chip }: { chip: ToolCallChip }) {
  const draft = chip.result as PlanDraftResult
  const [phase, setPhase] = useState<'review' | 'applying' | 'applied' | 'rejected' | 'failed'>('review')
  const [appliedSha, setAppliedSha] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showFull, setShowFull] = useState(false)

  const proposedMarkdown = draft.proposed_markdown ?? ''
  const added = draft.diff?.addedLines ?? 0
  const removed = draft.diff?.removedLines ?? 0
  const addedSample = draft.diff?.sample?.added ?? []
  const removedSample = draft.diff?.sample?.removed ?? []

  const isNewPlan = chip.name === 'plan.draft_new'

  const summaryFromInstruction = (() => {
    const args = chip.args ?? {}
    const inst = (args as { instruction?: string; prompt?: string }).instruction
      ?? (args as { instruction?: string; prompt?: string }).prompt
    return typeof inst === 'string' ? inst.slice(0, 80) : (isNewPlan ? 'fresh plan draft' : 'amendment')
  })()

  async function handleApply() {
    if (!proposedMarkdown || proposedMarkdown.length < 100) {
      setErrorMsg('Proposed markdown is missing or too short — refusing to apply.')
      setPhase('failed')
      return
    }
    setPhase('applying')
    setErrorMsg(null)
    try {
      const r = await applyPlanAmendment(proposedMarkdown, summaryFromInstruction)
      setAppliedSha(r.sha)
      setPhase('applied')
      // Tell the Plan tab to re-fetch the master plan tree.
      window.dispatchEvent(new CustomEvent('atlas:plan-refresh'))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('failed')
    }
  }

  function handleReject() {
    setPhase('rejected')
  }

  return (
    <div className="my-1.5 rounded-md border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 text-xs overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-indigo-200 dark:border-indigo-900/60">
        <FileDiff className="size-3.5 text-indigo-600 dark:text-indigo-300 shrink-0" />
        <span className="font-medium text-indigo-900 dark:text-indigo-100">
          {isNewPlan ? 'New master plan proposal' : 'Plan amendment proposal'}
        </span>
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-indigo-700 dark:text-indigo-300 font-mono">
          <span className="text-emerald-700 dark:text-emerald-300">+{added}</span>
          <span className="text-rose-700 dark:text-rose-300">-{removed}</span>
        </span>
      </div>

      <div className="px-2.5 py-2 space-y-2">
        {draft.reasoning && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-indigo-500 mb-0.5">Reasoning</div>
            <p className="text-indigo-900 dark:text-indigo-100">{draft.reasoning}</p>
          </div>
        )}

        {addedSample.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-0.5">
              Added (sample of {addedSample.length})
            </div>
            <pre className="font-mono text-[11px] text-emerald-900 dark:text-emerald-100 whitespace-pre-wrap break-all max-h-32 overflow-y-auto rounded bg-white dark:bg-slate-950 px-2 py-1.5 border border-emerald-200 dark:border-emerald-900/60">
              {addedSample.map(l => `+ ${l}`).join('\n')}
            </pre>
          </div>
        )}

        {removedSample.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-rose-700 dark:text-rose-300 mb-0.5">
              Removed (sample of {removedSample.length})
            </div>
            <pre className="font-mono text-[11px] text-rose-900 dark:text-rose-100 whitespace-pre-wrap break-all max-h-32 overflow-y-auto rounded bg-white dark:bg-slate-950 px-2 py-1.5 border border-rose-200 dark:border-rose-900/60">
              {removedSample.map(l => `- ${l}`).join('\n')}
            </pre>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowFull(v => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100"
          >
            {showFull ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {showFull ? 'Hide full proposed markdown' : `Show full proposed markdown (${proposedMarkdown.length.toLocaleString()} chars)`}
          </button>
          {showFull && (
            <pre className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all max-h-72 overflow-y-auto rounded bg-white dark:bg-slate-950 px-2 py-1.5 border border-slate-200 dark:border-slate-800">
              {proposedMarkdown}
            </pre>
          )}
        </div>

        {phase === 'review' && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleReject}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors duration-150"
            >
              <XCircle className="size-3" />
              Reject
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-300 dark:border-indigo-700 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 transition-colors duration-150"
            >
              <CheckCircle2 className="size-3" />
              {isNewPlan ? 'Apply new plan' : 'Apply amendment'}
            </button>
          </div>
        )}

        {phase === 'applying' && (
          <div className="inline-flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
            <Loader2 className="size-3.5 animate-spin" />
            Writing master plan + pushing to git…
          </div>
        )}

        {phase === 'applied' && appliedSha && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="size-3.5" />
            Applied — commit <span className="font-mono">{appliedSha.slice(0, 8)}</span>
          </div>
        )}

        {phase === 'rejected' && (
          <div className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <XCircle className="size-3.5" />
            Rejected — master plan unchanged.
          </div>
        )}

        {phase === 'failed' && errorMsg && (
          <div className="rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-rose-800 dark:text-rose-200">
            Apply failed: {errorMsg}
          </div>
        )}
      </div>
    </div>
  )
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
