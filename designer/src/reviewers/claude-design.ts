import Anthropic from '@anthropic-ai/sdk'
import { AIBrainResult, DesignGap, Verdict } from '../types'

const MODEL = 'claude-sonnet-4-5'

// Approx pricing for claude-sonnet-4-5: $3/MTok input, $15/MTok output
const PRICE_INPUT_PER_MTOK = 3.0
const PRICE_OUTPUT_PER_MTOK = 15.0

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
        reasoning: `Could not parse Claude response: ${text.slice(0, 200)}`,
        gaps: [],
      }
    }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return {
        verdict: 'unknown',
        confidence: 0,
        reasoning: `Could not parse Claude JSON: ${text.slice(0, 200)}`,
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

export async function askClaudeDesign(prompt: string): Promise<AIBrainResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[designer] ANTHROPIC_API_KEY not set — skipping Claude design review')
    return {
      verdict: 'unknown',
      reasoning: 'Claude review skipped — ANTHROPIC_API_KEY not configured',
      gaps: [],
      confidence: 0,
      costUsd: 0,
    }
  }

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = response.content.find(b => b.type === 'text')
    const text = block && block.type === 'text' ? block.text : ''
    if (!text) throw new Error('Empty response from Claude')

    const parsed = parseJSON(text)
    const cost = estimateCost(response.usage.input_tokens, response.usage.output_tokens)

    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      gaps: parsed.gaps,
      confidence: parsed.confidence,
      costUsd: cost,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[designer] Claude design review failed:', msg)
    return {
      verdict: 'unknown',
      reasoning: `Claude call failed: ${msg}`,
      gaps: [],
      confidence: 0,
      costUsd: 0,
    }
  }
}
