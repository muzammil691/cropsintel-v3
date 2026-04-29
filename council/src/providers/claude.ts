import Anthropic from '@anthropic-ai/sdk'
import { AIProvider, PairTurn, ProviderResponse } from '../types'

const TIMEOUT_MS = 90_000
const MODEL = 'claude-opus-4-7'

// Token pricing (per 1M tokens, as of 2026)
const PRICE_IN_PER_M = 15.0
const PRICE_OUT_PER_M = 75.0

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    client = new Anthropic({ apiKey })
  }
  return client
}

function calcCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * PRICE_IN_PER_M + (tokensOut / 1_000_000) * PRICE_OUT_PER_M
}

export async function askClaude(
  question: string,
  context?: Record<string, unknown>
): Promise<ProviderResponse> {
  const started = Date.now()
  const systemNote = context ? `\n\nContext: ${JSON.stringify(context)}` : ''

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        system: `You are an expert software architect answering a technical question about the CropsIntel V3 project — a multi-commodity agricultural intelligence platform.${systemNote}`,
        messages: [{ role: 'user', content: question }],
      },
      { signal: controller.signal }
    )

    const content = response.content[0].type === 'text' ? response.content[0].text : ''
    const tokensIn = response.usage.input_tokens
    const tokensOut = response.usage.output_tokens

    return {
      provider: 'claude' as AIProvider,
      content,
      tokensIn,
      tokensOut,
      costUsd: calcCost(tokensIn, tokensOut),
      durationMs: Date.now() - started,
    }
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      provider: 'claude' as AIProvider,
      content: isAbort ? '(timeout)' : `(error: ${err instanceof Error ? err.message : String(err)})`,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      timedOut: isAbort,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function pairTurnClaude(
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): Promise<PairTurn> {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: userMessage },
    ]

    const response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      },
      { signal: controller.signal }
    )

    const content = response.content[0].type === 'text' ? response.content[0].text : ''
    const tokensIn = response.usage.input_tokens
    const tokensOut = response.usage.output_tokens

    return {
      speaker: 'claude' as AIProvider,
      content,
      tokensIn,
      tokensOut,
      costUsd: calcCost(tokensIn, tokensOut),
    }
  } catch (_err) {
    return {
      speaker: 'claude' as AIProvider,
      content: '(error or timeout)',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    }
  } finally {
    clearTimeout(timeout)
  }
}
