import { useState } from 'react'
import { CheckCircle2, SkipForward, Pause, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { approveCockpitPhase } from '@/lib/atlas-client'

interface PhaseApprovalBannerProps {
  phaseId: string
  title: string
  description?: string
  onDecision?: (decision: 'approve' | 'skip' | 'pause' | 'modify') => void
  onDismiss?: () => void
}

/**
 * Phase 1.10aj — sticky banner shown in the Plan tab when a phase is awaiting
 * approval (per-phase mode). Approval lands via /atlas/plan/approve and
 * advances the build runner queue.
 */
export function PhaseApprovalBanner(props: PhaseApprovalBannerProps) {
  const { phaseId, title, description, onDecision, onDismiss } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decided, setDecided] = useState<'approve' | 'skip' | 'pause' | 'modify' | null>(null)

  const handleDecision = async (decision: 'approve' | 'skip' | 'pause' | 'modify') => {
    setBusy(true)
    setError(null)
    try {
      await approveCockpitPhase({
        phaseId,
        via: 'panel',
        decision,
      })
      setDecided(decision)
      onDecision?.(decision)
      if (decision === 'skip' || decision === 'approve') {
        setTimeout(() => onDismiss?.(), 600)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="phase-approval-banner"
      role="status"
      aria-live="polite"
      className="sticky top-0 z-10 px-3 py-2 border-b border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
            Phase {phaseId} ready to start.
          </p>
          <p className="text-[11px] text-emerald-800 dark:text-emerald-300 truncate">
            {title}
            {description && <span className="text-emerald-700/80"> — {description}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            size="sm"
            onClick={() => handleDecision('approve')}
            disabled={busy || decided !== null}
            className="text-[11px] h-7"
          >
            {busy && decided === null ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDecision('modify')}
            disabled={busy || decided !== null}
            className="text-[11px] h-7"
          >
            <Pencil className="size-3" /> Modify
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDecision('skip')}
            disabled={busy || decided !== null}
            className="text-[11px] h-7"
          >
            <SkipForward className="size-3" /> Skip
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDecision('pause')}
            disabled={busy || decided !== null}
            className="text-[11px] h-7"
          >
            <Pause className="size-3" /> Pause
          </Button>
        </div>
      </div>
      {decided && (
        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          Recorded: {decided}.
        </p>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

export default PhaseApprovalBanner
