import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseClient } from './lib/supabase'
import { embedQuery } from './embed'
import { SearchRequest, SearchResult, SearchResultChunk, SourceName } from './types'

const RERANK_CANDIDATE_COUNT = 30

export async function search(req: SearchRequest): Promise<SearchResult> {
  const start = Date.now()
  let costUsd = 0

  const limit = req.limit ?? 10
  const candidateCount = req.rerank ? Math.max(limit * 3, RERANK_CANDIDATE_COUNT) : limit

  // Embed the query
  const { embedding, costUsd: embedCost } = await embedQuery(req.query)
  costUsd += embedCost

  // Vector search via Supabase RPC
  const sb = getSupabaseClient()
  const { data, error } = await sb.rpc('search_memory_chunks', {
    query_embedding: `[${embedding.join(',')}]`,
    source_filter: req.sources && req.sources.length > 0 ? req.sources : null,
    match_count: candidateCount,
  })

  if (error) {
    throw new Error(`Vector search failed: ${error.message}`)
  }

  const rows = (data ?? []) as Array<{
    source: string
    source_path: string | null
    source_section: string | null
    content: string
    chunk_index: number
    metadata: Record<string, unknown>
    similarity: number
  }>

  let chunks: SearchResultChunk[] = rows.map(row => ({
    source: row.source,
    sourcePath: row.source_path,
    sourceSection: row.source_section,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata,
  }))

  // Optional Claude rerank: reduce top candidateCount → limit
  if (req.rerank && chunks.length > limit) {
    const { reranked, costUsd: rerankCost } = await claudeRerank(req.query, chunks, limit)
    chunks = reranked
    costUsd += rerankCost
  } else {
    chunks = chunks.slice(0, limit)
  }

  return { chunks, durationMs: Date.now() - start, costUsd }
}

async function claudeRerank(
  query: string,
  candidates: SearchResultChunk[],
  topK: number,
): Promise<{ reranked: SearchResultChunk[]; costUsd: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[search] ANTHROPIC_API_KEY not set — skipping rerank')
    return { reranked: candidates.slice(0, topK), costUsd: 0 }
  }

  const client = new Anthropic({ apiKey })

  const snippets = candidates
    .slice(0, RERANK_CANDIDATE_COUNT)
    .map(
      (c, i) =>
        `[${i}] source=${c.source} path=${c.sourcePath ?? ''}\n${c.content.slice(0, 400)}`,
    )
    .join('\n\n---\n\n')

  const prompt = `You are a relevance judge for a technical knowledge base. Given the user query and ${candidates.length} candidate chunks, return the indices of the top ${topK} most relevant chunks in order of relevance, as a JSON array. Return ONLY the JSON array, no explanation.

Query: ${query}

Candidates:
${snippets}

Return format: [0, 5, 2, ...]`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
    const indices: number[] = JSON.parse(text.match(/\[[\d,\s]*\]/)?.[0] ?? '[]')

    const reranked = indices
      .filter(i => i >= 0 && i < candidates.length)
      .map(i => candidates[i])
      .slice(0, topK)

    // Estimate cost: ~$0.00025 per 1K input tokens, ~$0.00125 per 1K output tokens for Haiku
    const inputTokens = (prompt.length / 4)
    const costUsd = (inputTokens / 1000) * 0.00025

    return { reranked, costUsd }
  } catch (err) {
    console.error('[search] Claude rerank error:', err)
    return { reranked: candidates.slice(0, topK), costUsd: 0 }
  }
}

export function printSearchResult(result: SearchResult): void {
  console.log(`\nFound ${result.chunks.length} chunks in ${result.durationMs}ms (cost: $${result.costUsd.toFixed(6)})\n`)
  for (const [i, chunk] of result.chunks.entries()) {
    console.log(`[${i + 1}] ${chunk.source} | ${chunk.sourcePath ?? ''} | ${chunk.sourceSection ?? ''} | sim=${chunk.similarity.toFixed(3)}`)
    console.log(chunk.content.slice(0, 300).replace(/\n/g, ' '))
    console.log()
  }
}
