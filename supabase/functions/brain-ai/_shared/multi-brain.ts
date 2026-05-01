// Phase 1.10aa — multi-brain invocation for the Supabase edge function.
//
// IMPORTANT — duplication notice:
//   This file mirrors the model-invocation logic from
//   `atlas/src/lib/multi-brain.ts` + `atlas/src/providers/{claude,openai,gemini}.ts`,
//   adapted for the Deno runtime (esm.sh imports + Deno.env). When pricing,
//   model names, or provider behavior changes, update BOTH places. This was
//   chosen over extracting a shared module because the runtimes diverge
//   (Node SDK vs Deno esm.sh + different env access).
//
// Provides:
//   - askClaude / askOpenAI / askGemini — single-model calls
//   - runDebate     — fan-out to all 3 in parallel, returns 3 BrainOpinions
//   - runConsensus  — judge model produces unified verdict + structured JSON

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.40.0'
import OpenAI from 'https://esm.sh/openai@4.76.0'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'

import type { BrainOpinion, BrainConsensus } from './types.ts'

const TIMEOUT_MS = 90_000
const MAX_TOKENS = 2048

export const DEBATE_MODEL_CLAUDE = 'claude-opus-4-7'
export const DEBATE_MODEL_OPENAI = 'gpt-4o'
export const DEBATE_MODEL_GEMINI = 'gemini-2.5-pro'
export const CONSENSUS_MODEL = 'gpt-4o'

// Token pricing per 1M tokens (kept in sync with atlas/src/providers/*.ts).
const PRICE = {
  claude: { in: 3.0, out: 15.0 },
  openai: { in: 2.5, out: 10.0 },
  gemini: { in: 1.25, out: 5.0 },
} as const

function calcCost(provider: 'claude' | 'openai' | 'gemini', tokensIn: number, tokensOut: number): number {
  const p = PRICE[provider]
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ])
}

// ---- single-model callers ----

