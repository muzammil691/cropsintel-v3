/**
 * Gemini wrapper for structured extraction.
 *
 * Reads GEMINI_API_KEY from env. Exposes extractStructured(raw, schema) which
 * sends raw text to Gemini Pro/Flash with a JSON response schema and returns
 * the parsed object. Caller is responsible for validating the shape against
 * its own Zod / runtime schema before persisting.
 */

import { GoogleGenerativeAI, type GenerateContentRequest } from "@google/generative-ai"

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error("GEMINI_API_KEY must be set")

const MODEL_NAME = process.env.GEMINI_MODEL ?? "gemini-2.0-flash"
const MAX_RETRIES = 2

const genai = new GoogleGenerativeAI(apiKey)

export interface ExtractOptions {
  prompt?: string
  schema?: object
  model?: string
}

const DEFAULT_PROMPT =
  "Extract structured data from the input below. Return ONLY valid JSON matching the schema. Do not add explanatory text."

export async function extractStructured<T = Record<string, unknown>>(
  raw: string,
  schema: object,
  opts: ExtractOptions = {}
): Promise<T> {
  const model = genai.getGenerativeModel({
    model: opts.model ?? MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema as never,
    },
  })

  const prompt = opts.prompt ?? DEFAULT_PROMPT
  const request: GenerateContentRequest = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${prompt}\n\n---\n\n${raw}` }],
      },
    ],
  }

  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const result = await model.generateContent(request)
      const text = result.response.text()
      return JSON.parse(text) as T
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt <= MAX_RETRIES) {
        await sleep(1000 * attempt)
      }
    }
  }
  throw lastErr ?? new Error("Gemini extraction failed with no captured error")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// extractCropData — convenience wrapper for HTML inputs (phase-1.00e-rem)
//
// Sends the raw HTML to Gemini and asks for a flat array of crop data rows.
// Each row is a generic key/value bag — callers are responsible for narrowing
// to a domain shape (PriceRow, PositionRow, etc.) before persisting.
// ---------------------------------------------------------------------------
export interface CropDataRow {
  variety?: string
  size_grade?: string
  origin_country?: string
  destination_country?: string
  price_per_lb_usd?: number | null
  quantity_lbs?: number | null
  occurred_at?: string
  source_url?: string
  notes?: string
  [key: string]: unknown
}

const CROP_DATA_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          variety: { type: "string", nullable: true },
          size_grade: { type: "string", nullable: true },
          origin_country: { type: "string", nullable: true },
          destination_country: { type: "string", nullable: true },
          price_per_lb_usd: { type: "number", nullable: true },
          quantity_lbs: { type: "number", nullable: true },
          occurred_at: { type: "string", nullable: true },
          source_url: { type: "string", nullable: true },
          notes: { type: "string", nullable: true },
        },
      },
    },
  },
  required: ["rows"],
}

const CROP_DATA_PROMPT =
  "Extract structured crop market data rows from the HTML below. Return ONLY valid JSON with a top-level 'rows' array; each row is a flat object with the listed properties. Use null for missing fields."

export async function extractCropData(html: string): Promise<CropDataRow[]> {
  const result = await extractStructured<{ rows?: CropDataRow[] }>(html, CROP_DATA_SCHEMA, {
    prompt: CROP_DATA_PROMPT,
  })
  return Array.isArray(result?.rows) ? result.rows : []
}
