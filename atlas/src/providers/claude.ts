import Anthropic from '@anthropic-ai/sdk'

const TIMEOUT_MS = 90_000
const DEFAULT_MODEL = 'claude-sonnet-4-6'

// Token pricing (per 1M tokens, as of 2026)
const PRICE_IN_PER_M = 3.0
const PRICE_OUT_PER_M = 15.0

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

export interface AtlasProviderResponse {
  content: string
  confidence?: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export async function askClaude(input: {
  prompt: string
  model?: string
  systemPrompt?: string
}): Promise<AtlasProviderResponse> {
  const model = input.model ?? DEFAULT_MODEL
  const systemPrompt = input.systemPrompt ?? 'You are Atlas, an intelligent decision engine for the CropsIntel V3 agricultural intelligence platform.'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await getClient().messages.create(
      {
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: input.prompt }],
      },
      { signal: controller.signal }
    )

    const content = response.content[0].type === 'text' ? response.content[0].text : ''
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens

    return {
      content,
      costUsd: calcCost(inputTokens, outputTokens),
      inputTokens,
      outputTokens,
    }
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      content: isAbort ? '(timeout)' : `(error: ${err instanceof Error ? err.message : String(err)})`,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  } finally {
    clearTimeout(timeout)
  }
}
