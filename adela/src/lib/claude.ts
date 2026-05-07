/**
 * Claude (Anthropic) wrapper for narrative generation and analysis.
 *
 * Reads ANTHROPIC_API_KEY from env. Exposes generateText(prompt, opts) which
 * sends a prompt to Claude Sonnet and returns the text response. Used for
 * narrative brief generation and fallback signal extraction.
 */

import Anthropic from "@anthropic-ai/sdk"

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set")

const MODEL_NAME = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20241022"
const MAX_RETRIES = 2

const anthropic = new Anthropic({ apiKey })

export interface GenerateOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface GenerateResult {
  text: string
  tokensIn: number
  tokensOut: number
}

export async function generateText(
  prompt: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const model = opts.model ?? MODEL_NAME
  const maxTokens = opts.maxTokens ?? 2048
  const temperature = opts.temperature ?? 1.0

  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      })

      const text =
        response.content[0]?.type === "text" ? response.content[0].text : ""
      const tokensIn = response.usage.input_tokens
      const tokensOut = response.usage.output_tokens

      return { text, tokensIn, tokensOut }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt <= MAX_RETRIES) {
        await sleep(1000 * attempt)
      }
    }
  }
  throw lastErr ?? new Error("Claude generation failed with no captured error")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
