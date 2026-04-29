import { CouncilInput, CouncilOutput, DeepTrace, QuickTrace } from '../types'
import { getSupabase } from './supabase'
import { recordSpend } from './budget'

function isDeepTrace(trace: QuickTrace | DeepTrace): trace is DeepTrace {
  return 'pairSessions' in trace
}

export async function recordRun(input: CouncilInput, output: CouncilOutput): Promise<string> {
  const supabase = getSupabase()

  let row: Record<string, unknown> = {
    mode: input.mode,
    depth: input.depth,
    question: input.question,
    context: input.context ?? {},
    final_decision: output.finalDecision,
    confidence: output.confidence,
    cost_usd: output.costUsd,
    duration_ms: output.durationMs,
    invoked_by: input.invokedBy ?? 'unknown',
  }

  if (!isDeepTrace(output.trace)) {
    const t = output.trace as QuickTrace
    row = {
      ...row,
      quick_claude: t.claude,
      quick_gpt: t.gpt,
      quick_gemini: t.gemini,
      quick_judge: t.judge,
    }
  } else {
    const t = output.trace as DeepTrace
    row = {
      ...row,
      pair_session_1: t.pairSessions[0],
      pair_session_2: t.pairSessions[1],
      pair_session_3: t.pairSessions[2],
      tri_council: t.triCouncil,
      validation_claude: t.validation[0],
      validation_gpt: t.validation[1],
      validation_gemini: t.validation[2],
    }
  }

  const { data, error } = await supabase
    .from('council_runs')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    console.error('[council/audit] Failed to record run:', error.message)
    return 'unrecorded'
  }

  await recordSpend(output.costUsd)

  return data.id as string
}

export async function nextADRNumber(): Promise<number> {
  const supabase = getSupabase()

  const { data } = await supabase
    .from('architecture_decisions')
    .select('decision_number')
    .order('decision_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data?.decision_number ?? 0) + 1
}

export async function saveADR(
  adrNumber: number,
  title: string,
  question: string,
  decisionMd: string,
  runId: string
): Promise<void> {
  const supabase = getSupabase()

  // Upsert by decision_number to handle retries
  const { error } = await supabase.from('architecture_decisions').upsert({
    decision_number: adrNumber,
    title,
    status: 'proposed',
    council_run_id: runId === 'unrecorded' ? null : runId,
    context_md: question,
    decision_md: decisionMd,
    consequences_md: 'To be determined after implementation.',
  })

  if (error) {
    console.error('[council/audit] Failed to save ADR:', error.message)
  }
}
