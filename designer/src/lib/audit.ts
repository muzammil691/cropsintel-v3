import { DesignerReview } from '../types'
import { getSupabaseClient } from './supabase'

export async function writeDesignerRun(review: DesignerReview): Promise<void> {
  const supabase = getSupabaseClient()
  if (!supabase) {
    console.warn('[designer] Supabase not configured — skipping audit log write')
    return
  }

  const aiJudgment: Record<string, unknown> = {}
  if (review.aiJudgment.claude) {
    aiJudgment.claude = {
      verdict: review.aiJudgment.claude.verdict,
      reasoning: review.aiJudgment.claude.reasoning,
      confidence: review.aiJudgment.claude.confidence,
      costUsd: review.aiJudgment.claude.costUsd,
    }
  }
  if (review.aiJudgment.gptVision) {
    aiJudgment.gptVision = {
      verdict: review.aiJudgment.gptVision.verdict,
      reasoning: review.aiJudgment.gptVision.reasoning,
      confidence: review.aiJudgment.gptVision.confidence,
      costUsd: review.aiJudgment.gptVision.costUsd,
    }
  }

  const { error } = await supabase.from('designer_runs').insert({
    task_id: review.taskId,
    operation: review.operation,
    verdict: review.verdict,
    confidence: review.confidence,
    gaps: review.gaps,
    ai_judgment: aiJudgment,
    cost_usd: review.costUsd,
    duration_ms: review.durationMs,
  })

  if (error) {
    console.error('[designer] Failed to write audit log:', error.message)
  }

  // Cost tracking — atlas_cost_log under service='designer'
  if (review.costUsd > 0) {
    const { error: costErr } = await supabase.from('atlas_cost_log').insert({
      service: 'designer',
      operation: review.operation,
      task_id: review.taskId,
      cost_usd: review.costUsd,
    })
    if (costErr) {
      // Non-fatal — atlas_cost_log might not exist yet on every environment
      console.warn('[designer] cost log skipped:', costErr.message)
    }
  }
}
