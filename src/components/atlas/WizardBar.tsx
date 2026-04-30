import { useState } from 'react'
import { ChevronDown, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { setMode, fetchPendingDecisions, approveDecision, type TrustMode, type AtlasDecision } from '@/lib/atlas-client'

const TRUST_MODES: TrustMode[] = ['passive', 'chat', 'confirm', 'auto', 'stopped']

interface WizardBarProps {
  onPrefill?: (text: string) => void
  currentMode?: TrustMode
  onModeChange?: (mode: TrustMode) => void
}

export function WizardBar({ onPrefill, currentMode, onModeChange }: WizardBarProps) {
  const [modeOpen, setModeOpen] = useState(false)
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [phaseInput, setPhaseInput] = useState('')
  const [adrOpen, setAdrOpen] = useState(false)
  const [decisions, setDecisions] = useState<AtlasDecision[]>([])
  const [approving, setApproving] = useState<string | null>(null)
  const [modeUpdating, setModeUpdating] = useState(false)

  // Open Phase wizard
  function handleOpenPhase() {
    setPhaseOpen(true)
  }
  function submitOpenPhase() {
    if (phaseInput.trim()) {
      onPrefill?.(`Open Phase ${phaseInput.trim()}`)
      setPhaseOpen(false)
      setPhaseInput('')
    }
  }

  // Review Audit — pre-fill chat
  function handleReviewAudit() {
    onPrefill?.('Show me the most recent failed audit and what should we do?')
  }

  // Approve ADR — load decisions and open modal
  async function handleApproveAdr() {
    try {
      const pending = await fetchPendingDecisions()
      setDecisions(pending)
    } catch {
      setDecisions([])
    }
    setAdrOpen(true)
  }

  async function handleApprove(id: string) {
    setApproving(id)
    try {
      await approveDecision(id)
      setDecisions((prev) => prev.filter((d) => d.id !== id))
    } catch {
      // keep visible on failure
    } finally {
      setApproving(null)
    }
  }

  // Set Trust Mode
  async function handleSetMode(mode: TrustMode) {
    setModeUpdating(true)
    try {
      await setMode(mode)
      onModeChange?.(mode)
    } finally {
      setModeUpdating(false)
      setModeOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="outline" size="sm" onClick={handleOpenPhase}>
        Open Phase
      </Button>

      <Button variant="outline" size="sm" onClick={handleReviewAudit}>
        Review Audit
      </Button>

      <Button variant="outline" size="sm" onClick={handleApproveAdr}>
        Approve ADR
      </Button>

      {/* Trust Mode dropdown */}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModeOpen((v) => !v)}
          className="gap-1"
          disabled={modeUpdating}
        >
          Set Trust Mode
          <ChevronDown className="size-3.5" />
        </Button>
        {modeOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border bg-popover shadow-md py-1">
            {TRUST_MODES.map((m) => (
              <button
                key={m}
                className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors capitalize flex items-center gap-2 ${m === currentMode ? 'font-semibold' : ''}`}
                onClick={() => handleSetMode(m)}
              >
                {m === currentMode && <CheckCircle2 className="size-3.5 text-primary shrink-0" />}
                <span className={m === currentMode ? '' : 'pl-5'}>{m}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Open Phase modal */}
      <Dialog open={phaseOpen} onOpenChange={setPhaseOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Open Phase</DialogTitle>
            <DialogDescription>Enter the phase identifier (e.g. 2.1)</DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={phaseInput}
            onChange={(e) => setPhaseInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitOpenPhase()}
            placeholder="e.g. 2.1"
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 w-full"
          />
          <DialogFooter>
            <Button size="sm" onClick={submitOpenPhase} disabled={!phaseInput.trim()}>
              Send to chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve ADR modal */}
      <Dialog open={adrOpen} onOpenChange={setAdrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pending Decisions</DialogTitle>
            <DialogDescription>
              {decisions.length === 0
                ? 'No pending architectural decisions right now.'
                : 'Click Approve to action an ADR.'}
            </DialogDescription>
          </DialogHeader>
          {decisions.length > 0 && (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {decisions.map((d) => (
                <li key={d.id} className="flex items-start gap-3 rounded border p-3 text-sm">
                  <div className="flex-1">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={approving === d.id}
                    onClick={() => handleApprove(d.id)}
                  >
                    {approving === d.id ? 'Approving…' : 'Approve'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  )
}
