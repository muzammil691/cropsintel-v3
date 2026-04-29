# CropsIntel V3 — Council

The Council is a multi-brain architectural decision engine. It runs Claude Opus 4.7, GPT-4o, and Gemini Pro in parallel (or in structured pair sessions for deep mode), then synthesizes their answers into a single Architecture Decision Record (ADR).

---

## Three modes

| Mode | Command | Cost | When to use |
|---|---|---|---|
| **CLI** | `npm run council "question"` | ~$0.50 | One-off architectural questions |
| **CLI Deep** | `npm run council "question" --deep` | ~$3-5 | Critical decisions with real trade-offs |
| **Cron** | `npm run council:cron-once` (or `COUNCIL_MODE=cron node dist/index.js`) | ~$0.50/day | Auto-generates task specs for pending phases |
| **HTTP Server** | `npm run council:server` | per-request | Atlas (R3) calling in Phase 2 |

---

## Deployment as Railway service

### 1. Create the service

1. In Railway dashboard → your `generous-possibility` project → **New Service → GitHub Repo**
2. Select `cropsintel-v3` repo
3. Set **Root Directory** to `council`
4. Railway will detect the Dockerfile automatically

### 2. Environment variables

Set these in Railway → your council service → **Variables**:

| Variable | Description | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `GEMINI_API_KEY` | Google Generative AI key | `AIza...` |
| `V3_SUPABASE_URL` | V3 Supabase project URL | `https://hzrnohsxigrqlmzegwlb.supabase.co` |
| `V3_SUPABASE_SECRET_KEY` | Supabase service role key (starts with `sb_secret_` or `eyJ...`) | |
| `AGENT_SSH_PRIVATE_KEY` | SSH private key for git push in cron mode | Paste the full PEM key |
| `COUNCIL_MODE` | Default mode | `cron` |
| `COUNCIL_API_TOKEN` | Random secret for HTTP auth | Generate with `openssl rand -hex 32` |
| `MASTER_PLAN_PATH` | Path to master plan inside container | `/app/master-plan.md` (mount or copy) |

### 3. Service settings

- **Restart Policy:** Always
- **Watch Paths:** `council/**`
- **Cron / Start command:** leave default (uses Dockerfile CMD)

### 4. Mount the master plan (for cron mode)

The cron mode needs to read `master-plan.md`. Two options:

**Option A — Copy at build time** (simplest):
Add to Dockerfile before `npm run build`:
```dockerfile
COPY ../cropsintel-v3-master-plan.md /app/master-plan.md
```
Set env: `MASTER_PLAN_PATH=/app/master-plan.md`

**Option B — Railway volume** (keeps plan up to date):
Create a Railway volume, mount at `/data/master-plan.md`, set `MASTER_PLAN_PATH=/data/master-plan.md`.

### 5. Verify deployment

After deploy, test from terminal:
```bash
cd council && npm run build && npm run council "What is the best way to handle multi-tenant org switching in Supabase?"
```

Expected output: ADR markdown with confidence score + run ID.

---

## Quick mode (default)

Three AIs answer in parallel. GPT-4o synthesizes.

```
[Council] Mode: QUICK | Question: Should we use Tailwind v4 or v3?

[Synthesis]
...judge output...

Total cost: $0.0023 | Confidence: 87% | Run ID: abc123
```

Wall time: ~20-40s.

## Deep mode (`--deep`)

Three rotating pair sessions → tri-council synthesis → research validation.

```
[Council Deep] Phase 1: Pair sessions
  Session 1/3 (Claude+GPT, reviewed by Gemini)... done [82s]
  Session 2/3 (Claude+Gemini, reviewed by GPT)... done [76s]
  Session 3/3 (GPT+Gemini, reviewed by Claude)... done [71s]

[Council Deep] Phase 2: Tri-council synthesis... done [43s]

[Council Deep] Phase 3: Research validation... done [28s]
```

Wall time: ~5-8 minutes. Cost: ~$3-5.

**When to use Deep:** Genuine architectural trade-offs — library choices, data model decisions, cross-cutting patterns that affect multiple phases.

---

## Auto-task-writer (cron)

Runs daily at 04:00 UTC. Reads master plan → finds pending phases → generates 1 task spec/day.

Manual trigger:
```bash
cd council && npm run council:cron-once
```

Output: `.agent/tasks/queued/phase-X.YY-name.md` committed to `main`.

If the generated spec contains an architectural decision requiring council, it is flagged with `<!-- council:needs-deep-review -->` so the dev-time agent can call Deep Council before implementing.

---

## HTTP API (Phase 2)

```bash
curl -X POST http://localhost:8080/council \
  -H "Authorization: Bearer $COUNCIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question": "Should we use JSONB or relational tables for market intelligence?", "depth": "quick"}'
```

Response:
```json
{
  "runId": "uuid",
  "finalDecision": "...",
  "confidence": 0.85,
  "costUsd": 0.0023,
  "durationMs": 28000,
  "depth": "quick",
  "adrMarkdown": "# ADR-001: ..."
}
```

---

## ADR audit trail

Every council run writes to:
- `council_runs` table in V3 Supabase (full trace, including all pair session dialogues in deep mode)
- `architecture_decisions` table (ADR number, title, decision text)
- `council_budget` table (monthly spend tracking)

Monthly budget cap: $50 (configurable via `council_budget.cap_usd`). Alerts at 80% and 100%.

---

## Database schema

Managed by `supabase/migrations/20260429000003_council.sql`. Apply with:
```bash
npx supabase db push
```

Tables: `council_runs`, `architecture_decisions`, `council_budget`.

---

## Local development

```bash
cd council
cp .env.example .env   # fill in your API keys
npm install
npm run build
npm run council "test question"
```

---

## Architecture

```
council/
├── src/
│   ├── index.ts              entrypoint — dispatches by mode
│   ├── council.ts            core: quickCouncil + deepCouncil + entry point
│   ├── pair-session.ts       pair dialogue protocol for Deep mode
│   ├── providers/
│   │   ├── claude.ts         Anthropic SDK (Opus 4.7)
│   │   ├── openai.ts         OpenAI SDK (GPT-4o + judge)
│   │   └── gemini.ts         Google Generative AI SDK (Gemini 1.5 Pro)
│   ├── prompts/
│   │   ├── adr-prompt.ts     ADR markdown generator
│   │   ├── task-spec-prompt.ts  task spec prompt builder
│   │   └── judge-prompt.ts   GPT-4o judge prompt
│   ├── lib/
│   │   ├── supabase.ts       Supabase client (service role)
│   │   ├── budget.ts         monthly spend tracking + cap enforcement
│   │   ├── audit.ts          council_runs + architecture_decisions write
│   │   └── plan-reader.ts    master plan parser
│   ├── modes/
│   │   ├── cli.ts            CLI handler
│   │   ├── auto-task-writer.ts  cron mode: generates task specs
│   │   └── server.ts         Express HTTP API for Atlas
│   └── types.ts              shared TypeScript types
```
