# Task: Phase 1.10c — Atlas multi-brain orchestrator

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §6 (multi-brain) and §17 Q1 (Sonnet for chat, Opus for debate)
**Context:** Atlas decides three classes of things: trivial (single Sonnet call), substantive (Sonnet first; escalate if uncertain), architectural fork (full debate Claude+GPT+Gemini). This task ports Council's pair-session.ts pattern into atlas/src/lib/multi-brain.ts.
**Estimated effort:** ~30 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Implement a reusable multi-brain orchestrator that other Atlas modules (chat handler, dispatcher, invariants engine) call when they need a decision. Three call modes:

- `simple(prompt)` → single Claude Sonnet 4.6 call, returns string
- `escalating(prompt, options)` → Sonnet first; if confidence < 0.7 OR question flagged high-stakes, escalate to debate
- `debate(prompt, options)` → all three brains write opinions; quorum 2-of-3 → that wins; 3-way split → return `{verdict: 'escalate-to-user', votes}`

Reuse Council's provider modules verbatim where possible.

## Files to create

### atlas/src/providers/claude.ts

Copy `council/src/providers/claude.ts` verbatim (same Anthropic SDK call pattern). Default model: `claude-sonnet-4-6`. Optional override param for `claude-opus-4-7` when escalating.

### atlas/src/providers/openai.ts

