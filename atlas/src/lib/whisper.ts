// OpenAI Whisper STT client — server-side proxy for Atlas voice input.
// API key MUST live only in atlas service env (OPENAI_API_KEY); never bundled into the browser.

import OpenAI from 'openai'

export const WHISPER_MODEL = 'whisper-1'
// Whisper pricing: $0.006 per minute of audio (rounded to nearest second).
export const WHISPER_COST_PER_MINUTE_USD = 0.006
// Reject anything larger than 25 MB (OpenAI's hard cap).
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024
// Reject anything longer than 90 s — server-side mirror of the 60 s client cap, with margin.
export const WHISPER_MAX_DURATION_SECONDS = 90

export const ACCEPTED_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
] as const

let _openai: OpenAI | null = null
function getClient(): OpenAI | null {
  if (_openai) return _openai
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  _openai = new OpenAI({ apiKey: key })
  return _openai
}

export interface WhisperResult {
  text: string
  durationMs: number
}

export async function transcribe(audio: Buffer, mimeType: string, filename = 'audio.webm'): Promise<WhisperResult> {
  const client = getClient()
  if (!client) throw new Error('OPENAI_API_KEY not configured')

  // OpenAI SDK accepts a File-like object via toFile helper, which works on Node 18+.
  const { toFile } = await import('openai/uploads')
  const file = await toFile(audio, filename, { type: mimeType })

  const start = Date.now()
  const result = await client.audio.transcriptions.create({
    file,
    model: WHISPER_MODEL,
    response_format: 'json',
    language: 'en',
  })
  return { text: (result as { text: string }).text ?? '', durationMs: Date.now() - start }
}

// Estimate audio duration in seconds from raw bytes — assumes 16 kHz 16-bit mono PCM equivalent
// for the compressed payload. This is a rough proxy used solely for cost logging; the real
// duration could be parsed from container headers but Whisper bills by the audio second
// regardless and we already cap recording at 60 s client-side.
export function estimateAudioSeconds(byteLength: number): number {
  return byteLength / (16000 * 2)
}

export function estimateWhisperCostUsd(audioSeconds: number): number {
  return (audioSeconds / 60) * WHISPER_COST_PER_MINUTE_USD
}
