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
const DEBATE_MODEL_OPENAI = 'gpt-4o'
const DEBATE_MODEL_GEMINI = 'gemini-2.5-pro'

// Role-specific lenses for the 3-way debate. Each provider critiques the same
// draft from a domain it's strongest at, so the cross-perspective is sharper
// than three identical critiques. Phase 1 of the agent-loop redesign — see
// the plan for the full pipeline. Callers can still override via opts.systemPrompt;
// when they do, the lens is appended after the caller's prompt.
const ANALYTICAL_LENS =
  'You are the analytical reviewer in a 3-way critique. ' +
  'Your specialty: architectural soundness, type safety, business logic correctness, ' +
  'foundation-first dependency order (master plan §11.6 NEVER list), and security ' +
  '(no AI keys in client code, RLS on new tables, information walls). Critique the ' +
  'draft from THIS lens specifically. Trust your peers (frontend & research) to cover ' +
  'their domains; do not duplicate their work.'

const FRONTEND_LENS =
  'You are the frontend reviewer in a 3-way critique. ' +
  'Your specialty: shadcn-component fit, a11y (aria-label, role, focus-visible:ring, ' +
  'keyboard nav), responsive layout (mobile-first sm:/md:/lg: prefixes), motion ' +
  '(transition-colors duration-200 paired with hover:), design tokens (no hard-coded ' +
  'colors), loading skeletons, touch-target ≥44px on mobile. Critique the draft from ' +
  'THIS lens specifically. Trust your peers to cover analytics and research.'

const RESEARCH_LENS =
  'You are the research reviewer in a 3-way critique. ' +
  'Your specialty: prior-art alignment with this repo (V1/V2 audit lessons in ' +
  'docs/v3-step2-v1-audit.md and v3-step3-v2-audit.md), master plan §11 phase ordering, ' +
  'workflow doc cross-references (docs/MAXONS_Workflow_v1.md), and industry patterns. ' +
  'Critique the draft from THIS lens specifically — flag anything that contradicts ' +
  'prior decisions, ignores established patterns, or duplicates work already shipped. ' +
  'Trust your peers to cover analytics and frontend.'

function composeLensPrompt(baseSystemPrompt: string | undefined, lens: string): string {
  return baseSystemPrompt ? `${baseSystemPrompt}\n\n${lens}` : lens
}

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

  // The shared body of the prompt — same draft, same verdict instruction.
  // Role-specific framing comes through each provider's systemPrompt below.
  const debatePrompt = `${prompt}\n\nAt the end of your response, on its own line, output: VERDICT: <option-id-or-recommendation>`

  // Each provider gets its own lens. Caller's opts.systemPrompt (if any) is
  // prepended as shared context, then the lens is appended so the lens has
  // the last word on framing.
  const claudeSystem = composeLensPrompt(opts?.systemPrompt, ANALYTICAL_LENS)
  const openaiSystem = composeLensPrompt(opts?.systemPrompt, FRONTEND_LENS)
  const geminiSystem = composeLensPrompt(opts?.systemPrompt, RESEARCH_LENS)

  const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([
    askClaude({ prompt: debatePrompt, model: DEBATE_MODEL_CLAUDE, systemPrompt: claudeSystem }),
    askOpenAI({ prompt: debatePrompt, model: DEBATE_MODEL_OPENAI, systemPrompt: openaiSystem }),
    askGemini({ prompt: debatePrompt, model: DEBATE_MODEL_GEMINI, systemPrompt: geminiSystem }),
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
  } else {
    // Step 2 of agent-loop stabilization: when Gemini fails (503/overloaded
    // is the recurring pattern), fall back to GPT-4o with the RESEARCH_LENS
    // so we still get 3 votes. Without this, every Gemini outage forced a
    // 2/3 → 'no quorum' → escalate-to-user loop.
    const reason = geminiRes.reason instanceof Error ? geminiRes.reason.message : String(geminiRes.reason ?? '')
    const transient = /503|429|overloaded|service unavailable|high demand|timeout|etimedout/i.test(reason)
    if (transient) {
      console.warn(`[multi-brain] Gemini transient failure (${reason.slice(0, 80)}) — falling back to GPT-4o with RESEARCH_LENS`)
      try {
        const fallback = await askOpenAI({
          prompt: debatePrompt,
          model: DEBATE_MODEL_OPENAI,
          systemPrompt: composeLensPrompt(opts?.systemPrompt, RESEARCH_LENS),
        })
        responses.push({
          provider: 'openai',
          model: `${DEBATE_MODEL_OPENAI}+research-fallback`,
          content: fallback.content,
          costUsd: fallback.costUsd,
          durationMs: Date.now() - start,
        })
        await recordCost('openai', 'atlas', DEBATE_MODEL_OPENAI, fallback.inputTokens, fallback.outputTokens, fallback.costUsd)
      } catch (fbErr) {
        console.error('[multi-brain] GPT-4o research fallback also failed:', fbErr instanceof Error ? fbErr.message : fbErr)
      }
    }
  }

  const verdicts = responses.map(r => extractVerdict(r.content)).filter(Boolean) as string[]
  const counts = new Map<string, number>()
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1)

  if (responses.length === 0) {
    return { verdict: 'escalate-to-user', votes: [], rationale: 'All three brains failed to respond.' }
  }

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
