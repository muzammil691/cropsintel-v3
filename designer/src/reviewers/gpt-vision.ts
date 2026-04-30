import OpenAI from 'openai'
import { AIBrainResult, DesignGap, Verdict } from '../types'

const MODEL = 'gpt-4o'

// gpt-4o pricing: $2.50/MTok input, $10/MTok output (image tokens included in input)
const PRICE_INPUT_PER_MTOK = 2.5
const PRICE_OUTPUT_PER_MTOK = 10.0

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  )
}

function parseJSON(text: string): {
  verdict: Verdict
  confidence: number
  reasoning: string
  gaps: DesignGap[]
} {
  const cleaned = text.replace(/```(?:json)?\n?/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = /\{[\s\S]*\}/.exec(cleaned)
    if (!match) {
      return {
        verdict: 'unknown',
        confidence: 0,
        reasoning: `Could not parse GPT-4o response: ${text.slice(0, 200)}`,
        gaps: [],
      }
    }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return {
        verdict: 'unknown',
        confidence: 0,
        reasoning: `Could not parse GPT-4o JSON: ${text.slice(0, 200)}`,
        gaps: [],
      }
    }
  }

  const obj = parsed as {
    verdict?: string
    confidence?: number
    reasoning?: string
    gaps?: DesignGap[]
  }
  const verdict: Verdict =
    obj.verdict === 'pass' || obj.verdict === 'fail' ? obj.verdict : 'unknown'
  return {
    verdict,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    reasoning: obj.reasoning ?? '',
    gaps: Array.isArray(obj.gaps) ? obj.gaps : [],
  }
}

/**
 * Optional GPT-4o vision review. Only runs when a screenshot URL is provided —
 * v0.1 does not auto-generate screenshots. When called without a screenshot,
 * returns a skipped result.
 */
export async function askGPTVision(args: {
  prompt: string
  screenshotUrl?: string
}): Promise<AIBrainResult> {
  if (!args.screenshotUrl) {
    return {
      verdict: 'unknown',
      reasoning: 'GPT-4o vision skipped — no screenshot_url provided',
      gaps: [],
      confidence: 0,
      costUsd: 0,
    }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[designer] OPENAI_API_KEY not set — skipping GPT-4o vision review')
    return {
      verdict: 'unknown',
      reasoning: 'GPT-4o vision skipped — OPENAI_API_KEY not configured',
      gaps: [],
      confidence: 0,
      costUsd: 0,
    }
  }

  const client = new OpenAI({ apiKey })

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: args.prompt },
            { type: 'image_url', image_url: { url: args.screenshotUrl } },
          ],
        },
      ],
    })

    const text = response.choices[0]?.message?.content ?? ''
    if (!text) throw new Error('Empty response from GPT-4o')

    const parsed = parseJSON(text)
    const cost = estimateCost(
      response.usage?.prompt_tokens ?? 0,
      response.usage?.completion_tokens ?? 0,
    )

    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      gaps: parsed.gaps,
      confidence: parsed.confidence,
      costUsd: cost,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[designer] GPT-4o vision review failed:', msg)
    return {
      verdict: 'unknown',
      reasoning: `GPT-4o call failed: ${msg}`,
      gaps: [],
      confidence: 0,
      costUsd: 0,
    }
  }
}
