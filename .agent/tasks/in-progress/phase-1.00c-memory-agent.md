# Task: Phase 1.00c — Memory / Research Agent (institutional knowledge layer)

**Master plan reference:** new agent supporting D1 Research & Workflow Polish (master plan 9.1) and feeding all other agents
**User instruction 2026-04-29:** "all the conversations and developments of v1 and v2 and the concepts and logics and everything e2e will be known in memory"
**Estimated effort:** ~10-12 hours
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Build the **Memory Agent** — a knowledge ingestion + semantic search service. Every other agent in the production house (Council, Verifier, Builder, Adela, Zyra, Atlas) queries this when it needs institutional knowledge: V1's almond-oracle implementation history, V2's runner.js logic, past architectural decisions, workflow doc references, prior conversation transcripts.

This is the agent that makes "the system knows everything" real.

## In scope

### Repo structure
Create `memory/` directory at repo root:

```
memory/
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts           ← entrypoint: dispatches based on argv (ingest | search | reindex | server)
│   ├── ingest/
│   │   ├── v1-codebase.ts        ← clones almond-oracle from GitLab (read-only), indexes code
│   │   ├── v2-codebase.ts        ← reads CropsIntelV2 (mounted as volume or cloned), indexes code
│   │   ├── master-plan.ts        ← reads cropsintel-v3-master-plan.md, chunks intelligently
│   │   ├── workflow-doc.ts       ← reads docs/MAXONS_Workflow_v1.md, chunks by workflow
│   │   ├── audits.ts             ← reads v3-step2-v1-audit.md, v3-step3-v2-audit.md, etc.
│   │   ├── conversations.ts      ← reads JSONL session transcripts from Cowork
│   │   ├── adrs.ts               ← reads architecture_decisions table from V3 Supabase
│   │   └── github-history.ts     ← reads V3 git log + commit messages + PR descriptions
│   ├── embed.ts           ← OpenAI text-embedding-3-large, batch 100 chunks at a time
│   ├── search.ts          ← semantic search with reranking (Gemini for fast filtering, Claude for nuanced reranking)
│   ├── server.ts          ← HTTP API for other agents to query
│   ├── lib/
│   │   ├── supabase.ts    ← V3 Supabase client (sb_secret_)
│   │   ├── openai.ts      ← embedding API wrapper
│   │   ├── chunker.ts     ← smart markdown/code chunking respecting headings/functions
│   │   └── audit.ts       ← writes memory_runs
│   └── types.ts
└── .gitignore
```

### Schema additions
Write `supabase/migrations/20260429xxxxxx_memory.sql`:

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- The knowledge base
CREATE TABLE IF NOT EXISTS public.memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,                       -- 'v1-codebase' | 'v2-codebase' | 'master-plan' | 'workflow-doc' | 'audits' | 'conversations' | 'adrs' | 'github-history'
  source_path text,                           -- e.g., 'src/lib/zyra/zyraIntelligenceLayer.ts' for V1 code
  source_section text,                        -- e.g., '11.2 Phase 1' for master plan
  content text NOT NULL,                      -- the chunk's text
  chunk_index int NOT NULL,                   -- ordering within source_path
  metadata jsonb DEFAULT '{}'::jsonb,         -- extra context (commit hash, language, tags)
  embedding vector(3072),                     -- text-embedding-3-large dimensions
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, source_path, chunk_index)
);

-- HNSW index for fast cosine search
CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding
  ON public.memory_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_source
  ON public.memory_chunks (source);

ALTER TABLE public.memory_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read memory chunks" ON public.memory_chunks FOR SELECT USING (true);
CREATE POLICY "Team can insert memory chunks" ON public.memory_chunks FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'team'));
CREATE POLICY "Team can delete memory chunks" ON public.memory_chunks FOR DELETE USING (public.has_role(auth.uid(), 'team'));

-- Audit
CREATE TABLE IF NOT EXISTS public.memory_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,                    -- 'ingest' | 'search' | 'reindex'
  source text,
  chunks_added int DEFAULT 0,
  chunks_searched int DEFAULT 0,
  query text,
  invoked_by text,
  duration_ms int,
  cost_usd numeric DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  ran_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.memory_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read memory runs" ON public.memory_runs FOR SELECT USING (public.has_role(auth.uid(), 'team'));
