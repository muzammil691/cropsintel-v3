import { getSupabaseClient } from './supabase'

export async function recordCost(
  provider: string,
  service: string,
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  costUsd: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const sb = getSupabaseClient()
    if (!sb) return
    await sb.from('atlas_cost_log').insert({
      provider, service, model,
      input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: costUsd,
      request_metadata: metadata ?? {},
    })
  } catch (err) {
    // Don't fail the request just because cost logging failed
    console.error('[cost-log] failed to record:', err)
  }
}
