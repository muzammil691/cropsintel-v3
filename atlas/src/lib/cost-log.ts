import { getSupabaseClient } from './supabase'
import { TTS_MODEL, estimateTtsCostUsd } from './elevenlabs'
import { WHISPER_MODEL, estimateWhisperCostUsd } from './whisper'

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

export async function recordElevenLabsTtsCost(
  charCount: number,
  voiceId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<void> {
  const costUsd = estimateTtsCostUsd(charCount)
  await recordCost(
    'elevenlabs',
    'atlas',
    TTS_MODEL,
    charCount, // chars-as-tokens for ElevenLabs
    null,
    costUsd,
    { voice_id: voiceId, char_count: charCount, ...(extraMetadata ?? {}) },
  )
}

export async function recordWhisperSttCost(
  audioSeconds: number,
  extraMetadata?: Record<string, unknown>,
): Promise<void> {
  const costUsd = estimateWhisperCostUsd(audioSeconds)
  await recordCost(
    'openai',
    'atlas',
    WHISPER_MODEL,
    Math.ceil(audioSeconds), // seconds-as-tokens for Whisper
    null,
    costUsd,
    { duration_seconds: audioSeconds, ...(extraMetadata ?? {}) },
  )
}

export async function getMonthlyProviderSpendUsd(provider: string): Promise<number> {
  try {
    const sb = getSupabaseClient()
    if (!sb) return 0
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const { data } = await sb
      .from('atlas_cost_log')
      .select('cost_usd')
      .eq('provider', provider)
      .gte('occurred_at', monthStart.toISOString())
    return (data ?? []).reduce((s, r) => s + Number((r as { cost_usd: number }).cost_usd), 0)
  } catch (err) {
    console.error('[cost-log] failed to read monthly spend:', err)
    return 0
  }
}
