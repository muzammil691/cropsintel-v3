import { getOpenAIClient, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, estimateCost, estimateTokens } from './lib/openai'
import { getSupabaseClient } from './lib/supabase'
import { RawChunk } from './types'

const BATCH_SIZE = 100

export interface EmbedResult {
  inserted: number
  skipped: number
  costUsd: number
}

/**
 * Embed a batch of raw chunks and upsert them into memory_chunks.
 * Skips chunks that already exist (same source+source_path+chunk_index).
 */
export async function embedAndStore(chunks: RawChunk[]): Promise<EmbedResult> {
  if (chunks.length === 0) return { inserted: 0, skipped: 0, costUsd: 0 }

  const sb = getSupabaseClient()
  const oai = getOpenAIClient()

  let inserted = 0
  let skipped = 0
  let totalTokens = 0

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

    // Check which chunks already exist
    const existingKeys = new Set<string>()
    for (const chunk of batch) {
      const key = makeKey(chunk)
      const { data } = await sb
        .from('memory_chunks')
        .select('id')
        .eq('source', chunk.source)
        .eq('source_path', chunk.source_path ?? '')
        .eq('chunk_index', chunk.chunk_index)
        .maybeSingle()
      if (data) existingKeys.add(key)
    }

    const newChunks = batch.filter(c => !existingKeys.has(makeKey(c)))
    skipped += batch.length - newChunks.length

    if (newChunks.length === 0) continue

    // Embed new chunks
    const texts = newChunks.map(c => c.content)
    const tokenCount = texts.reduce((sum, t) => sum + estimateTokens(t), 0)
    totalTokens += tokenCount

    const response = await oai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    })

    const embeddings = response.data.map(d => d.embedding)

    // Upsert each chunk
    const rows = newChunks.map((chunk, idx) => ({
      source: chunk.source,
      source_path: chunk.source_path,
      source_section: chunk.source_section,
      content: chunk.content,
      chunk_index: chunk.chunk_index,
      metadata: chunk.metadata,
      embedding: `[${embeddings[idx].join(',')}]`,
    }))

    const { error } = await sb
      .from('memory_chunks')
      .upsert(rows, { onConflict: 'source,source_path,chunk_index', ignoreDuplicates: false })

    if (error) {
      console.error('[embed] Upsert error:', error.message)
    } else {
      inserted += newChunks.length
    }

    // Small delay to avoid rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await sleep(200)
    }
  }

  return { inserted, skipped, costUsd: estimateCost(totalTokens) }
}

/**
 * Embed a single query text for vector search (not stored).
 */
export async function embedQuery(query: string): Promise<{ embedding: number[]; costUsd: number }> {
  const oai = getOpenAIClient()
  const response = await oai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
    dimensions: EMBEDDING_DIMENSIONS,
  })
  return {
    embedding: response.data[0].embedding,
    costUsd: estimateCost(estimateTokens(query)),
  }
}

function makeKey(chunk: RawChunk): string {
  return `${chunk.source}::${chunk.source_path ?? ''}::${chunk.chunk_index}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
