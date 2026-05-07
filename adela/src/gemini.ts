import {
  GoogleGenerativeAI,
  type GenerateContentRequest,
} from "@google/generative-ai"
import { config } from "./config"

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error("GEMINI_API_KEY must be set")

const genai = new GoogleGenerativeAI(apiKey)

export async function extractPdfJson<T>(
  pdfBase64: string,
  prompt: string,
  schema: object
): Promise<T> {
  const model = genai.getGenerativeModel({
    model: config.gemini.model,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema as never,
    },
  })

  const request: GenerateContentRequest = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
  }

  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= config.gemini.maxRetries + 1; attempt++) {
    try {
      const result = await model.generateContent(request)
      const text = result.response.text()
      return JSON.parse(text) as T
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt <= config.gemini.maxRetries) {
        await sleep(1000 * attempt)
      }
    }
  }
  throw lastErr!
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
