import { useEffect, useState } from 'react'
import { Hammer, Loader2, AlertTriangle, Check } from 'lucide-react'
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

export function BuildRunnerModal(props: BuildRunnerModalProps) {
  const { open, onOpenChange, followedNodes, onRunComplete } = props
  const [stage, setStage] = useState<Stage>('preflight')
  const [preflight, setPreflight] = useState<BuildRunnerPreflight | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runSummary, setRunSummary] = useState<{ queued: number; pending: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setStage('preflight')
    setPreflight(null)
    setError(null)
    setRunSummary(null)
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
          <div className="space-y-2">
            {preflight.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <ul className="space-y-0.5">
                  {preflight.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 max-h-60 overflow-y-auto">
              <ol className="text-xs space-y-0.5 list-decimal pl-4">
                {preflight.ordered.map((n) => (
                  <li key={n.planNodeId} className="text-slate-700 dark:text-slate-300">
                    {n.title}
                  </li>
                ))}
              </ol>
            </div>
          </div>
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

export default BuildRunnerModal
