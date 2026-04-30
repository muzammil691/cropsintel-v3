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
