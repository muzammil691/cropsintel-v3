# CropsIntel V3 — Memory Agent

Institutional knowledge layer for the CropsIntel V3 production house. Ingests code, documentation, conversation transcripts, and architectural decisions into a vector store; exposes a semantic search API for every other agent.

## Architecture

```
POST /search  ←  Council, Verifier, Builder, Zyra, Atlas
     ↑
memory-agent (Node.js, Railway)
     ↓
Supabase (memory_chunks + pgvector)
     ↑
8 ingest sources (cron daily at 02:00 UTC)
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | V3 Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Service role key (bypasses RLS for writes) |
| `OPENAI_API_KEY` | ✅ | For text-embedding-3-large embeddings |
| `ANTHROPIC_API_KEY` | optional | For Claude reranking (POST /search with rerank:true) |
| `MEMORY_API_TOKEN` | optional | Bearer token for HTTP API auth (empty = open) |
| `PORT` | optional | HTTP port, default 8080 |
| `MASTER_PLAN_PATH` | optional | Override master plan file path |
| `WORKFLOW_DOC_PATH` | optional | Override workflow doc file path |
| `V1_CODEBASE_PATH` | optional | Override V1 codebase path |
| `V2_CODEBASE_PATH` | optional | Override V2 codebase path |
| `CONVERSATIONS_PATH` | optional | Override Cowork sessions path |
| `REPO_ROOT` | optional | Root of the cropsintel-v3 repo (for git-history) |

## Quick start

```bash
cd memory
npm install
npm run build

# One-off full ingest (run once after deployment)
npm run ingest:all

# Start HTTP server
npm start
```

## Ingest sources

| Source | Command | What it indexes |
|---|---|---|
| `master-plan` | `npm run ingest:master-plan` | V3 master plan markdown, chunked by section |
| `workflow-doc` | `npm run ingest:workflow-doc` | MAXONS 15 workflows × 8 departments |
| `audits` | `npm run ingest:audits` | V1/V2 audit docs + V3-CODING-INSTRUCTIONS |
| `v2-codebase` | `npm run ingest:v2-codebase` | CropsIntelV2 source tree (~3 000 chunks) |
| `v1-codebase` | `npm run ingest:v1-codebase` | almond-oracle GitLab (needs deploy key) |
| `conversations` | `npm run ingest:conversations` | Cowork session JSONL transcripts |
| `github-history` | `npm run ingest:github-history` | V3 git log (commits as chunks) |
| `adrs` | `npm run ingest:adrs` | architecture_decisions Supabase table |

## Search API

### POST /search

```bash
curl -X POST http://localhost:8080/search \
  -H "Authorization: Bearer $MEMORY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "how did V2 implement WhatsApp OTP?",
    "sources": ["v2-codebase", "conversations"],
    "limit": 10,
    "rerank": false
  }'
```

Response:
```json
{
  "chunks": [
    {
      "source": "v2-codebase",
      "sourcePath": "src/lib/whatsapp.js",
      "sourceSection": "src/lib/whatsapp.js",
      "content": "...",
      "similarity": 0.87,
      "metadata": { "language": "js", "repo": "v2", "priority": "high" }
    }
  ],
  "durationMs": 312,
  "costUsd": 0.000013
}
```

### POST /ingest (fire-and-forget)

```bash
curl -X POST http://localhost:8080/ingest \
  -H "Authorization: Bearer $MEMORY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "github-history"}'
```

### GET /health

```bash
curl http://localhost:8080/health
# {"status":"ok","service":"cropsintel-memory","ts":"2026-04-29T..."}
```

## CLI search

```bash
npm run search -- "how did V2 handle WhatsApp OTP?"
npm run search -- "what are the 13 Zyra modules?"
npm run search -- "why was the old auth middleware rewritten?"
```

## Integration — how other agents query Memory

Before architecting or implementing any feature, query the Memory agent:

```bash
curl -X POST $MEMORY_URL/search \
  -H "Authorization: Bearer $MEMORY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"<your question>","limit":10}'
```

Common queries:
- `"How did V1 implement Zyra prompt defense?"` → returns V1 source + audit
- `"Why did the master plan reject MAXONS-App integration?"` → returns master plan section
- `"What was V2 runner.js architecture?"` → returns V2 source
- `"What are the 13 Zyra modules per master plan?"` → returns master plan section 11.2

### Council (Deep mode)
Each AI in the council receives the top 5 relevant memory chunks prepended to its prompt before reasoning on any architectural question.

### Verifier
Before judging whether an implementation fulfils its spec, the Verifier pulls the spec section + similar prior implementations from V1/V2 for quality comparison.

### Builder
Before implementing a phase, the Builder asks Memory "show me how V2 did similar work" and incorporates that context into its implementation plan.

## Cost model

- **Embedding model:** `text-embedding-3-large` ($0.00013 / 1K tokens)
- **Initial full ingest:** ~10 000 chunks × ~750 tokens avg = ~$1.00
- **Daily incremental:** ~50 new chunks = ~$0.005/day = ~$0.15/mo
- **Query cost:** ~1 000 tokens / query = $0.00013/query
- **Monthly ceiling:** well under $20 OpenAI budget

## Deployment (Railway)

1. Create a new Railway service pointing at the `memory/` directory
2. Set all env vars above in Railway dashboard
3. Deploy — Railway runs `npm run build && npm start`
4. Run `curl $RAILWAY_URL/health` to verify
5. Run `curl -X POST $RAILWAY_URL/ingest -d '{"source":"all"}'` to kick off full ingest
6. Set Railway cron: `0 2 * * *` → `node dist/index.js ingest --source all`

## Reindexing

To delete and re-embed a source (e.g., after a format change):

```bash
npm run reindex -- --source master-plan
```

To reindex everything (slow, ~$1 cost):

```bash
npm run reindex -- --source all
```
