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
// Native dim is 3072 but we matryoshka-reduce to 1536 because pgvector
// HNSW indexes max out at 2000 dimensions. text-embedding-3-large supports
// passing `dimensions: 1536` to OpenAI which truncates server-side while
// preserving most semantic quality (matryoshka representation learning).
export const EMBEDDING_MODEL = 'text-embedding-3-large'
export const EMBEDDING_DIMENSIONS = 1536
export const COST_PER_1K_TOKENS = 0.00013

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4)
}

export function estimateCost(totalTokens: number): number {
  return (totalTokens / 1000) * COST_PER_1K_TOKENS
}
