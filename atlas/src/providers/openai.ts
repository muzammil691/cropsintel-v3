import OpenAI from 'openai'
import { AtlasProviderResponse } from './claude'

const TIMEOUT_MS = 90_000
const DEFAULT_MODEL = 'gpt-4o'

// Token pricing (per 1M tokens, as of 2026)
const PRICE_IN_PER_M = 2.5
const PRICE_OUT_PER_M = 10.0

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    client = new OpenAI({ apiKey })
  }
  return client
}

function calcCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * PRICE_IN_PER_M + (tokensOut / 1_000_000) * PRICE_OUT_PER_M
}

export async function askOpenAI(input: {
  prompt: string
  model?: string
  systemPrompt?: string
}): Promise<AtlasProviderResponse> {
  const model = input.model ?? DEFAULT_MODEL
  const systemPrompt = input.systemPrompt ?? 'You are Atlas, an intelligent decision engine for the CropsIntel V3 agricultural intelligence platform.'

  try {
    const response = await Promise.race([
      getClient().chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.prompt },
        ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])

    const content = response.choices[0]?.message?.content ?? ''
    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0

    return {
      content,
      costUsd: calcCost(inputTokens, outputTokens),
      inputTokens,
      outputTokens,
    }
  } catch (err: unknown) {
    return {
      content: `(error: ${err instanceof Error ? err.message : String(err)})`,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }
}
