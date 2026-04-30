import { GoogleGenerativeAI } from '@google/generative-ai'
import { AtlasProviderResponse } from './claude'

const TIMEOUT_MS = 90_000
const DEFAULT_MODEL = 'gemini-2.5-pro'

// Token pricing (per 1M tokens, as of 2026)
const PRICE_IN_PER_M = 1.25
const PRICE_OUT_PER_M = 5.0

let genAI: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

function calcCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * PRICE_IN_PER_M + (tokensOut / 1_000_000) * PRICE_OUT_PER_M
}

export async function askGemini(input: {
  prompt: string
  model?: string
  systemPrompt?: string
}): Promise<AtlasProviderResponse> {
  const modelName = input.model ?? DEFAULT_MODEL
  const systemPrompt = input.systemPrompt ?? 'You are Atlas, an intelligent decision engine for the CropsIntel V3 agricultural intelligence platform.'
  const fullPrompt = `${systemPrompt}\n\n${input.prompt}`

  try {
    const model = getClient().getGenerativeModel({ model: modelName })

    const response = await Promise.race([
      model.generateContent(fullPrompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])

    const content = response.response.text()
    const inputTokens = response.response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = response.response.usageMetadata?.candidatesTokenCount ?? 0

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