```

### Ingestion sources (priority order)

#### 1. V3 master plan
Path on Mac: `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md`
- Chunk by section (## headers level 2)
- Each chunk includes its section number for retrieval ("Per master plan section 11.2 row 1.6...")
- Tag metadata: `{section: "11.2", phase: "1.6", topic: "adela"}`

#### 2. MAXONS Workflow Doc
Path: `cropsintel-v3/docs/MAXONS_Workflow_v1.md`
- Chunk by workflow (15 workflows) and department (8 departments)
- Tag metadata: `{workflow: "1", workflow_name: "Price Discovery", department: "Trade Desk"}`

#### 3. V3 audits / docs
Paths:
- `~/Documents/Claude/Projects/Cropsintel/v3-step2-v1-audit.md`
- `~/Documents/Claude/Projects/Cropsintel/v3-step3-v2-audit.md`
- `~/Documents/Claude/Projects/Cropsintel/v3-step4-v1-v2-comparative.md`
- `cropsintel-v3/V3-CODING-INSTRUCTIONS.md`

#### 4. V2 codebase (mounted volume or cloned)
Path: `~/Documents/Claude/Projects/CropsIntelV2`
- Walk source tree
- Index .js, .ts, .jsx, .tsx, .sql, .md files
- Chunk code by function/component
- Skip node_modules, .git, dist, .next, etc.
- Especially valuable: `src/lib/runner.js` (V2's scrape pipeline scaffolding), `src/lib/zyra*` (V2's CRM components), `src/lib/whatsapp.js`, `supabase/functions/*`

#### 5. V1 codebase (clone from GitLab if accessible)
- GitLab URL: `https://gitlab.com/muzammil69/almond-oracle`
- Try git clone using the user's GitHub SSH key (which may NOT have GitLab access — if clone fails, write a question and skip)
- V1 has the deep zyra orchestration framework that's most valuable to learn from
- If unavailable, fall back to V1's audit doc which we have

#### 6. Past Cowork conversation transcripts
Path: `/Users/muzammilakhtar/Library/Application Support/Claude/local-agent-mode-sessions/**/*.jsonl`
- These are Cowork session logs — they contain user instructions, decisions made, code generated, debug sessions
- Chunk by message (each user/assistant turn)
- Filter: only include conversations referencing CropsIntel/V3/Zyra/Adela/etc. (skip unrelated)
- This is HUGE context — every prior decision is here

#### 7. V3 git history + commit messages
- Walk git log
- Each commit becomes a chunk: hash + message + diff summary
- Helps trace "why was this built this way?"

#### 8. ADRs from architecture_decisions table
- Pull rows
- Each ADR becomes a chunk
- Living memory: as Council generates more ADRs, this stays fresh

### Embedding strategy

Use OpenAI `text-embedding-3-large` (3072 dimensions). Why this model:
- Best quality for semantic search
- Master plan budget: $50/mo OpenAI total — embeddings are <$0.001 per chunk, easily fits
- Initial ingest: ~10K chunks expected → ~$10 one-time
- Daily incremental: ~50 chunks (new commits, ADRs, conversations) → ~$0.05/day

### Search API

```typescript
// HTTP server endpoint POST /search
// Other agents query like:
// curl -X POST http://memory:8080/search -H "Authorization: Bearer $MEMORY_API_TOKEN" \
//   -d '{"query":"how did V2 implement WhatsApp OTP?","sources":["v2-codebase","conversations"],"limit":10}'

interface SearchRequest {
  query: string
  sources?: string[]            // optional filter by source
  limit?: number                // default 10
  rerank?: boolean              // if true, use Claude to rerank top 30 → top 10 (slower but better)
}

