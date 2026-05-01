// ElevenLabs TTS client — server-side proxy for Atlas voice replies.
// API key MUST live only in atlas service env (ELEVENLABS_API_KEY); never bundled into the browser.

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'
const ELEVENLABS_WS_BASE = 'wss://api.elevenlabs.io/v1'
export const VOICE_DEFAULT = 'EXAVITQu4vr4xnSDxMaL' // Bella
export const TTS_MODEL = 'eleven_turbo_v2'          // ~$0.30 / 1K chars
export const TTS_COST_PER_1K_CHARS_USD = 0.30
export const TTS_MAX_CHARS = 2000
export const TTS_TRUNCATE_SUFFIX = '… <reply continues in chat>'
// WhatsApp voice notes are bounded tighter to keep audio under Twilio's 16 MB
// media cap and avoid awkwardly long voice replies on a phone.
export const VOICE_NOTE_MAX_CHARS = 1500
export const VOICE_NOTE_TRUNCATE_SUFFIX = '… (voice continues in chat)'

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  category?: string
  labels?: Record<string, string>
  preview_url?: string
}

export function truncateForTts(text: string, max = TTS_MAX_CHARS): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - TTS_TRUNCATE_SUFFIX.length)) + TTS_TRUNCATE_SUFFIX
}

export function estimateTtsCostUsd(charCount: number): number {
  return (charCount / 1000) * TTS_COST_PER_1K_CHARS_USD
}

export async function streamTts(text: string, voiceId: string): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
}

// Open an upstream WebSocket to the ElevenLabs `stream-input` endpoint. The caller
// is responsible for sending text chunks (`{ text, try_trigger_generation: true }`),
// flushing with `{ text: "" }`, and forwarding base64-encoded audio chunks back to
// the client. The xi-api-key MUST stay in this process — never echo it on the
// downstream WS.
export function buildElevenLabsStreamInputUrl(voiceId: string): string {
  return `${ELEVENLABS_WS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?model_id=${TTS_MODEL}&output_format=mp3_44100_128`
}

export function getElevenLabsApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY ?? null
}

// One-shot TTS that returns the full audio as a Buffer. Used by the WhatsApp
// voice-reply path where we need the bytes in hand to upload to Supabase
// Storage before pinging Twilio. Returns MP3 bytes (audio/mpeg).
export interface GenerateVoiceNoteResult {
  audio: Buffer
  charCount: number
  truncated: boolean
  voiceId: string
}

export function truncateForVoiceNote(text: string, max = VOICE_NOTE_MAX_CHARS): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - VOICE_NOTE_TRUNCATE_SUFFIX.length)) + VOICE_NOTE_TRUNCATE_SUFFIX
}

export async function generateVoiceNote(
  text: string,
  voiceId: string = VOICE_DEFAULT,
): Promise<GenerateVoiceNoteResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured')
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('generateVoiceNote: empty text')

  const truncated = trimmed.length > VOICE_NOTE_MAX_CHARS
  const finalText = truncated ? truncateForVoiceNote(trimmed) : trimmed

  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: finalText,
      model_id: TTS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ElevenLabs TTS ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }

  const audio = Buffer.from(await res.arrayBuffer())
  return { audio, charCount: finalText.length, truncated, voiceId }
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured')
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs voices ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = (await res.json()) as { voices?: ElevenLabsVoice[] }
  return Array.isArray(data.voices) ? data.voices : []
}
