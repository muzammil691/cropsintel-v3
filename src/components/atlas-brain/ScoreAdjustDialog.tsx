// Phase 1.10ab — ScoreAdjustDialog
//
// Manual admin override for a node score. Per spec NEVER list:
//   - reason is REQUIRED (cannot submit if blank)
//   - logged to brain_node_history with changed_by = `human:<user_id>`

import { useState } from 'react'
import { SlidersHorizontal, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ScoreAdjustDialogProps {
  currentScore: number
  nodeLabel: string
  disabled?: boolean
  onSubmit: (newScore: number, reason: string) => Promise<void>
}

export function ScoreAdjustDialog({ currentScore, nodeLabel, disabled, onSubmit }: ScoreAdjustDialogProps) {
  const [open, setOpen] = useState(false)
  const [score, setScore] = useState(Math.round(currentScore))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setOpen(false)
    setReason('')
    setErr(null)
  }

  const onOpenChange = (o: boolean) => {
    if (o) {
      setScore(Math.round(currentScore))
      setOpen(true)
    } else {
      close()
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      await onSubmit(score, reason.trim())
      setOpen(false)
      setReason('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onOpenChange(true)}>
        <SlidersHorizontal className="size-3.5" /> Manual adjust
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust score manually</DialogTitle>
            <DialogDescription>
              Override the score for <span className="font-medium text-foreground">{nodeLabel}</span>. A reason is required and will be logged to the audit history.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="brain-score" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-between mb-1">
                <span>New score (0–100)</span>
                <span className="tabular-nums text-slate-500">{score}</span>
              </label>
              <input
                id="brain-score"
                type="range"
                min={0}
                max={100}
                step={1}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                disabled={busy}
                className="w-full accent-emerald-600"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                <span>0</span>
                <span>was {Math.round(currentScore)}</span>
                <span>100</span>
              </div>
            </div>

            <div>
              <label htmlFor="brain-reason" className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                id="brain-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you overriding the consensus?"
                rows={3}
                required
                disabled={busy}
                className="w-full p-2 text-sm rounded-md bg-background border border-border outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 resize-y"
              />
            </div>

            {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!reason.trim() || busy || score === Math.round(currentScore)}>
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 motion-safe:animate-spin" /> Saving…
                  </>
                ) : (
                  'Save override'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
