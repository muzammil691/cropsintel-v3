import { useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Code2,
  ExternalLink,
  Lightbulb,
  MessagesSquare,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildFromPlanNode,
  KNOWN_DIAGNOSE_ACTION_IDS,
  type DiagnosisBucket,
  type KnownDiagnoseActionId,
} from '@/lib/atlas-client'
import { useNavigate } from 'react-router-dom'

interface DiagnosisResultProps {
  result: DiagnosisBucket
  onClose?: () => void
  onActionInvoked?: (actionId: string, payload: Record<string, unknown>) => Promise<void> | void
}

const ACTION_LABELS: Record<KnownDiagnoseActionId, string> = {
  'mark-stub-intentional': 'Mark stub as intentional',
  'update-gemini-model': 'Update GEMINI_MODEL env var',
  'update-anthropic-model': 'Update ANTHROPIC_MODEL env var',
  'flip-trust-mode': 'Flip Atlas trust mode',
  'rotate-api-key': 'Rotate API key',
  'dismiss-as-waived': 'Dismiss as waived',
}

export function DiagnosisResult({ result, onClose, onActionInvoked }: DiagnosisResultProps) {
  switch (result.bucket) {
    case 'auto-remediate':
      return <AutoRemediate result={result} onClose={onClose} />
    case 'claude-code':
      return <ClaudeCode result={result} onClose={onClose} />
    case 'in-app-action':
      return <InAppAction result={result} onClose={onClose} onActionInvoked={onActionInvoked} />
    case 'discuss':
      return <Discuss result={result} onClose={onClose} />
  }
}

function BucketHeader({
  icon: Icon,
  label,
  reason,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  reason: string
  tone: 'emerald' | 'violet' | 'sky' | 'slate'
}) {
  const toneClass = {
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-900',
    violet: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-900',
    sky: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-900',
    slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  }[tone]
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-2.5 py-1.5 mb-2', toneClass)}>
      <Icon className="size-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-semibold tracking-wider">{label}</p>
        <p className="text-[11px] leading-snug">{reason}</p>
      </div>
    </div>
  )
}