interface SearchResult {
  chunks: Array<{
    source: string
    sourcePath: string
    sourceSection?: string
    content: string
    similarity: number          // cosine similarity 0-1
    metadata: Record<string, unknown>
  }>
  durationMs: number
  costUsd: number
}
```

### Modes

#### Mode 1: full-ingest (one-off)
- `cd memory && npm run ingest:all`
- Runs all 8 source ingesters
- Reports: "Ingested 8,234 chunks across 8 sources in 14m 22s. Cost: $9.87."

#### Mode 2: incremental (cron daily)
- Schedule: `0 2 * * *` (daily 02:00 UTC)
- Walks each source for changes since last ingest
- Adds new chunks; doesn't re-embed unchanged content
- Removes chunks for files that were deleted

#### Mode 3: search (HTTP server)
- Runs as `node dist/index.js server`
- Listens on :8080
- Auth: `Authorization: Bearer $MEMORY_API_TOKEN`

#### Mode 4: CLI search (debugging)
- `cd memory && npm run search "how does V2 handle WhatsApp OTP?"`
- Prints top 10 chunks with sources

### Integration with other agents

After Memory ships, update agent CLAUDE.md to add:

> ### 12. Querying institutional memory
>
> Before architecting any feature, query the Memory agent:
> ```bash
> curl -X POST $MEMORY_URL/search -H "Authorization: Bearer $MEMORY_API_TOKEN" \
>   -d '{"query":"<your question>"}'
> ```
>
> Common queries:
> - "How did V1 implement Zyra prompt defense?"
> - "Why did the master plan reject MAXONS-App integration in V3?"
> - "What was V2's runner.js architecture?"
> - "What are the 13 Zyra modules per master plan?"

The Council uses this in Deep mode — each AI gets relevant memory chunks injected into its prompt before it reasons.

The Verifier uses this — when judging "does this implementation actually fulfill the spec?", it pulls the spec + similar past implementations from V1/V2 to compare quality.

The Builder uses this — when implementing a phase, it asks Memory "show me how V2 did similar work" and learns from the prior code.

## Out of scope (do NOT do in this task)

- A search UI for humans (Phase 2 admin work)
- Real-time updates (cron daily is enough; if a session needs the latest, run incremental manually)
- Migration of V1's actual data (that's not this task — this is just code/docs/conversations as TEXT for retrieval)
- Cross-encoder reranker (the simple Claude rerank is enough; cross-encoder is Phase 2 optimization)

## Acceptance criteria

1. `memory/` directory with the file structure above
2. Compiles cleanly
3. `npm run ingest:master-plan` ingests the master plan and stores ~50 chunks
4. `npm run ingest:workflow-doc` ingests workflow doc and stores ~80 chunks
5. `npm run ingest:v2-codebase` ingests V2 (~3000 chunks)
6. `npm run search "how did V2 do WhatsApp OTP?"` returns relevant chunks from V2 codebase
7. `npm run search "what are the 13 Zyra modules?"` returns master plan section 11.2 row 1.10
8. Migration creates `memory_chunks` with vector index + `memory_runs` with RLS
9. HTTP server starts, accepts authenticated requests, returns search results
10. README.md describes deployment + how other agents should integrate
11. Cost-controlled: monthly OpenAI embedding spend stays under $20 even with daily incremental
12. Conventional commits

## Foundation check (BEFORE starting)

- Verify pgvector is available in V3 Supabase (it is — Supabase ships with vector extension preinstalled but needs CREATE EXTENSION called once)
- Verify OPENAI_API_KEY is available (it is — recorded in SECRETS.md and Railway)
- Verify V2 codebase is accessible via mounted volume or git clone (V2 is at `~/Documents/Claude/Projects/CropsIntelV2` — Railway service won't have this, so use GitHub clone of `muzammil691/CropsIntelV2`; deploy key needed)
- If V1 GitLab clone fails, write `.agent/questions/phase-1.00c-memory-q.md` describing the gap and proceed with V2-only

## Notes

- Chunks should be 500-1500 tokens. Larger chunks lose specificity; smaller chunks lose context.
- Code chunking: use AST parsing where possible (Babel for JS/TS); fall back to function-boundary regex
- Markdown chunking: split at h2 boundaries, then h3 if chunks too big
- Conversation chunking: each user message + the immediate assistant response is one chunk
- Reserve ~$10/mo budget headroom for unexpected re-embeds (e.g., source format change)

---

**Done condition:** Memory exists, has ingested at least 4 of the 8 sources successfully, search works, other agents can query it via HTTP. Once live, the Council, Verifier, and Builder all gain institutional context they currently lack.
