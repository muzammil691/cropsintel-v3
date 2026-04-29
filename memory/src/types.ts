export type SourceName =
  | 'v1-codebase'
  | 'v2-codebase'
  | 'master-plan'
  | 'workflow-doc'
  | 'audits'
  | 'conversations'
  | 'adrs'
  | 'github-history'

export interface MemoryChunk {
  id?: string
  source: SourceName
  source_path: string | null
  source_section: string | null
  content: string
  chunk_index: number
  metadata: Record<string, unknown>
  embedding?: number[]
  ingested_at?: string
}

export interface MemoryRun {
  id?: string
  operation: 'ingest' | 'search' | 'reindex'
  source?: string | null
  chunks_added?: number
  chunks_skipped?: number
  chunks_searched?: number
  query?: string | null
  invoked_by?: string | null
  duration_ms?: number | null
  cost_usd?: number
  metadata?: Record<string, unknown>
}

export interface SearchRequest {
  query: string
  sources?: SourceName[]
  limit?: number
  rerank?: boolean
}

export interface SearchResultChunk {
  source: string
  sourcePath: string | null
  sourceSection: string | null
  content: string
  similarity: number
  metadata: Record<string, unknown>
}

export interface SearchResult {
  chunks: SearchResultChunk[]
  durationMs: number
  costUsd: number
}

export interface IngestResult {
  source: SourceName
  chunksAdded: number
  chunksSkipped: number
  costUsd: number
  durationMs: number
  errors: string[]
}

export interface RawChunk {
  source: SourceName
  source_path: string | null
  source_section: string | null
  content: string
  chunk_index: number
  metadata: Record<string, unknown>
}
