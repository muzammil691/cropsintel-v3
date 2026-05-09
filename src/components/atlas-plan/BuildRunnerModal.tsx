import { useEffect, useMemo, useState } from 'react'
import { Hammer, Loader2, AlertTriangle, Check, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { runBuildCockpit, type BuildRunnerNodeInput, type BuildRunnerPreflight } from '@/lib/atlas-client'

interface BuildRunnerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  followedNodes: BuildRunnerNodeInput[]
  onRunComplete?: (queued: number, pending: number) => void
}

type Stage = 'preflight' | 'confirm' | 'running' | 'done' | 'error'

// Phase 1.10ba — derive a launch tier from a phase title so the modal can
// group nodes by tier (1.0-alpha → 1.0-beta → 1.x → ...). We look for the
// first dotted version-like prefix; everything else falls into "later".
function deriveLaunchTier(title: string): string {
  const m = title.match(/^\s*\[?\s*(\d+\.\d+(?:-?[a-z]+)?)\b/i)
  if (m) return m[1].toLowerCase()
  const m2 = title.match(/\bphase\s+(\d+\.\d+(?:-?[a-z]+)?)\b/i)
  if (m2) return m2[1].toLowerCase()
  return 'later'
}

// Phase 1.10ba — calibrated per-phase Builder estimate. Mirrors the server
// preflight (25 min average) so the UI reads the same number whether or not
// the server returned a per-phase break-down.
const PER_PHASE_MIN = 25

export function BuildRunnerModal(props: BuildRunnerModalProps) {
  const { open, onOpenChange, followedNodes, onRunComplete } = props
  const [stage, setStage] = useState<Stage>('preflight')
  const [preflight, setPreflight] = useState<BuildRunnerPreflight | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runSummary, setRunSummary] = useState<{ queued: number; pending: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // Phase 1.10ba — UI-only "Pause after each launch tier" toggle. The runner
  // server already supports per-phase confirmation via mode='per-phase'; this
  // toggle nudges the user toward that mode for cross-tier workflows.
  const [pauseBetweenTiers, setPauseBetweenTiers] = useState(false)

  useEffect(() => {
    if (!open) return
    setStage('preflight')
    setPreflight(null)
    setError(null)
    setRunSummary(null)
    setPauseBetweenTiers(false)
    let cancelled = false
    runBuildCockpit(followedNodes, 'approve-all', 'preflight')
      .then((res) => {
        if (cancelled) return
        setPreflight(res.preflight)
        setStage('confirm')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStage('error')
      })
    return () => { cancelled = true }
  }, [open, followedNodes])

  const handleRun = async (mode: 'approve-all' | 'per-phase') => {
    if (!preflight) return
    setBusy(true)
    setStage('running')
    setError(null)
    try {
      const res = await runBuildCockpit(preflight.ordered, mode, 'run')
      if (!res.run?.ok) {
        setError(res.run?.reason ?? 'run_failed')
        setStage('error')
        return
      }
      const queued = res.run.queued.length
      const pending = res.run.pending.length
      setRunSummary({ queued, pending })
      setStage('done')
      onRunComplete?.(queued, pending)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="build-runner-modal"
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Hammer className="size-4 text-emerald-600" />
            Build runner
          </DialogTitle>
          <DialogDescription>
            {stage === 'preflight' && 'Sequencing phases by dependency…'}
            {stage === 'confirm' && preflight && (
              <>Will queue {preflight.ordered.length} phases (~{preflight.estimatedMinutes} min wall clock).</>
            )}
            {stage === 'running' && 'Queueing specs in dependency order…'}
            {stage === 'done' && runSummary && (
              <>{runSummary.queued} queued, {runSummary.pending} pending approval.</>
            )}
            {stage === 'error' && error}
          </DialogDescription>
        </DialogHeader>

        {stage === 'preflight' && (
          <div className="flex items-center justify-center py-6 gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Pre-flight…
          </div>
        )}

        {stage === 'confirm' && preflight && (
          <PreflightDetails
            preflight={preflight}
            pauseBetweenTiers={pauseBetweenTiers}
            onTogglePause={setPauseBetweenTiers}
          />
        )}

        {stage === 'running' && (
          <div className="flex items-center justify-center py-6 gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Queueing…
          </div>
        )}

        {stage === 'done' && runSummary && (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
            <Check className="size-4" /> Build runner complete.
          </div>
        )}

        {stage === 'error' && error && (
          <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <DialogFooter>
          {stage === 'confirm' && preflight && (
            <>
              <Button
                variant="outline"
                onClick={() => handleRun('per-phase')}
                disabled={busy || preflight.ordered.length === 0}
              >
                Per phase
              </Button>
              <Button
                onClick={() => handleRun('approve-all')}
                disabled={busy || preflight.ordered.length === 0}
              >
                Approve all
              </Button>
            </>
          )}
          {(stage === 'done' || stage === 'error') && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Phase 1.10ba — broken out so the long preflight markup doesn't drown the
// stage-machine in BuildRunnerModal.
function PreflightDetails({
  preflight,
  pauseBetweenTiers,
  onTogglePause,
}: {
  preflight: BuildRunnerPreflight
  pauseBetweenTiers: boolean
  onTogglePause: (v: boolean) => void
}) {
  // Group ordered nodes by launch tier in topological order. Tiers retain
  // first-appearance order (Map preserves insertion order).
  const grouped = useMemo(() => {
    const tiers = new Map<string, BuildRunnerPreflight['ordered']>()
    for (const n of preflight.ordered) {
      const tier = deriveLaunchTier(n.title)
      const list = tiers.get(tier) ?? []
      list.push(n)
      tiers.set(tier, list)
    }
    return Array.from(tiers.entries())
  }, [preflight.ordered])

  return (
    <div className="space-y-2">
      {preflight.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <ul className="space-y-0.5">
            {preflight.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div
        className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 max-h-72 overflow-y-auto"
        data-testid="build-runner-ordered-list"
      >
        {grouped.map(([tier, nodes], tierIdx) => (
          <div key={tier} className="mb-2 last:mb-0" data-testid={`build-runner-tier-${tier}`}>
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              <span>Launch tier: {tier}</span>
              <span className="flex items-center gap-1 text-slate-400 normal-case font-normal">
                <Clock className="size-3" /> ~{nodes.length * PER_PHASE_MIN} min
              </span>
            </div>
            <ol className="text-xs space-y-0.5 list-decimal pl-4">
              {nodes.map((n) => (
                <li key={n.planNodeId} className="text-slate-700 dark:text-slate-300 flex items-baseline justify-between gap-2">
                  <span className="truncate">{n.title}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">~{PER_PHASE_MIN} min</span>
                </li>
              ))}
            </ol>
            {tierIdx < grouped.length - 1 && pauseBetweenTiers && (
              <div className="mt-1 mb-1 ml-4 text-[10px] italic text-amber-700 dark:text-amber-400">
                ⏸ pause for review before next tier
              </div>
            )}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={pauseBetweenTiers}
          onChange={(e) => onTogglePause(e.target.checked)}
          data-testid="build-runner-pause-tiers"
          className="size-3.5 rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500/40"
        />
        Pause between launch tiers (use Per-phase mode for hand-controlled rollout)
      </label>
    </div>
  )
}

export default BuildRunnerModal
