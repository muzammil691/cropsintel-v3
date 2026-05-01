import { useMemo, useState } from 'react'
import { GitBranch, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OpenFork } from '@/lib/atlas-client'

interface OpenForkCardProps {
  fork: OpenFork
  onResolve: (id: string, chosen: string, rationale?: string) => Promise<void>
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// options_considered may be:
//   - { option_a: "...", option_b: "..." }   (object form)
//   - ["A", "B"]                              (array form)
//   - { proposed: { ... } }                   (single proposal)
// Normalize to a list of { key, label }.
function extractOptions(raw: OpenFork['options_considered']): Array<{ key: string; label: string }> {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((v, i) => ({
      key: String(i),
      label: typeof v === 'string' ? v : JSON.stringify(v).slice(0, 80),
    }))
  }
  if (typeof raw === 'object') {
    return Object.entries(raw).map(([k, v]) => ({
      key: k,
      label: typeof v === 'string' ? v : JSON.stringify(v).slice(0, 80),
    }))
  }
  return []
}

export function OpenForkCard({ fork, onResolve }: OpenForkCardProps) {
  const options = useMemo(() => extractOptions(fork.options_considered), [fork.options_considered])
  const [chosen, setChosen] = useState<string | null>(null)
  const [rationale, setRationale] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    if (!chosen) return
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(fork.id, chosen, rationale.trim() || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 p-3 shadow-sm hover:shadow-md transition-shadow duration-150">
      <header className="flex items-start gap-2 mb-2">
        <span className="grid place-items-center size-7 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 shrink-0">
          <GitBranch className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-800 dark:text-blue-300">
              Open fork
            </span>
            <span className="text-[10px] text-slate-500 tabular-nums">{relativeTime(fork.decided_at)}</span>
            {fork.related_phase && (
              <span className="text-[10px] font-mono text-slate-500">{fork.related_phase}</span>
            )}
          </div>
          <p className="text-xs font-medium text-slate-900 dark:text-slate-100 mt-0.5">
            {fork.fork_question}
          </p>
        </div>
      </header>

      {fork.rationale && (
        <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-2 leading-relaxed">
          {fork.rationale}
        </p>
      )}

      {options.length > 0 ? (
        <fieldset className="space-y-1.5 mb-3">
          <legend className="sr-only">Options</legend>
          {options.map((opt) => (
            <label
              key={opt.key}
              className={`flex items-start gap-2 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors duration-150 ${
                chosen === opt.key
                  ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/40'
                  : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:bg-blue-50/60 dark:hover:bg-blue-950/40'
              }`}
            >
              <input
                type="radio"
                name={`fork-${fork.id}`}
                value={opt.key}
                checked={chosen === opt.key}
                onChange={() => setChosen(opt.key)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  {opt.key}
                </span>
                <p className="text-slate-800 dark:text-slate-200 leading-snug">{opt.label}</p>
              </div>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-[11px] italic text-slate-500 mb-3">No structured options — approve to acknowledge.</p>
      )}

      <textarea
        rows={2}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Rationale (optional)"
        className="w-full resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 mb-2 transition-colors duration-150"
      />

      {error && (
        <p className="text-xs text-red-700 dark:text-red-400 mb-2">{error}</p>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs px-2.5 bg-blue-600 hover:bg-blue-700 text-white"
          disabled={(!chosen && options.length > 0) || submitting}
          onClick={() => {
            if (options.length === 0 && !chosen) setChosen('APPROVED')
            void handleApprove()
          }}
        >
          <Check className="size-3 mr-1" />
          {submitting ? 'Approving…' : 'Approve'}
        </Button>
      </div>
    </article>
  )
}
