-- =============================================================================
-- CropsIntel V3 — Memory Agent schema
-- =============================================================================
-- Implements the institutional knowledge layer (Phase 1.00c):
--   memory_chunks  — vector store for all ingested knowledge
--   memory_runs    — audit log for ingest / search operations
--
-- Requires: pgvector extension (pre-installed on Supabase)
-- Author: CropsIntel V3 Agent
-- Date: 2026-04-29
-- =============================================================================

-- Extension
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- memory_chunks — the knowledge base
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memory_chunks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text        NOT NULL,
  source_path    text,
  source_section text,
  content        text        NOT NULL,
  chunk_index    int         NOT NULL,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  embedding      vector(3072),
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding
  ON public.memory_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source
  ON public.memory_chunks (source);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_path
  ON public.memory_chunks (source_path)
  WHERE source_path IS NOT NULL;

ALTER TABLE public.memory_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read memory chunks"
  ON public.memory_chunks FOR SELECT USING (true);

CREATE POLICY "Team can insert memory chunks"
  ON public.memory_chunks FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'team'));

CREATE POLICY "Team can update memory chunks"
  ON public.memory_chunks FOR UPDATE
  USING (public.has_role(auth.uid(), 'team'));

CREATE POLICY "Team can delete memory chunks"
  ON public.memory_chunks FOR DELETE
  USING (public.has_role(auth.uid(), 'team'));

-- -----------------------------------------------------------------------------
-- search_memory_chunks — vector similarity stored procedure
-- Called via supabase.rpc('search_memory_chunks', {...})
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_memory_chunks(
  query_embedding vector(3072),
  source_filter   text[]  DEFAULT NULL,
  match_count     int     DEFAULT 10
)
RETURNS TABLE (
  id             uuid,
  source         text,
  source_path    text,
  source_section text,
  content        text,
  chunk_index    int,
  metadata       jsonb,
  ingested_at    timestamptz,
  similarity     float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mc.id,
    mc.source,
    mc.source_path,
    mc.source_section,
    mc.content,
    mc.chunk_index,
    mc.metadata,
    mc.ingested_at,
    (1 - (mc.embedding <=> query_embedding))::float AS similarity
  FROM public.memory_chunks mc
  WHERE
    mc.embedding IS NOT NULL
    AND (source_filter IS NULL OR mc.source = ANY(source_filter))
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- memory_runs — audit log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memory_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation      text        NOT NULL,
  source         text,
  chunks_added   int         NOT NULL DEFAULT 0,
  chunks_skipped int         NOT NULL DEFAULT 0,
  chunks_searched int        NOT NULL DEFAULT 0,
  query          text,
  invoked_by     text,
  duration_ms    int,
  cost_usd       numeric(10,6) NOT NULL DEFAULT 0,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ran_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_runs_operation ON public.memory_runs (operation);
CREATE INDEX IF NOT EXISTS idx_memory_runs_ran_at   ON public.memory_runs (ran_at DESC);

ALTER TABLE public.memory_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read memory runs"
  ON public.memory_runs FOR SELECT
  USING (public.has_role(auth.uid(), 'team'));

CREATE POLICY "Service role can insert memory runs"
  ON public.memory_runs FOR INSERT
  WITH CHECK (true);