function AutoRemediate({
  result,
  onClose,
}: {
  result: Extract<DiagnosisBucket, { bucket: 'auto-remediate' }>
  onClose?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleQueue() {
    setBusy(true)
    setError(null)
    try {
      await buildFromPlanNode(result.spec_filename, result.spec_body, 'designer-followup')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 mt-2">
      <BucketHeader
        icon={Sparkles}
        label="Atlas can fix this"
        reason={result.reason}
        tone="emerald"
      />
      <div className="text-[11px] text-slate-600 dark:text-slate-400 mb-2 font-mono">
        Spec: {result.spec_filename}
      </div>
      {error && (
        <p className="text-[11px] text-red-700 dark:text-red-400 mb-1.5">{error}</p>
      )}
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => void handleQueue()}
          disabled={busy || done}
        >
          <Wrench className="size-3" />
          {done ? 'Queued' : busy ? 'Queuing…' : 'Queue remediation spec now'}
        </Button>
        {onClose && (
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

function ClaudeCode({
  result,
  onClose,
}: {
  result: Extract<DiagnosisBucket, { bucket: 'claude-code' }>
  onClose?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(result.prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — older browsers without clipboard permission
    }
  }

  function handleOpenVscode() {
    // vscode://file/<path> opens VS Code at a path. We can't open Claude Code
    // directly via URL scheme, but landing in the repo with the prompt copied
    // is enough for a one-paste workflow.
    const repoPath = '/workspace/cropsintel-v3'
    window.open(`vscode://file${repoPath}`, '_blank')
  }

  return (
    <div className="rounded-md border border-violet-200 dark:border-violet-900 bg-violet-50/50 dark:bg-violet-950/20 p-2.5 mt-2">
      <BucketHeader
        icon={Code2}
        label="Needs Claude Code in VS Code"
        reason={result.reason}
        tone="violet"
      />
      {result.affected_files.length > 0 && (
        <div className="text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
          <span className="font-semibold">Affected:</span>{' '}
          <span className="font-mono">{result.affected_files.join(', ')}</span>
        </div>
      )}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-1.5"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {expanded ? 'Hide prompt' : 'Show prompt'}
      </button>
      {expanded && (
        <pre className="text-[10.5px] bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-md p-2 max-h-64 overflow-auto whitespace-pre-wrap break-words mb-2 font-mono">
          {result.prompt}
        </pre>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button size="xs" onClick={() => void handleCopy()} className="bg-violet-600 hover:bg-violet-700 text-white">
          <ClipboardCopy className="size-3" />
          {copied ? 'Copied!' : 'Copy prompt'}
        </Button>
        <Button size="xs" variant="outline" onClick={handleOpenVscode}>
          <ExternalLink className="size-3" />
          Open in VS Code
        </Button>
        {onClose && (
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

function InAppAction({
  result,
  onClose,
  onActionInvoked,
}: {
  result: Extract<DiagnosisBucket, { bucket: 'in-app-action' }>
  onClose?: () => void
  onActionInvoked?: (actionId: string, payload: Record<string, unknown>) => Promise<void> | void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Belt-and-braces whitelist enforcement on the client side. The server may
  // also downgrade unknown action_ids, but we never want to render a button
  // for an unrecognised id.
  const isKnown = (KNOWN_DIAGNOSE_ACTION_IDS as readonly string[]).includes(result.action_id)
  if (!isKnown) {
    return (
      <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 mt-2 text-[11px] text-amber-800 dark:text-amber-200">
        Atlas suggested an unrecognised action ({result.action_id}). Treating as discuss instead.
      </div>
    )
  }

  const label =
    result.label || ACTION_LABELS[result.action_id as KnownDiagnoseActionId] || 'Apply fix'

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    try {
      if (onActionInvoked) {
        await onActionInvoked(result.action_id, result.payload)
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20 p-2.5 mt-2">
      <BucketHeader icon={Lightbulb} label="Single-click fix" reason={result.reason} tone="sky" />
      {Object.keys(result.payload).length > 0 && (
        <details className="text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
          <summary className="cursor-pointer">Action context</summary>
          <pre className="mt-1 bg-slate-100 dark:bg-slate-800 rounded p-1.5 overflow-auto font-mono">
            {JSON.stringify(result.payload, null, 2)}
          </pre>
        </details>
      )}
      {error && <p className="text-[11px] text-red-700 dark:text-red-400 mb-1.5">{error}</p>}
      <div className="flex items-center gap-1.5">
        {!confirming && !done && (
          <Button
            size="xs"
            className="bg-sky-600 hover:bg-sky-700 text-white"
            onClick={() => setConfirming(true)}
          >
            <Lightbulb className="size-3" />
            {label}
          </Button>
        )}
        {confirming && !done && (
          <>
            <span className="text-[11px] text-slate-700 dark:text-slate-300">Confirm?</span>
            <Button
              size="xs"
              className="bg-sky-600 hover:bg-sky-700 text-white"
              onClick={() => void handleConfirm()}
              disabled={busy}
            >
              {busy ? 'Applying…' : 'Yes, apply'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {done && <span className="text-[11px] text-emerald-700 dark:text-emerald-300">Applied.</span>}
        {onClose && (
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

function Discuss({
  result,
  onClose,
}: {
  result: Extract<DiagnosisBucket, { bucket: 'discuss' }>
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  function handleOpenChat() {
    navigate(`/atlas?prefill=${encodeURIComponent(result.chat_seed)}`)
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2.5 mt-2">
      <BucketHeader icon={Bot} label="Atlas wants to discuss" reason={result.reason} tone="slate" />
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-1.5"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {expanded ? 'Hide chat seed' : 'Preview chat seed'}
      </button>
      {expanded && (
        <pre className="text-[10.5px] bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 rounded-md border border-slate-200 dark:border-slate-700 p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words mb-2 font-mono">
          {result.chat_seed}
        </pre>
      )}
      <div className="flex items-center gap-1.5">
        <Button size="xs" onClick={handleOpenChat}>
          <MessagesSquare className="size-3" />
          Ask Atlas about this
        </Button>
        {onClose && (
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  )
}
