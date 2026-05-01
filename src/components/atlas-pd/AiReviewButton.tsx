// Phase 1.10ac — AiReviewButton
//
// Invokes the pd-ai-review edge function for a single proposal. Shows a spinner
// during the (typically 8–15s) Claude call. Result lands in pd_auto_validation
// — caller refreshes the surrounding modal/tab.

import { useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runAiReview } from '@/lib/pd-client'
import { drAtlas } from '@/lib/drAtlas'

interface Props {
  proposalId: string
  onComplete: () => void
}

export function AiReviewButton({ proposalId, onComplete }: Props) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = async () => {
    setRunning(true); setError(null)
    try {
      const result = await runAiReview(proposalId)
      drAtlas.log('pd_ai_review_complete', 'ai', `AI review verdict: ${result.verdict}`, {
        metadata: { proposal_id: proposalId, verdict: result.verdict, cost_usd: result.cost_usd },
      })
      onComplete()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      drAtlas.log('pd_ai_review_error', 'ai', `AI review failed: ${msg}`, {
        severity: 'error',
        metadata: { proposal_id: proposalId },
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={onClick} disabled={running}>
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
        {running ? 'Reviewing…' : 'AI Review'}
      </Button>
      {error && (
        <span className="text-[11px] text-red-700 dark:text-red-400" role="alert">{error}</span>
      )}
    </div>
  )
}
