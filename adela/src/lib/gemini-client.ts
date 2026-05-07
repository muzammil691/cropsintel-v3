/**
 * Phase 1.6f: Gemini Pro client with retry logic and cost tracking
 *
 * Provides typed wrapper around Google Generative AI SDK for structured
 * extraction with Zod schema validation. Writes cost records to atlas_cost_log
 * after each successful API call.
 */

import { GoogleGenerativeAI, type GenerateContentRequest } from "@google/generative-ai";
import { type ZodSchema } from "zod";
import { supabase } from "./supabase-client";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-1.5-pro";

const genai = new GoogleGenerativeAI(GEMINI_API_KEY);

// Gemini 1.5 Pro pricing (per 1M tokens)
const COST_PER_1M_INPUT = 1.25;
const COST_PER_1M_OUTPUT = 5.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiResponse<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export class GeminiClientError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GeminiClientError";
  }
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

export async function geminiGenerate<T>(
  prompt: string,
  schema: ZodSchema<T>,
  opts?: { maxRetries?: number }
): Promise<GeminiResponse<T>> {
  const maxRetries = opts?.maxRetries ?? 3;
  const delays = [1000, 2000, 4000]; // 1s, 2s, 4s

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await callGemini(prompt, schema);

      // Write cost log on success
      await writeCostLog(result);

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[gemini-client] Attempt ${attempt + 1}/${maxRetries} failed:`,
        lastError.message
      );

      // Wait before retry (except on last attempt)
      if (attempt < maxRetries - 1) {
        await sleep(delays[attempt]);
      }
    }
  }

  throw new GeminiClientError(
    `Gemini generation failed after ${maxRetries} retries`,
    lastError
  );
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

async function callGemini<T>(
  prompt: string,
  schema: ZodSchema<T>
): Promise<GeminiResponse<T>> {
  // Convert Zod schema to JSON Schema for Gemini
  const jsonSchema = zodToJsonSchema(schema);

  const model = genai.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: jsonSchema as never,
    },
  });

  const request: GenerateContentRequest = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  const result = await model.generateContent(request);
  const responseText = result.response.text();

  // Parse and validate with Zod
  const parsed = JSON.parse(responseText);
  const data = schema.parse(parsed);

  // Extract token usage
  const usage = result.response.usageMetadata;
  const tokensIn = usage?.promptTokenCount ?? estimateTokens(prompt);
  const tokensOut = usage?.candidatesTokenCount ?? estimateTokens(responseText);

  // Calculate cost
  const costUsd =
    (tokensIn / 1_000_000) * COST_PER_1M_INPUT +
    (tokensOut / 1_000_000) * COST_PER_1M_OUTPUT;

  return { data, tokensIn, tokensOut, costUsd };
}

async function writeCostLog(result: GeminiResponse<unknown>): Promise<void> {
  try {
    const { error } = await (supabase.from("atlas_cost_log") as any).insert({
      agent_name: "adela/gemini-client",
      model_id: GEMINI_MODEL,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      context: "Market signal extraction",
    });

    if (error) {
      console.warn("[gemini-client] Failed to write cost log:", error.message);
    }
  } catch (err) {
    console.warn("[gemini-client] Cost log write exception:", err);
  }
}

function zodToJsonSchema(schema: ZodSchema): object {
  // Simple Zod-to-JSON-Schema converter for common patterns
  // For production, consider using zod-to-json-schema library
  const def = (schema as any)._def;

  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as ZodSchema);
      if (!(value as any)._def.typeName?.includes("Optional")) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (def.typeName === "ZodString") {
    return { type: "string" };
  }

  if (def.typeName === "ZodNumber") {
    return { type: "number" };
  }

  if (def.typeName === "ZodArray") {
    return {
      type: "array",
      items: zodToJsonSchema(def.type),
    };
  }

  if (def.typeName === "ZodEnum" || def.typeName === "ZodNativeEnum") {
    return {
      type: "string",
      enum: def.values,
    };
  }

  if (def.typeName === "ZodLiteral") {
    return {
      type: typeof def.value,
      const: def.value,
    };
  }

  // Fallback
  return { type: "string" };
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
