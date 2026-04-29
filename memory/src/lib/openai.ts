import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (_client) return _client

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY must be set')

  _client = new OpenAI({ apiKey })
  return _client
}

// text-embedding-3-large: $0.00013 per 1K tokens
export const EMBEDDING_MODEL = 'text-embedding-3-large'
export const EMBEDDING_DIMENSIONS = 3072
export const COST_PER_1K_TOKENS = 0.00013

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4)
}

export function estimateCost(totalTokens: number): number {
  return (totalTokens / 1000) * COST_PER_1K_TOKENS
}