export async function askClaude(prompt: string, systemPrompt: string, model = DEBATE_MODEL_CLAUDE): Promise<BrainOpinion> {
  const start = Date.now()
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return { provider: 'claude', model, content: '', costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, error: 'ANTHROPIC_API_KEY not set' }
  }
  try {
    const client = new Anthropic({ apiKey })
    const res = await withTimeout(
      client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
      TIMEOUT_MS,
      'claude',
    )
    const block = res.content[0]
    const content = block && block.type === 'text' ? block.text : ''
    const inputTokens = res.usage.input_tokens
    const outputTokens = res.usage.output_tokens
    return {
      provider: 'claude',
      model,
      content,
      costUsd: calcCost('claude', inputTokens, outputTokens),
      inputTokens,
      outputTokens,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      provider: 'claude', model, content: '', costUsd: 0, inputTokens: 0, outputTokens: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function askOpenAI(prompt: string, systemPrompt: string, model = DEBATE_MODEL_OPENAI): Promise<BrainOpinion> {
  const start = Date.now()
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return { provider: 'openai', model, content: '', costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, error: 'OPENAI_API_KEY not set' }
  }
  try {
    const client = new OpenAI({ apiKey })
    const res = await withTimeout(
      client.chat.completions.create({
        model,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
      TIMEOUT_MS,
      'openai',
    )
    const content = res.choices[0]?.message?.content ?? ''
    const inputTokens = res.usage?.prompt_tokens ?? 0
    const outputTokens = res.usage?.completion_tokens ?? 0
    return {
      provider: 'openai',
      model,
      content,
      costUsd: calcCost('openai', inputTokens, outputTokens),
      inputTokens,
      outputTokens,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      provider: 'openai', model, content: '', costUsd: 0, inputTokens: 0, outputTokens: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function askGemini(prompt: string, systemPrompt: string, model = DEBATE_MODEL_GEMINI): Promise<BrainOpinion> {
  const start = Date.now()
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return { provider: 'gemini', model, content: '', costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, error: 'GEMINI_API_KEY not set' }
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const m = genAI.getGenerativeModel({ model })
    const fullPrompt = `${systemPrompt}\n\n${prompt}`
    const res = await withTimeout(m.generateContent(fullPrompt), TIMEOUT_MS, 'gemini')
    const content = res.response.text()
    const inputTokens = res.response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = res.response.usageMetadata?.candidatesTokenCount ?? 0
    return {
      provider: 'gemini',
      model,
      content,
      costUsd: calcCost('gemini', inputTokens, outputTokens),
      inputTokens,
      outputTokens,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      provider: 'gemini', model, content: '', costUsd: 0, inputTokens: 0, outputTokens: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---- debate orchestration ----

export interface DebateContext {
  nodeKey: string
  nodeLabel: string
  nodeDescription: string | null
  currentScore: number
  prompt: string
  extraContext?: string
}

function buildDebateSystemPrompt(ctx: DebateContext): string {
  return `You are one of three peer AI advisors debating a question about CropsIntel V3, a multi-commodity market intelligence platform.

The brain node under discussion:
  key:         ${ctx.nodeKey}
  label:       ${ctx.nodeLabel}
  description: ${ctx.nodeDescription ?? '(none)'}
  current score (0-100): ${ctx.currentScore}

Rules:
1. Be specific. Cite file paths, table names, agent names where relevant.
2. Be honest about uncertainty. If you don't know, say so.
3. Be brief — under 350 words.
4. End with a single line: VERDICT: <one short sentence stating your recommended next action>`
}

export async function runDebate(ctx: DebateContext): Promise<BrainOpinion[]> {
  const systemPrompt = buildDebateSystemPrompt(ctx)
  const userPrompt = ctx.extraContext
    ? `${ctx.prompt}\n\n# Additional context\n${ctx.extraContext}`
    : ctx.prompt

  const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([
    askClaude(userPrompt, systemPrompt),
    askOpenAI(userPrompt, systemPrompt),
    askGemini(userPrompt, systemPrompt),
  ])

  const opinions: BrainOpinion[] = []
  if (claudeRes.status === 'fulfilled') opinions.push(claudeRes.value)
  if (openaiRes.status === 'fulfilled') opinions.push(openaiRes.value)
  if (geminiRes.status === 'fulfilled') opinions.push(geminiRes.value)
  return opinions
}

// ---- consensus judge ----

const CONSENSUS_SYSTEM_PROMPT = `You are the Consensus Judge for the CropsIntel V3 Brain AI.

Three peer advisors (Claude, GPT, Gemini) have just debated a question. Your job:
1. Read all three opinions and the original prompt + node context.
2. Identify points of agreement and disagreement.
3. Issue a unified verdict that the human admin can act on.
4. Propose a score change for the brain node (0..100), with reasoning.
5. If the verdict is to ship a change, produce a SPEC-READY PROMPT — a self-contained prompt that the V3 Builder agent could execute. The Builder needs concrete file paths and acceptance criteria.

OUTPUT FORMAT — return ONLY valid JSON, no other text:
{
  "verdict": "<one paragraph, plain English>",
  "score_delta": <number, e.g. -5 or +10>,
  "score_reason": "<one sentence justifying the score change>",
  "spec_ready_prompt": "<full Builder-ready spec, or null if no code change is warranted>"
}`

function buildConsensusUserPrompt(ctx: DebateContext, opinions: BrainOpinion[]): string {
  const opinionBlocks = opinions
    .map((o, i) => {
      const header = `## Opinion ${i + 1} — ${o.provider} (${o.model})`
      const body = o.error ? `[error: ${o.error}]` : o.content
      return `${header}\n${body}`
    })
    .join('\n\n')
  return `# Brain node
key:         ${ctx.nodeKey}
label:       ${ctx.nodeLabel}
description: ${ctx.nodeDescription ?? '(none)'}
current score: ${ctx.currentScore}

# Original prompt
${ctx.prompt}
${ctx.extraContext ? `\n# Additional context\n${ctx.extraContext}` : ''}

# Peer opinions
${opinionBlocks}

Now produce the consensus JSON.`
}

interface ConsensusJson {
  verdict: string
  score_delta: number
  score_reason: string
  spec_ready_prompt: string | null
}

function parseConsensusJson(raw: string): ConsensusJson {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenceMatch ? fenceMatch[1] : raw
  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1) {
    return { verdict: raw.slice(0, 1000), score_delta: 0, score_reason: 'judge returned non-JSON output', spec_ready_prompt: null }
  }
  const slice = candidate.slice(firstBrace, lastBrace + 1)
  try {
    const parsed = JSON.parse(slice) as Partial<ConsensusJson>
    return {
      verdict: typeof parsed.verdict === 'string' ? parsed.verdict : raw.slice(0, 1000),
      score_delta: typeof parsed.score_delta === 'number' ? parsed.score_delta : 0,
      score_reason: typeof parsed.score_reason === 'string' ? parsed.score_reason : 'no reason given',
      spec_ready_prompt: typeof parsed.spec_ready_prompt === 'string' && parsed.spec_ready_prompt.trim().length > 0
        ? parsed.spec_ready_prompt
        : null,
    }
  } catch {
    return { verdict: raw.slice(0, 1000), score_delta: 0, score_reason: 'judge JSON parse failed', spec_ready_prompt: null }
  }
}

export async function runConsensus(ctx: DebateContext, opinions: BrainOpinion[]): Promise<BrainConsensus> {
  const userPrompt = buildConsensusUserPrompt(ctx, opinions)
  const judge = await askOpenAI(userPrompt, CONSENSUS_SYSTEM_PROMPT, CONSENSUS_MODEL)
  const parsed = parseConsensusJson(judge.content)
  return {
    provider: 'consensus',
    model: CONSENSUS_MODEL,
    content: judge.content || '(no content)',
    verdict: parsed.verdict,
    scoreDelta: parsed.score_delta,
    scoreReason: parsed.score_reason,
    specReadyPrompt: parsed.spec_ready_prompt,
    costUsd: judge.costUsd,
    inputTokens: judge.inputTokens,
    outputTokens: judge.outputTokens,
    durationMs: judge.durationMs,
  }
}

export function providerToCostLogProvider(p: 'claude' | 'openai' | 'gemini'): string {
  if (p === 'claude') return 'anthropic'
  if (p === 'gemini') return 'google'
  return 'openai'
}
