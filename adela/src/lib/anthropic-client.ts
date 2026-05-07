/**
 * Phase 1.6f: Anthropic Claude client with retry logic and cost tracking
 *
 * Provides typed wrapper around Anthropic SDK for text generation.
 * Writes cost records to atlas_cost_log after each successful API call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase-client";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY environment variable is required");
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Claude Sonnet 4.5 pricing (per 1M tokens)
const COST_PER_1M_INPUT = 3.0;
const COST_PER_1M_OUTPUT = 15.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export class AnthropicClientError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AnthropicClientError";
  }
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

export async function claudeComplete(
  systemPrompt: string,
  userMessage: string,
  opts?: { maxRetries?: number; maxTokens?: number }
): Promise<AnthropicResponse> {
  const maxRetries = opts?.maxRetries ?? 3;
  const maxTokens = opts?.maxTokens ?? 1024;
  const delays = [1000, 2000, 4000]; // 1s, 2s, 4s

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await callClaude(systemPrompt, userMessage, maxTokens);

      // Write cost log on success
      await writeCostLog(result);

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[anthropic-client] Attempt ${attempt + 1}/${maxRetries} failed:`,
        lastError.message
      );

      // Wait before retry (except on last attempt)
      if (attempt < maxRetries - 1) {
        await sleep(delays[attempt]);
      }
    }
  }

  throw new AnthropicClientError(
    `Claude generation failed after ${maxRetries} retries`,
    lastError
  );
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<AnthropicResponse> {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";
  const tokensIn = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;

  const costUsd =
    (tokensIn / 1_000_000) * COST_PER_1M_INPUT +
    (tokensOut / 1_000_000) * COST_PER_1M_OUTPUT;

  return { text, tokensIn, tokensOut, costUsd };
}

async function writeCostLog(result: AnthropicResponse): Promise<void> {
  try {
    const { error } = await (supabase.from("atlas_cost_log") as any).insert({
      agent_name: "adela/anthropic-client",
      model_id: ANTHROPIC_MODEL,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      context: "Market brief generation",
    });

    if (error) {
      console.warn("[anthropic-client] Failed to write cost log:", error.message);
    }
  } catch (err) {
    console.warn("[anthropic-client] Cost log write exception:", err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
