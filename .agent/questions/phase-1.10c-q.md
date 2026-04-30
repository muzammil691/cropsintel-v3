# Question — phase-1.10c

**Blocking:** Required env vars for Atlas multi-brain providers must be added to the Railway Atlas service

**Context:**
Task phase-1.10c implemented the multi-brain orchestrator in `atlas/src/lib/multi-brain.ts` and three provider files. These providers read API keys from environment variables at runtime. The build succeeds, but the smoke test (`npx ts-node scripts/test-multi-brain.ts`) requires live API keys to execute.

**Options I'm considering:**
Not applicable — this is a documentation/action item for the human operator, not a code decision.

**Action required:**
Add the following env vars to the **Atlas** Railway service (they are already set on Memory/Council services):

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Sonnet / Opus calls via `askClaude()` |
| `OPENAI_API_KEY` | GPT-4o calls via `askOpenAI()` |
| `GEMINI_API_KEY` | Gemini 2.5 Pro calls via `askGemini()` |
| `V3_SUPABASE_URL` | Cost logging to `atlas_cost_log` table |
| `V3_SUPABASE_SECRET_KEY` | Cost logging auth (service role key) |

**Note:** `atlas/src/lib/env.ts` already warns on startup if any of these are missing — Atlas will boot in degraded mode without them, but multi-brain calls will fail at runtime.

**Master plan reference:** §10.2 (AI provider routing), §9.3 (agent audit/cost logging)