Copy `council/src/providers/openai.ts` verbatim. Default model: `gpt-5` (or `gpt-4o` if gpt-5 not available; check Council's current model name).

### atlas/src/providers/gemini.ts

Copy `council/src/providers/gemini.ts` verbatim. Default model: `gemini-2.5-pro`.

### atlas/src/lib/multi-brain.ts

```ts
import { askClaude } from '../providers/claude'
import { askOpenAI } from '../providers/openai'
import { askGemini } from '../providers/gemini'
import { recordCost } from './cost-log'

export interface BrainResponse {
  provider: 'claude' | 'openai' | 'gemini'
  model: string
  content: string
  confidence?: number
  costUsd: number
  durationMs: number
}

export interface DebateResult {
  verdict: 'agreement' | 'majority' | 'escalate-to-user'
  chosen?: string
  votes: BrainResponse[]
  rationale?: string
}

const DEFAULT_CHAT_MODEL = 'claude-sonnet-4-6'
const DEBATE_MODEL_CLAUDE = 'claude-opus-4-7'
const DEBATE_MODEL_OPENAI = 'gpt-5'   // confirm exact name in Council; fallback to gpt-4o
const DEBATE_MODEL_GEMINI = 'gemini-2.5-pro'

export async function simple(prompt: string, opts?: { systemPrompt?: string }): Promise<BrainResponse> {
  const start = Date.now()
  const result = await askClaude({ prompt, model: DEFAULT_CHAT_MODEL, systemPrompt: opts?.systemPrompt })
  const response: BrainResponse = {
    provider: 'claude',
    model: DEFAULT_CHAT_MODEL,
    content: result.content,
    confidence: result.confidence,
    costUsd: result.costUsd,
    durationMs: Date.now() - start,
  }
  await recordCost('anthropic', 'atlas', DEFAULT_CHAT_MODEL, result.inputTokens, result.outputTokens, result.costUsd)
  return response
}

export async function escalating(
  prompt: string,
  opts?: { systemPrompt?: string; highStakes?: boolean; minConfidence?: number },
): Promise<BrainResponse | DebateResult> {
  const minConfidence = opts?.minConfidence ?? 0.7

  if (opts?.highStakes) {
    return await debate(prompt, opts)
  }

  const first = await simple(prompt, opts)
  if (typeof first.confidence === 'number' && first.confidence >= minConfidence) {
    return first
  }
  return await debate(prompt, opts)
}

export async function debate(
  prompt: string,
  opts?: { systemPrompt?: string; quorum?: 2 | 3 },
): Promise<DebateResult> {
  const start = Date.now()
  const quorum = opts?.quorum ?? 2

  const debatePrompt = `${opts?.systemPrompt ? opts.systemPrompt + '\n\n' : ''}${prompt}\n\nAt the end of your response, on its own line, output: VERDICT: <option-id-or-recommendation>`

  // Ask all three in parallel
  const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([
    askClaude({ prompt: debatePrompt, model: DEBATE_MODEL_CLAUDE }),
    askOpenAI({ prompt: debatePrompt, model: DEBATE_MODEL_OPENAI }),
    askGemini({ prompt: debatePrompt, model: DEBATE_MODEL_GEMINI }),
  ])

  const responses: BrainResponse[] = []

  if (claudeRes.status === 'fulfilled') {
    responses.push({
      provider: 'claude', model: DEBATE_MODEL_CLAUDE, content: claudeRes.value.content,
      costUsd: claudeRes.value.costUsd, durationMs: Date.now() - start,
    })
    await recordCost('anthropic', 'atlas', DEBATE_MODEL_CLAUDE, claudeRes.value.inputTokens, claudeRes.value.outputTokens, claudeRes.value.costUsd)
  }
  if (openaiRes.status === 'fulfilled') {
    responses.push({
      provider: 'openai', model: DEBATE_MODEL_OPENAI, content: openaiRes.value.content,
      costUsd: openaiRes.value.costUsd, durationMs: Date.now() - start,
    })
    await recordCost('openai', 'atlas', DEBATE_MODEL_OPENAI, openaiRes.value.inputTokens, openaiRes.value.outputTokens, openaiRes.value.costUsd)
  }
  if (geminiRes.status === 'fulfilled') {
    responses.push({
      provider: 'gemini', model: DEBATE_MODEL_GEMINI, content: geminiRes.value.content,
      costUsd: geminiRes.value.costUsd, durationMs: Date.now() - start,
    })
    await recordCost('google', 'atlas', DEBATE_MODEL_GEMINI, geminiRes.value.inputTokens, geminiRes.value.outputTokens, geminiRes.value.costUsd)
  }

  // Extract verdicts and vote
  const verdicts = responses.map(r => extractVerdict(r.content)).filter(Boolean) as string[]
  const counts = new Map<string, number>()
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1)

  if (responses.length === 0) {
    return { verdict: 'escalate-to-user', votes: [], rationale: 'All three brains failed to respond.' }
  }

  // Find consensus
  let topVote: string | undefined
  let topCount = 0
  for (const [vote, count] of counts.entries()) {
    if (count > topCount) {
      topVote = vote
      topCount = count
    }
  }

  if (topCount === responses.length) {
    return { verdict: 'agreement', chosen: topVote, votes: responses, rationale: `${responses.length}-of-${responses.length} agreement` }
  }
  if (topCount >= quorum) {
    return { verdict: 'majority', chosen: topVote, votes: responses, rationale: `${topCount}-of-${responses.length} majority` }
  }
  return { verdict: 'escalate-to-user', votes: responses, rationale: 'No quorum reached — three-way split or near-split.' }
}

function extractVerdict(content: string): string | null {
  const match = content.match(/VERDICT:\s*(.+?)(?:\n|$)/i)
  return match ? match[1].trim() : null
}
```

### atlas/src/lib/cost-log.ts

```ts
import { getSupabaseClient } from './supabase'

export async function recordCost(
  provider: string,
  service: string,
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  costUsd: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const sb = getSupabaseClient()
    await sb.from('atlas_cost_log').insert({
      provider, service, model,
      input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: costUsd,
      request_metadata: metadata ?? {},
    })
  } catch (err) {
    // Don't fail the request just because cost logging failed
    console.error('[cost-log] failed to record:', err)
  }
}
```

## Acceptance criteria

After this task ships:

1. `atlas/src/providers/{claude,openai,gemini}.ts` exist (copied from Council).
2. `atlas/src/lib/multi-brain.ts` exports `simple`, `escalating`, `debate`.
3. `atlas/src/lib/cost-log.ts` exists.
4. `cd atlas && npm install && npm run build` succeeds.
5. Unit-style smoke test: a small script in `atlas/scripts/test-multi-brain.ts` (also created by this task) calls `simple("What is 2+2?")` and prints the result. Run via `node dist/../scripts/test-multi-brain.js` or `npx ts-node scripts/test-multi-brain.ts`. The agent should run this once to verify it works, then leave the script in the repo.
6. `atlas_cost_log` rows appear in Supabase after the smoke test runs.

## Required env vars (already set on Memory/Council, mirror for Atlas service)

Documented but NOT auto-applied — list them in `.agent/questions/phase-1.10c-q.md` for the user to add:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `V3_SUPABASE_URL` and `V3_SUPABASE_SECRET_KEY` (for cost logging)

## Out of scope

- Streaming responses (handled by chat API in 1.10e — `simple` and `debate` here return final strings)
- Token-cost estimation per provider (use the providers' returned `costUsd`)
- Caching (debates are typically one-shot; skip caching for v0.1)
- Confidence calibration (use whatever Claude reports; refine later)

## Notes

- If Council's provider files use `gpt-4o` instead of `gpt-5`, copy what they use. Don't invent model names.
- All three brains may not be available simultaneously (Gemini quota, OpenAI rate limits). The orchestrator gracefully handles fewer than 3 responses — quorum logic uses `responses.length` as denominator.
- The `VERDICT: <option>` pattern at end of debate prompt is critical — without it, voting fails. Test that the format actually emerges from each provider; some may need a stricter prompt.
