import OpenAI from 'openai'
import { AIProvider, JudgeResponse, PairTurn, ProviderResponse } from '../types'

const TIMEOUT_MS = 90_000
const JUDGE_TIMEOUT_MS = 30_000
const MODEL = 'gpt-4o'
const JUDGE_MODEL = 'gpt-4o'

// Token pricing (per 1M tokens, as of 2026)
const PRICE_IN_PER_M = 2.5
const PRICE_OUT_PER_M = 10.0

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    client = new OpenAI({ apiKey })
  }
  return client
}

function calcCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * PRICE_IN_PER_M + (tokensOut / 1_000_000) * PRICE_OUT_PER_M
}

export async function askOpenAI(
  question: string,
  context?: Record<string, unknown>
): Promise<ProviderResponse> {
  const started = Date.now()
  const systemNote = context ? `\n\nContext: ${JSON.stringify(context)}` : ''

  try {
    const response = await Promise.race([
      getClient().chat.completions.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'system',
            content: `You are an expert software architect answering a technical question about the CropsIntel V3 project — a multi-commodity agricultural intelligence platform.${systemNote}`,
          },
          { role: 'user', content: question },
        ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])

    const content = response.choices[0]?.message?.content ?? ''
    const tokensIn = response.usage?.prompt_tokens ?? 0
    const tokensOut = response.usage?.completion_tokens ?? 0

    return {
      provider: 'gpt' as AIProvider,
      content,
      tokensIn,
      tokensOut,
      costUsd: calcCost(tokensIn, tokensOut),
      durationMs: Date.now() - started,
    }
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message === 'timeout'
    return {
      provider: 'gpt' as AIProvider,
      content: isTimeout ? '(timeout)' : `(error: ${err instanceof Error ? err.message : String(err)})`,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      timedOut: isTimeout,
    }
  }
}

export interface JudgeInput {
  question: string
  claudeAnswer: string | null
  gptAnswer: string | null
  geminiAnswer: string | null
}

export async function judgeWithGPT4o(input: JudgeInput): Promise<JudgeResponse> {
  const started = Date.now()

  const { buildJudgePrompt } = await import('../prompts/judge-prompt')
  const prompt = buildJudgePrompt(input)

  try {
    const response = await Promise.race([
      getClient().chat.completions.create({
        model: JUDGE_MODEL,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a neutral synthesis judge. Respond with valid JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), JUDGE_TIMEOUT_MS)),
    ])

    const raw = response.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw) as { synthesis?: string; confidence?: number; reasoning?: string }
    const tokensIn = response.usage?.prompt_tokens ?? 0
    const tokensOut = response.usage?.completion_tokens ?? 0

    return {
      synthesis: parsed.synthesis ?? raw,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      reasoning: parsed.reasoning ?? '',
      costUsd: calcCost(tokensIn, tokensOut),
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      synthesis: '(judge failed)',
      confidence: 0,
      reasoning: err instanceof Error ? err.message : String(err),
      costUsd: 0,
      durationMs: Date.now() - started,
    }
  }
}

export async function pairTurnGPT(
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): Promise<PairTurn> {
  const started = Date.now()

  try {
    const response = await Promise.race([
      getClient().chat.completions.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: userMessage },
        ],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])

    const content = response.choices[0]?.message?.content ?? ''
    const tokensIn = response.usage?.prompt_tokens ?? 0
    const tokensOut = response.usage?.completion_tokens ?? 0

    return {
      speaker: 'gpt' as AIProvider,
      content,
      tokensIn,
      tokensOut,
      costUsd: calcCost(tokensIn, tokensOut),
    }
  } catch (_err) {
    return {
      speaker: 'gpt' as AIProvider,
      content: '(error or timeout)',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    }
  }
}
