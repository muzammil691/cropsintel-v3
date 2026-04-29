import { GoogleGenerativeAI } from '@google/generative-ai'
import { AIProvider, PairTurn, ProviderResponse } from '../types'

const TIMEOUT_MS = 90_000
const MODEL = 'gemini-1.5-pro'

// Token pricing (per 1M tokens, as of 2026)
const PRICE_IN_PER_M = 1.25
const PRICE_OUT_PER_M = 5.0

let genAI: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

function calcCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * PRICE_IN_PER_M + (tokensOut / 1_000_000) * PRICE_OUT_PER_M
}

export async function askGemini(
  question: string,
  context?: Record<string, unknown>
): Promise<ProviderResponse> {
  const started = Date.now()
  const systemNote = context ? `\n\nContext: ${JSON.stringify(context)}` : ''
  const fullPrompt = `You are an expert software architect answering a technical question about the CropsIntel V3 project — a multi-commodity agricultural intelligence platform.${systemNote}\n\n${question}`

  try {
    const model = getClient().getGenerativeModel({ model: MODEL })

    const response = await Promise.race([
      model.generateContent(fullPrompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])

    const content = response.response.text()
    const tokensIn = response.response.usageMetadata?.promptTokenCount ?? 0
    const tokensOut = response.response.usageMetadata?.candidatesTokenCount ?? 0

    return {
      provider: 'gemini' as AIProvider,
      content,
      tokensIn,
      tokensOut,
      costUsd: calcCost(tokensIn, tokensOut),
      durationMs: Date.now() - started,
    }
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message === 'timeout'
    return {
      provider: 'gemini' as AIProvider,
      content: isTimeout ? '(timeout)' : `(error: ${err instanceof Error ? err.message : String(err)})`,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      timedOut: isTimeout,
    }
  }
}

export async function pairTurnGemini(
  systemPrompt: string,
  history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  userMessage: string
): Promise<PairTurn> {
  const started = Date.now()

  try {
    const model = getClient().getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
    })

    const chat = model.startChat({ history })

    const response = await Promise.race([
      chat.sendMessage(userMessage),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ])

    const content = response.response.text()
    const tokensIn = response.response.usageMetadata?.promptTokenCount ?? 0
    const tokensOut = response.response.usageMetadata?.candidatesTokenCount ?? 0

    return {
      speaker: 'gemini' as AIProvider,
      content,
      tokensIn,
      tokensOut,
      costUsd: calcCost(tokensIn, tokensOut),
    }
  } catch (_err) {
    return {
      speaker: 'gemini' as AIProvider,
      content: '(error or timeout)',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    }
  }
}
