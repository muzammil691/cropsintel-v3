import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws'
import Anthropic from '@anthropic-ai/sdk'
import { validateEnv } from './lib/env'
import { dispatch } from './lib/dispatch'
import { TOOLS, ToolName } from './lib/tools'
import { getSupabaseClient } from './lib/supabase'
import { getBurnRate } from './lib/cost-gate'
import {
  sendWhatsAppReply,
  sendWhatsAppMedia,
  downloadTwilioMedia,
  validateTwilioSignature,
} from './lib/twilio'
import {
  isPhoneAllowed,
  generateOtpCode,
  insertOtp,
  countRecentOtpRequests,
  findActiveOtp,
  compareOtp,
  incrementOtpAttempts,
  markOtpUsed,
  burnAllOtpsForPhone,
  createSession,
  findSessionByToken,
  touchSessionLastSeen,
  revokeSession,
  listSessionsForPhone,
  sendOtpViaWhatsApp,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_MAX,
} from './lib/auth'
import { uploadVoiceNote, VOICE_OUT_MAX_BYTES } from './lib/voice-note-storage'
import { randomUUID } from 'crypto'
import { startSnapshotCron } from './cron/snapshot'
import { startConductorLoop } from './cron/conductor'
import { getCurrentMode, getModeMetadata, setMode, loadTrustModeFromDb } from './lib/trust-mode'
import { buildHonestyPrompt } from './lib/system-prompt'
import { detectIntent, buildIntentHint } from './lib/intent-detect'
import {
  streamTts,
  listVoices,
  truncateForTts,
  VOICE_DEFAULT,
  estimateTtsCostUsd,
  buildElevenLabsStreamInputUrl,
  getElevenLabsApiKey,
  generateVoiceNote,
  VOICE_NOTE_MAX_CHARS,
} from './lib/elevenlabs'
import { recordElevenLabsTtsCost, recordWhisperSttCost, getMonthlyProviderSpendUsd } from './lib/cost-log'
import {
  transcribe,
  ACCEPTED_MIME_TYPES,
  WHISPER_MAX_BYTES,
  estimateAudioSeconds,
  estimateWhisperCostUsd,
} from './lib/whisper'
import { TrustMode } from './types'

const ELEVENLABS_BUDGET_GATE_USD = parseFloat(process.env.ATLAS_BUDGET_ELEVENLABS_GATE ?? '90')
const OPENAI_BUDGET_GATE_USD = parseFloat(process.env.ATLAS_BUDGET_OPENAI_GATE ?? '45')

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const ATLAS_API_TOKEN = process.env.ATLAS_API_TOKEN

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOL_DEFINITIONS = Object.entries(TOOLS).map(([name, t]) => ({
  name: name.replace('.', '_'),
  description: t.description,
  input_schema: { type: 'object' as const, properties: {}, additionalProperties: true },
}))

function getSystemPrompt(): string {
  return buildHonestyPrompt({ trustMode: getCurrentMode() })
}

// Authenticated principal — either a real user session (phone) or the
// service-to-service legacy bearer (Builder, conductor cron). Retains a
// `sessionId === 'service'` sentinel so the rest of the server can branch.
export interface AuthPrincipal {
  phone: string
  sessionId: string
}

// Phase 1.10aj — Atlas now requires either a user session token (issued via
// /atlas/auth/verify-otp) OR the service bearer (ATLAS_API_TOKEN, used by
// Builder + conductor cron). User-issued tokens are 64-hex-char opaque random
// strings; only the sha256 hash is persisted. The legacy ATLAS_API_TOKEN path
// is kept exactly for the in-cluster service caller and nothing else.
async function authenticate(req: IncomingMessage): Promise<AuthPrincipal | null> {
  const auth = (req.headers['authorization'] as string | undefined) ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null

  // Service bearer — used by Builder and conductor cron. Only this exact
  // value, never anything user-derivable.
  if (ATLAS_API_TOKEN && token === ATLAS_API_TOKEN) {
    return { phone: 'service', sessionId: 'service' }
  }

  // User session token — look up sha256(token) in atlas_sessions.
  const session = await findSessionByToken(token)
  if (!session) return null

  // Fire-and-forget last_seen touch so /atlas/auth/sessions reflects activity.
  touchSessionLastSeen(session.id).catch(() => {})

  return { phone: session.phone, sessionId: session.id }
}

// Convenience: return 401 + null when unauthenticated, principal when ok.
async function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<AuthPrincipal | null> {
  const principal = await authenticate(req)
  if (!principal) {
    json(res, 401, { error: 'Unauthorized' })
    return null
  }
  return principal
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function readBodyBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error('payload_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

interface ParsedMultipartFile {
  field: string
  filename: string
  mimeType: string
  data: Buffer
}

// Minimal multipart/form-data parser for a single audio file field.
// Sufficient for browser MediaRecorder uploads where the body is a single file part.
function parseMultipart(body: Buffer, boundary: string): ParsedMultipartFile[] {
  const dashBoundary = Buffer.from(`--${boundary}`)
  const crlf = Buffer.from('\r\n')
  const files: ParsedMultipartFile[] = []

  let offset = 0
  while (offset < body.length) {
    const start = body.indexOf(dashBoundary, offset)
    if (start < 0) break
    let cursor = start + dashBoundary.length
    // Closing boundary "--boundary--"
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break
    // Skip the trailing CRLF after boundary
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2

    // Read headers until empty line (CRLF CRLF).
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd < 0) break
    const headersRaw = body.slice(cursor, headerEnd).toString('utf-8')
    const dataStart = headerEnd + 4

    // Locate next boundary (data ends with CRLF preceding "--boundary").
    const nextBoundary = body.indexOf(dashBoundary, dataStart)
    if (nextBoundary < 0) break
    // Strip the trailing CRLF that precedes the boundary marker.
    let dataEnd = nextBoundary
    if (body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) dataEnd -= 2

    const data = body.slice(dataStart, dataEnd)

    // Parse Content-Disposition + Content-Type from headers.
    let field = ''
    let filename = ''
    let mimeType = 'application/octet-stream'
    for (const line of headersRaw.split('\r\n')) {
      const lower = line.toLowerCase()
      if (lower.startsWith('content-disposition:')) {
        const nameMatch = line.match(/name="([^"]+)"/i)
        const fileMatch = line.match(/filename="([^"]*)"/i)
        if (nameMatch) field = nameMatch[1]
        if (fileMatch) filename = fileMatch[1]
      } else if (lower.startsWith('content-type:')) {
        mimeType = line.slice('content-type:'.length).trim()
      }
    }

    if (filename) {
      files.push({ field, filename, mimeType, data })
    }
    offset = nextBoundary
    void crlf
  }
  return files
}

export async function runChatTurn(params: {
  threadId: string
  channel: string
  message: string
  overrideToken?: string
  onEvent?: (event: string, data: unknown) => void
  assistantMetadata?: Record<string, unknown>
}): Promise<string> {
  const { threadId, channel, message, overrideToken, onEvent, assistantMetadata } = params
  const sb = getSupabaseClient()
  const trustMode = getCurrentMode()

  // Load recent conversation history (last 20 messages)
  let messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  if (sb) {
    const { data: history } = await sb
      .from('atlas_conversations')
      .select('role, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(20)
    messages = (history ?? []).reverse().map(m => ({
      role: m.role === 'atlas' ? ('assistant' as const) : ('user' as const),
      content: m.content as string,
    }))
  }

  // Ensure the current message is appended if not already persisted
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== message) {
    messages.push({ role: 'user', content: message })
  }

  // ─── Intent-detection hint (advisory, no LLM call) ────────────────────────
  // Runs BEFORE Claude — if a high-confidence pattern matches, we append a hidden
  // user-role message guiding the LLM toward the relevant tool. The LLM remains free
  // to ignore it.
  const intent = detectIntent(message)
  if (intent && intent.confidence >= 0.75) {
    onEvent?.('intent_hint', { tool: intent.tool, reason: intent.reason, confidence: intent.confidence, matched: intent.matched })
    messages.push({ role: 'user', content: buildIntentHint(intent) })
  }

  let totalCostUsd = 0
  let assistantText = ''
  let iteration = 0

  while (iteration < 8) {
    iteration++
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: getSystemPrompt(),
      tools: TOOL_DEFINITIONS as Parameters<typeof anthropic.messages.create>[0]['tools'],
      messages: messages as Parameters<typeof anthropic.messages.create>[0]['messages'],
    })

    const inputCost = (response.usage.input_tokens / 1_000_000) * 3
    const outputCost = (response.usage.output_tokens / 1_000_000) * 15
    totalCostUsd += inputCost + outputCost

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    for (const block of textBlocks) {
      onEvent?.('message', { role: 'atlas', content: block.text })
      assistantText += block.text
    }

    if (toolUseBlocks.length === 0) {
      break
    }

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const toolUse of toolUseBlocks) {
      const toolName = toolUse.name.replace('_', '.') as ToolName
      onEvent?.('tool_call', { tool: toolName, arguments: toolUse.input })

      // Inject thread_id for spec-authorship tools so they can persist pending-spec rows
      // (preserved insertion order: phase, goal, then thread_id at the end).
      let toolArgs = toolUse.input as Record<string, unknown>
      if (toolName === 'atlas.propose_and_queue' && !('thread_id' in toolArgs)) {
        toolArgs = { ...toolArgs, thread_id: threadId }
      }

      const dispatchResult = await dispatch({
        tool: toolName,
        arguments: toolArgs,
        initiatedBy: `${channel}:${threadId}`,
        trustMode,
        overrideToken,
      })

      onEvent?.('tool_result', { tool: toolName, ...dispatchResult })

      // Emit spec_drafted SSE for ChatPanel preview when an Atlas spec authorship tool
      // returns successfully with markdown content.
      if (
        (toolName === 'atlas.draft_spec' || toolName === 'atlas.propose_and_queue') &&
        dispatchResult.status !== 'failed' && dispatchResult.status !== 'blocked'
      ) {
        const r = dispatchResult.result as {
          filename?: string
          markdown?: string
          spec_markdown?: string
          action?: string
          validation?: { ok: boolean; missing: string[] }
          cost_usd?: number
          queue?: { sha: string; queue_position: number; queue_size: number }
          review_verdict?: string
        } | null
        if (r) {
          onEvent?.('spec_drafted', {
            tool: toolName,
            filename: r.filename ?? null,
            markdown: r.markdown ?? r.spec_markdown ?? '',
            action: r.action ?? 'drafted',
            validation: r.validation ?? null,
            cost_usd: r.cost_usd ?? null,
            queue: r.queue ?? null,
            review_verdict: r.review_verdict ?? null,
          })
        }
      }

      if (dispatchResult.verified) {
        onEvent?.('tool_verified', {
          tool: toolName,
          dispatchId: dispatchResult.dispatchId,
          verified: dispatchResult.verified.verified,
          evidence: dispatchResult.verified.evidence,
          error: dispatchResult.verified.error ?? null,
        })
      }

      // Build the content the LLM sees. For write tools, embed verification status so the model
      // is forced to surface it (honesty rules 5 + 10).
      const llmPayload: Record<string, unknown> = {
        status: dispatchResult.status,
        result: dispatchResult.result ?? null,
        error: dispatchResult.error ?? null,
      }
      if (dispatchResult.verified) {
        llmPayload.verification = {
          verified: dispatchResult.verified.verified,
          evidence: dispatchResult.verified.evidence,
          error: dispatchResult.verified.error ?? null,
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(llmPayload),
      })
    }

    messages.push({ role: 'assistant', content: response.content as unknown })
    messages.push({ role: 'user', content: toolResults as unknown })
  }

  if (assistantText && sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: threadId,
      channel,
      role: 'atlas',
      content: assistantText,
      metadata: { totalCostUsd, iterations: iteration, ...(assistantMetadata ?? {}) },
    })
  }

  return assistantText
}

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return

  const body = await readBody(req)
  let payload: { thread_id: string; channel: string; message: string }
  try {
    payload = JSON.parse(body)
  } catch {
    json(res, 400, { error: 'Invalid JSON' })
    return
  }

  if (!payload.thread_id || !payload.message) {
    json(res, 400, { error: 'thread_id and message are required' })
    return
  }

  const sb = getSupabaseClient()
  if (sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: payload.thread_id,
      channel: payload.channel || 'web',
      role: 'user',
      content: payload.message,
    })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const overrideToken = req.headers['x-budget-override'] as string | undefined

  try {
    const assistantText = await runChatTurn({
      threadId: payload.thread_id,
      channel: payload.channel || 'web',
      message: payload.message,
      overrideToken,
      onEvent: sendEvent,
    })

    sendEvent('done', { thread_id: payload.thread_id })
    res.end()

    void assistantText // already persisted inside runChatTurn
  } catch (err) {
    sendEvent('error', { error: err instanceof Error ? err.message : String(err) })
    res.end()
  }
}

// Public URL Atlas presents to Twilio for the inbound webhook. Used to compute
// the expected HMAC for signature validation; if not set we skip validation
// (e.g. local dev without a public tunnel).
const TWILIO_INBOUND_PUBLIC_URL = process.env.TWILIO_INBOUND_PUBLIC_URL ?? ''
const TWILIO_VALIDATE_SIGNATURE = process.env.TWILIO_VALIDATE_SIGNATURE !== 'false'

const VOICE_TOGGLE_DISABLE = /^\s*disable\s+voice\s*$/i
const VOICE_TOGGLE_ENABLE = /^\s*enable\s+voice\s*$/i

async function handleWhatsAppInbound(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  const params = new URLSearchParams(body)

  const from = params.get('From')
  const messageBody = params.get('Body') ?? ''
  const messageSid = params.get('MessageSid')
  const numMedia = parseInt(params.get('NumMedia') ?? '0', 10)
  const mediaUrl0 = params.get('MediaUrl0') ?? undefined
  const mediaType0 = params.get('MediaContentType0') ?? undefined

  // Either a non-empty body OR at least one media attachment is required.
  if (!from || (!messageBody && numMedia === 0)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Missing From, Body, or media')
    return
  }

  // Validate Twilio signature when configured. Reject unsigned webhooks unless
  // explicitly disabled (set TWILIO_VALIDATE_SIGNATURE=false for local dev).
  if (TWILIO_VALIDATE_SIGNATURE && TWILIO_INBOUND_PUBLIC_URL) {
    const sigHeader = (req.headers['x-twilio-signature'] as string | undefined) ?? null
    const formMap: Record<string, string> = {}
    for (const [k, v] of params.entries()) formMap[k] = v
    const ok = validateTwilioSignature({
      expectedUrl: TWILIO_INBOUND_PUBLIC_URL,
      formParams: formMap,
      signatureHeader: sigHeader,
    })
    if (!ok) {
      console.warn('[whatsapp-inbound] signature validation FAILED — rejecting')
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('signature_invalid')
      return
    }
  }

  // Acknowledge to Twilio immediately (within 10s SLA)
  res.writeHead(200, { 'Content-Type': 'text/xml' })
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')

  // Process async — don't block the webhook
  processWhatsAppMessage({
    from,
    body: messageBody,
    messageSid,
    numMedia,
    mediaUrl0,
    mediaType0,
  }).catch(err =>
    console.error('[whatsapp-inbound] processing error:', err),
  )
}

interface VoicePrefs {
  voice_replies_enabled: boolean
  preferred_voice_id: string | null
}

async function getVoicePrefs(phone: string): Promise<VoicePrefs> {
  const sb = getSupabaseClient()
  if (!sb) return { voice_replies_enabled: true, preferred_voice_id: null }
  const { data } = await sb
    .from('atlas_user_prefs')
    .select('voice_replies_enabled, preferred_voice_id')
    .eq('user_phone', phone)
    .maybeSingle()
  if (!data) return { voice_replies_enabled: true, preferred_voice_id: null }
  return {
    voice_replies_enabled: Boolean((data as { voice_replies_enabled: boolean }).voice_replies_enabled),
    preferred_voice_id: (data as { preferred_voice_id: string | null }).preferred_voice_id,
  }
}

async function setVoicePrefs(phone: string, enabled: boolean): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb.from('atlas_user_prefs').upsert(
    { user_phone: phone, voice_replies_enabled: enabled, updated_at: new Date().toISOString() },
    { onConflict: 'user_phone' },
  )
}

interface ProcessParams {
  from: string
  body: string
  messageSid: string | null
  numMedia: number
  mediaUrl0?: string
  mediaType0?: string
}

// Single-user system (Phase 1.10aj): collapse all channels onto one thread so
// the user's phone WhatsApp, the open web tab, and live mode all share one
// timeline. This is what the Realtime subscription on the dashboard listens
// to — change here also requires updating the channel filter in the browser.
const ATLAS_SINGLE_THREAD_ID = 'web-default'

async function processWhatsAppMessage(params: ProcessParams): Promise<void> {
  const { from, body, messageSid, numMedia, mediaUrl0, mediaType0 } = params
  const threadId = ATLAS_SINGLE_THREAD_ID
  const sb = getSupabaseClient()
  const fromPhone = from.replace('whatsapp:', '')

  let inboundText = body
  let isVoiceNote = false
  let inboundAudioSeconds = 0
  const userMetadata: Record<string, unknown> = { from, messageSid }

  // ─── Voice-note inbound path ──────────────────────────────────────────────
  // Download immediately (Twilio media URLs expire ~24 h, but we never persist
  // the URL — we only use it once to fetch the bytes for Whisper). The audio
  // buffer itself is held only in memory for the duration of transcription.
  if (numMedia > 0 && mediaUrl0 && mediaType0?.toLowerCase().startsWith('audio/')) {
    isVoiceNote = true
    try {
      const dl = await downloadTwilioMedia(mediaUrl0)
      inboundAudioSeconds = estimateAudioSeconds(dl.buffer.length)
      const mime = dl.contentType.split(';')[0].trim() || mediaType0
      const filename = mime.includes('ogg') ? 'voice.ogg' : 'voice.mp3'
      const result = await transcribe(dl.buffer, mime, filename)
      inboundText = result.text.trim()
      userMetadata.voice_note = true
      userMetadata.audio_mime = mime
      userMetadata.audio_seconds = inboundAudioSeconds
      userMetadata.transcribe_latency_ms = result.durationMs
      // Cost log for Whisper (the inbound side of this voice turn).
      void recordWhisperSttCost(inboundAudioSeconds, {
        bytes: dl.buffer.length,
        mime_type: mime,
        channel: 'whatsapp',
        from_phone: fromPhone,
      })
    } catch (err) {
      console.error('[whatsapp-inbound] voice transcription failed:', err)
      // Inform the user so they're not left hanging.
      const msg = 'Sorry — I could not transcribe that voice note. Could you try again, or send it as text?'
      await sendWhatsAppReply(from, msg)
      if (sb) {
        await sb.from('atlas_conversations').insert({
          thread_id: threadId,
          channel: 'whatsapp',
          role: 'user',
          content: '[voice note: transcription failed]',
          metadata: { ...userMetadata, voice_note: true, transcription_error: err instanceof Error ? err.message : String(err) },
        })
      }
      return
    }

    if (!inboundText) {
      // Empty transcript — likely silent audio. Tell the user.
      await sendWhatsAppReply(from, 'I got the voice note but the audio came through empty. Could you re-send?')
      return
    }
  }

  // ─── Voice opt-in toggle (text only) ──────────────────────────────────────
  if (!isVoiceNote && VOICE_TOGGLE_DISABLE.test(inboundText)) {
    await setVoicePrefs(fromPhone, false)
    await sendWhatsAppReply(from, 'Voice replies disabled. Send "enable voice" to turn them back on.')
    if (sb) {
      await sb.from('atlas_conversations').insert({
        thread_id: threadId,
        channel: 'whatsapp',
        role: 'user',
        content: inboundText,
        metadata: { ...userMetadata, command: 'disable_voice' },
      })
    }
    return
  }
  if (!isVoiceNote && VOICE_TOGGLE_ENABLE.test(inboundText)) {
    await setVoicePrefs(fromPhone, true)
    await sendWhatsAppReply(from, 'Voice replies enabled. Send "disable voice" to turn them off.')
    if (sb) {
      await sb.from('atlas_conversations').insert({
        thread_id: threadId,
        channel: 'whatsapp',
        role: 'user',
        content: inboundText,
        metadata: { ...userMetadata, command: 'enable_voice' },
      })
    }
    return
  }

  if (sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: threadId,
      channel: 'whatsapp',
      role: 'user',
      content: inboundText,
      metadata: userMetadata,
    })
  }

  // Run the chat turn — emits the assistant row with combined metadata.
  const assistantMetadata: Record<string, unknown> = { from_voice_note: isVoiceNote }
  const assistantText = await runChatTurn({
    threadId,
    channel: 'whatsapp',
    message: inboundText,
    assistantMetadata,
  })

  await sendAtlasReply({
    toWhatsApp: from,
    threadId,
    replyText: assistantText,
    triggeredByVoiceNote: isVoiceNote,
  })
}

// Sends the reply back to the user. Always sends a text body; additionally
// generates an ElevenLabs voice note when the user has voice replies enabled
// and the ElevenLabs monthly budget gate has not been tripped.
async function sendAtlasReply(params: {
  toWhatsApp: string
  threadId: string
  replyText: string
  triggeredByVoiceNote: boolean
}): Promise<void> {
  const { toWhatsApp, threadId, replyText, triggeredByVoiceNote } = params
  const fromPhone = toWhatsApp.replace('whatsapp:', '')
  if (!replyText) return

  // 1. Always send text first so the user gets *something* even if voice fails.
  const textResult = await sendWhatsAppReply(toWhatsApp, replyText)
  if ('error' in textResult) {
    console.error('[whatsapp-inbound] reply failed:', textResult.error)
    return
  }
  console.log(`[whatsapp-inbound] replied with sid=${textResult.sid}`)

  // 2. Determine whether to also send a voice note.
  const prefs = await getVoicePrefs(fromPhone)
  if (!prefs.voice_replies_enabled) {
    console.log(`[whatsapp-inbound] voice replies disabled for ${fromPhone}`)
    return
  }

  // Budget gate — skip TTS if monthly ElevenLabs spend is past the cap.
  const monthSpend = await getMonthlyProviderSpendUsd('elevenlabs')
  const projected = monthSpend + estimateTtsCostUsd(Math.min(replyText.length, VOICE_NOTE_MAX_CHARS))
  if (monthSpend >= ELEVENLABS_BUDGET_GATE_USD || projected >= ELEVENLABS_BUDGET_GATE_USD) {
    console.warn(
      `[whatsapp-inbound] skipping voice reply — elevenlabs month_to_date=${monthSpend.toFixed(2)} gate=${ELEVENLABS_BUDGET_GATE_USD}`,
    )
    return
  }

  try {
    const voiceId = prefs.preferred_voice_id || VOICE_DEFAULT
    const tts = await generateVoiceNote(replyText, voiceId)

    // Defense in depth: hard-truncate by bytes too. ElevenLabs Turbo at 32 kHz mono
    // is well under the 2 MB ceiling for 1500 chars, but we still bail out rather
    // than send a malformed payload to Twilio.
    if (tts.audio.length === 0 || tts.audio.length > VOICE_OUT_MAX_BYTES) {
      console.warn(`[whatsapp-inbound] voice audio out of bounds (${tts.audio.length}); skipping`)
      return
    }

    const messageId = randomUUID()
    const upload = await uploadVoiceNote({ audio: tts.audio, threadId, messageId })

    const mediaResult = await sendWhatsAppMedia(toWhatsApp, upload.signedUrl)
    if ('error' in mediaResult) {
      console.error('[whatsapp-inbound] voice media send failed:', mediaResult.error)
      return
    }
    console.log(`[whatsapp-inbound] voice note sent sid=${mediaResult.sid} bytes=${tts.audio.length}`)

    // Cost log for the outbound TTS leg.
    void recordElevenLabsTtsCost(tts.charCount, voiceId, {
      transport: 'whatsapp_voice_note',
      truncated: tts.truncated,
      thread_id: threadId,
      message_id: messageId,
      triggered_by_voice_note: triggeredByVoiceNote,
    })

    // Annotate the assistant row so we can audit which turns produced voice.
    const sb = getSupabaseClient()
    if (sb) {
      const { data: latest } = await sb
        .from('atlas_conversations')
        .select('id, metadata')
        .eq('thread_id', threadId)
        .eq('role', 'atlas')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest) {
        const merged = {
          ...((latest as { metadata: Record<string, unknown> }).metadata ?? {}),
          has_voice_reply: true,
          voice_id: voiceId,
          voice_truncated: tts.truncated,
          voice_message_sid: mediaResult.sid,
          voice_storage_path: upload.path,
          voice_bytes: tts.audio.length,
        }
        await sb
          .from('atlas_conversations')
          .update({ metadata: merged })
          .eq('id', (latest as { id: string }).id)
      }
    }
  } catch (err) {
    console.error('[whatsapp-inbound] voice reply error:', err)
  }
}

async function handleTtsVoices(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return
  try {
    const voices = await listVoices()
    const summary = voices.map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category ?? null,
      labels: v.labels ?? null,
      preview_url: v.preview_url ?? null,
    }))
    json(res, 200, { voices: summary })
  } catch (err) {
    json(res, 502, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleTts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return

  const body = await readBody(req)
  let payload: { text?: string; voice_id?: string }
  try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }

  const rawText = (payload.text ?? '').trim()
  if (!rawText) { json(res, 400, { error: 'text is required' }); return }
  const voiceId = payload.voice_id || VOICE_DEFAULT

  const text = truncateForTts(rawText)
  const charCount = text.length

  // Budget gate: 90% of $100 cap default. If month-to-date elevenlabs spend
  // already exceeds the gate, refuse before calling the API.
  const monthSpend = await getMonthlyProviderSpendUsd('elevenlabs')
  const projected = monthSpend + estimateTtsCostUsd(charCount)
  if (monthSpend >= ELEVENLABS_BUDGET_GATE_USD || projected >= ELEVENLABS_BUDGET_GATE_USD) {
    json(res, 429, {
      error: 'budget_exceeded',
      message: 'TTS disabled — monthly cap approaching.',
      month_to_date_usd: monthSpend,
      gate_usd: ELEVENLABS_BUDGET_GATE_USD,
    })
    return
  }

  let upstream: Response
  try {
    upstream = await streamTts(text, voiceId)
  } catch (err) {
    json(res, 502, { error: err instanceof Error ? err.message : String(err) })
    return
  }

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => '')
    json(res, upstream.status || 502, {
      error: 'elevenlabs_upstream_error',
      status: upstream.status,
      detail: errBody.slice(0, 500),
    })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-store',
    'X-Atlas-Tts-Chars': String(charCount),
    'X-Atlas-Tts-Voice': voiceId,
  })

  // Stream upstream audio chunks straight to the client.
  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    console.error('[atlas-tts] stream error:', err)
    try { res.end() } catch { /* ignore */ }
  }

  // Log cost after the stream finishes (don't block the response).
  void recordElevenLabsTtsCost(charCount, voiceId, { truncated: rawText.length > text.length })
}

async function handleStt(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return

  const contentType = req.headers['content-type'] ?? ''
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundaryMatch) {
    json(res, 400, { error: 'Content-Type must be multipart/form-data' })
    return
  }
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2] ?? '').trim()
  if (!boundary) { json(res, 400, { error: 'Missing multipart boundary' }); return }

  // Budget gate: if month-to-date OpenAI spend already at or near the cap, refuse.
  const monthSpend = await getMonthlyProviderSpendUsd('openai')
  if (monthSpend >= OPENAI_BUDGET_GATE_USD) {
    json(res, 429, {
      error: 'budget_exceeded',
      message: 'STT disabled — monthly OpenAI cap approaching.',
      month_to_date_usd: monthSpend,
      gate_usd: OPENAI_BUDGET_GATE_USD,
    })
    return
  }

  let body: Buffer
  try {
    body = await readBodyBuffer(req, WHISPER_MAX_BYTES)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'payload_too_large') {
      json(res, 413, { error: 'audio_too_large', max_bytes: WHISPER_MAX_BYTES })
      return
    }
    json(res, 400, { error: 'failed_to_read_body', detail: msg })
    return
  }

  const files = parseMultipart(body, boundary)
  const audioFile = files.find(f => f.field === 'audio') ?? files[0]
  if (!audioFile) { json(res, 400, { error: 'No audio file in request' }); return }

  const mimeBase = audioFile.mimeType.split(';')[0].trim().toLowerCase()
  const accepted = ACCEPTED_MIME_TYPES.some(t => t.split(';')[0] === mimeBase)
  if (!accepted) {
    json(res, 415, { error: 'unsupported_audio_type', mime_type: audioFile.mimeType, accepted: ACCEPTED_MIME_TYPES })
    return
  }

  let result: { text: string; durationMs: number }
  try {
    result = await transcribe(audioFile.data, audioFile.mimeType, audioFile.filename || 'audio.webm')
  } catch (err) {
    json(res, 502, { error: 'whisper_failed', detail: err instanceof Error ? err.message : String(err) })
    return
  }

  const audioSeconds = estimateAudioSeconds(audioFile.data.length)
  const costUsd = estimateWhisperCostUsd(audioSeconds)

  json(res, 200, {
    transcript: result.text,
    duration_ms: result.durationMs,
    audio_seconds: audioSeconds,
    cost_usd: costUsd,
  })

  // Log cost after responding; never block the client on the cost-log write.
  void recordWhisperSttCost(audioSeconds, {
    bytes: audioFile.data.length,
    mime_type: audioFile.mimeType,
    transcribe_latency_ms: result.durationMs,
  })
}

// ─── Live-mode TTS WebSocket bridge ────────────────────────────────────────
// Browser opens its own WS to `/atlas/tts-ws` (Bearer token in Sec-WebSocket-Protocol);
// this handler opens an upstream WS to ElevenLabs `stream-input`, pipes text → audio
// chunks back to the dashboard, and tracks character count for cost logging.
async function authenticateWs(req: IncomingMessage): Promise<{ ok: boolean; protocol?: string }> {
  // Browsers can't set a Bearer header on a WebSocket; clients pass the token via
  // Sec-WebSocket-Protocol as `bearer.<token>` (echoed back as the chosen subprotocol).
  const proto = req.headers['sec-websocket-protocol']
  const offers = (Array.isArray(proto) ? proto.join(',') : (proto ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const o of offers) {
    if (!o.startsWith('bearer.')) continue
    const token = o.slice('bearer.'.length)
    if (!token) continue
    // Service bearer for Builder / cron callers.
    if (ATLAS_API_TOKEN && token === ATLAS_API_TOKEN) {
      return { ok: true, protocol: o }
    }
    // User session token issued by /atlas/auth/verify-otp.
    const session = await findSessionByToken(token)
    if (session) {
      touchSessionLastSeen(session.id).catch(() => {})
      return { ok: true, protocol: o }
    }
  }
  return { ok: false }
}

interface DownstreamMessage {
  type: 'open' | 'text' | 'flush' | 'close'
  voiceId?: string
  text?: string
}

function attachTtsWebSocket(server: ReturnType<typeof createServer>): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/atlas/tts-ws') {
      socket.destroy()
      return
    }
    void (async () => {
      const auth = await authenticateWs(req)
      if (!auth.ok) {
        try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n') } catch { /* ignore */ }
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, auth.protocol)
      })
    })()
  })

  wss.on('connection', (ws: WsWebSocket, _req: IncomingMessage, protocol?: string) => {
    void _req
    void protocol
    let upstream: WsWebSocket | null = null
    let voiceId: string = VOICE_DEFAULT
    let charCount = 0
    let upstreamOpened = false
    let upstreamReady = false
    const pendingText: string[] = []
    let pendingFlush = false
    let closed = false

    const cleanup = () => {
      if (closed) return
      closed = true
      try { upstream?.close() } catch { /* ignore */ }
      upstream = null
      // Log cost (one row per WS session) — never block on this.
      if (charCount > 0) {
        void recordElevenLabsTtsCost(charCount, voiceId, { transport: 'ws_stream', live_mode: true })
      }
    }

    const safeSend = (data: string | Buffer) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(data) } catch { /* ignore */ }
      }
    }

    const sendError = (error: string, detail?: string) => {
      safeSend(JSON.stringify({ type: 'error', error, detail }))
    }

    const flushPending = () => {
      if (!upstream || !upstreamReady) return
      while (pendingText.length > 0) {
        const text = pendingText.shift()!
        try {
          upstream.send(JSON.stringify({ text, try_trigger_generation: true }))
        } catch (err) {
          sendError('upstream_send_failed', err instanceof Error ? err.message : String(err))
        }
      }
      if (pendingFlush) {
        pendingFlush = false
        try { upstream.send(JSON.stringify({ text: '' })) } catch { /* ignore */ }
      }
    }

    const openUpstream = (vid: string) => {
      if (upstreamOpened) return
      upstreamOpened = true
      voiceId = vid || VOICE_DEFAULT

      const apiKey = getElevenLabsApiKey()
      if (!apiKey) {
        sendError('elevenlabs_not_configured', 'ELEVENLABS_API_KEY missing on server')
        try { ws.close(1011) } catch { /* ignore */ }
        return
      }

      try {
        upstream = new WsWebSocket(buildElevenLabsStreamInputUrl(voiceId), {
          headers: { 'xi-api-key': apiKey },
        })
      } catch (err) {
        sendError('upstream_open_failed', err instanceof Error ? err.message : String(err))
        try { ws.close(1011) } catch { /* ignore */ }
        return
      }

      upstream.on('open', () => {
        upstreamReady = true
        // ElevenLabs requires an initial empty `text: " "` to prime generation.
        try {
          upstream?.send(JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            xi_api_key: apiKey,
          }))
        } catch { /* ignore */ }
        safeSend(JSON.stringify({ type: 'ready', voice_id: voiceId }))
        flushPending()
      })

      upstream.on('message', (raw) => {
        // ElevenLabs returns JSON text frames containing { audio: <base64>, isFinal, normalizedAlignment }.
        // Forward verbatim to the browser; the browser decodes base64 → Web Audio.
        try {
          const txt = typeof raw === 'string' ? raw : raw.toString('utf-8')
          safeSend(txt)
        } catch (err) {
          sendError('forward_failed', err instanceof Error ? err.message : String(err))
        }
      })

      upstream.on('close', () => {
        safeSend(JSON.stringify({ type: 'upstream_closed' }))
      })

      upstream.on('error', (err) => {
        sendError('upstream_error', err instanceof Error ? err.message : String(err))
      })
    }

    ws.on('message', async (raw) => {
      let msg: DownstreamMessage
      try {
        msg = JSON.parse(raw.toString()) as DownstreamMessage
      } catch {
        sendError('invalid_json')
        return
      }

      if (msg.type === 'open') {
        // Budget gate before opening upstream — refuse if monthly TTS spend already past cap.
        const monthSpend = await getMonthlyProviderSpendUsd('elevenlabs')
        if (monthSpend >= ELEVENLABS_BUDGET_GATE_USD) {
          safeSend(JSON.stringify({
            type: 'budget_exceeded',
            month_to_date_usd: monthSpend,
            gate_usd: ELEVENLABS_BUDGET_GATE_USD,
          }))
          try { ws.close(1011) } catch { /* ignore */ }
          return
        }
        openUpstream(msg.voiceId ?? VOICE_DEFAULT)
        return
      }

      if (msg.type === 'text') {
        const t = (msg.text ?? '').toString()
        if (!t) return
        charCount += t.length
        pendingText.push(t)
        flushPending()
        return
      }

      if (msg.type === 'flush') {
        pendingFlush = true
        flushPending()
        return
      }

      if (msg.type === 'close') {
        cleanup()
        try { ws.close(1000) } catch { /* ignore */ }
        return
      }
    })

    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })
}

export async function startServer(): Promise<void> {
  validateEnv()
  await loadTrustModeFromDb()

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    // ─── CORS — allow browser clients (Atlas dashboard at github.io) to reach this API
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With')
    res.setHeader('Access-Control-Max-Age', '86400')
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (url === '/health' && method === 'GET') {
      json(res, 200, {
        status: 'ok',
        service: 'cropsintel-atlas',
        version: '0.1.0',
        trust_mode: getCurrentMode(),
        ts: new Date().toISOString(),
      })
      return
    }

    // ─── Auth endpoints (Phase 1.10aj) ──────────────────────────────────────
    // Public: /atlas/auth/request-otp, /atlas/auth/verify-otp.
    // Auth required: logout, me, sessions, sessions/:id/revoke.

    if (url === '/atlas/auth/request-otp' && method === 'POST') {
      const body = await readBody(req)
      let payload: { phone?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      const phone = (payload.phone ?? '').trim()
      if (!phone) { json(res, 400, { error: 'phone required' }); return }
      // Allowlist: never allow OTP requests for anything outside the configured list.
      if (!isPhoneAllowed(phone)) {
        json(res, 403, { error: 'phone_not_allowed' })
        return
      }
      // Rate limit BEFORE generating + sending so floods don't burn Twilio cost.
      const recent = await countRecentOtpRequests(phone)
      if (recent >= OTP_RATE_LIMIT_MAX) {
        json(res, 429, { error: 'rate_limited', retry_after_sec: 15 * 60 })
        return
      }
      const code = generateOtpCode()
      const inserted = await insertOtp(phone, code)
      if (!inserted) {
        json(res, 503, { error: 'otp_persist_failed' })
        return
      }
      const sent = await sendOtpViaWhatsApp(phone, code)
      if (!sent) {
        // Don't leak that the row was created — but we must respond honestly.
        json(res, 502, { error: 'whatsapp_send_failed' })
        return
      }
      json(res, 200, { ok: true, expires_in: OTP_TTL_SECONDS })
      return
    }

    if (url === '/atlas/auth/verify-otp' && method === 'POST') {
      const body = await readBody(req)
      let payload: { phone?: string; code?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      const phone = (payload.phone ?? '').trim()
      const code = (payload.code ?? '').trim()
      if (!phone || !code) { json(res, 400, { error: 'phone and code required' }); return }
      if (!isPhoneAllowed(phone)) { json(res, 401, { error: 'invalid_credentials' }); return }

      const otp = await findActiveOtp(phone)
      if (!otp) { json(res, 401, { error: 'invalid_credentials' }); return }

      // Attempt cap — burn ALL outstanding OTPs for this phone so the attacker
      // can't grind on any of the rows they may have stacked up.
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        await burnAllOtpsForPhone(phone)
        json(res, 401, { error: 'too_many_attempts' })
        return
      }

      const matches = await compareOtp(code, otp.code_hash)
      if (!matches) {
        await incrementOtpAttempts(otp.id, otp.attempts)
        json(res, 401, { error: 'invalid_credentials' })
        return
      }

      // Mark this OTP used + mint a session.
      await markOtpUsed(otp.id)
      // Defense-in-depth: also burn any other unused codes for this phone so a
      // recently issued spare can't be used to mint a second session silently.
      await burnAllOtpsForPhone(phone)

      const userAgent = (req.headers['user-agent'] as string | undefined) ?? null
      const fwd = (req.headers['x-forwarded-for'] as string | undefined)
        ?? (req.socket?.remoteAddress ?? '')
      const ip = (typeof fwd === 'string' ? fwd.split(',')[0] : '').trim() || null

      const session = await createSession({
        phone,
        userAgent: userAgent ?? undefined,
        ip: ip ?? undefined,
      })
      if (!session) { json(res, 503, { error: 'session_persist_failed' }); return }

      json(res, 200, { ok: true, token: session.token, session_id: session.sessionId })
      return
    }

    if (url === '/atlas/auth/logout' && method === 'POST') {
      const principal = await authenticate(req)
      if (!principal || principal.sessionId === 'service') {
        // Service callers don't have a real session to revoke. Return 401 so
        // the dashboard treats it as a failed logout and clears local state.
        json(res, 401, { error: 'Unauthorized' })
        return
      }
      await revokeSession(principal.sessionId)
      json(res, 200, { ok: true })
      return
    }

    if (url === '/atlas/auth/me' && method === 'GET') {
      const principal = await authenticate(req)
      if (!principal) { json(res, 401, { error: 'Unauthorized' }); return }
      // Service callers — return a stub so internal probes can still introspect.
      if (principal.sessionId === 'service') {
        json(res, 200, {
          phone: 'service',
          session_id: 'service',
          device_label: 'service',
          created_at: null,
          last_seen_at: null,
        })
        return
      }
      // Look the session row back up to surface device_label / timestamps to the UI.
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
      const { data } = await sb
        .from('atlas_sessions')
        .select('id, phone, device_label, created_at, last_seen_at')
        .eq('id', principal.sessionId)
        .maybeSingle()
      if (!data) { json(res, 401, { error: 'Unauthorized' }); return }
      const row = data as {
        id: string
        phone: string
        device_label: string | null
        created_at: string
        last_seen_at: string
      }
      json(res, 200, {
        phone: row.phone,
        session_id: row.id,
        device_label: row.device_label,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
      })
      return
    }

    if (url === '/atlas/auth/sessions' && method === 'GET') {
      const principal = await authenticate(req)
      if (!principal) { json(res, 401, { error: 'Unauthorized' }); return }
      if (principal.sessionId === 'service') { json(res, 200, { sessions: [] }); return }
      const rows = await listSessionsForPhone(principal.phone)
      json(res, 200, {
        sessions: rows.map((r) => ({
          id: r.id,
          device_label: r.device_label,
          user_agent: r.user_agent,
          created_at: r.created_at,
          last_seen_at: r.last_seen_at,
          current: r.id === principal.sessionId,
        })),
      })
      return
    }

    {
      const revokeMatch = url.match(/^\/atlas\/auth\/sessions\/([0-9a-f-]{36})\/revoke$/i)
      if (revokeMatch && method === 'POST') {
        const principal = await authenticate(req)
        if (!principal) { json(res, 401, { error: 'Unauthorized' }); return }
        if (principal.sessionId === 'service') { json(res, 403, { error: 'forbidden' }); return }
        // Authorize: only sessions belonging to the same phone may be revoked.
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const targetId = revokeMatch[1]
        const { data } = await sb
          .from('atlas_sessions')
          .select('id, phone')
          .eq('id', targetId)
          .maybeSingle()
        if (!data || (data as { phone: string }).phone !== principal.phone) {
          json(res, 404, { error: 'not_found' })
          return
        }
        await revokeSession(targetId)
        json(res, 200, { ok: true, id: targetId })
        return
      }
    }

    if (url === '/atlas/mode' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      json(res, 200, getModeMetadata())
      return
    }

    // GET /atlas/conversations/<threadId>?limit=N — chat history for the thread.
    // Returns the most recent N messages in chronological order so the UI can
    // re-hydrate the chat after a page refresh.
    if (method === 'GET' && url.startsWith('/atlas/conversations/')) {
      if (!(await requireAuth(req, res))) return
      const parsed = new URL(url, 'http://_')
      const threadId = decodeURIComponent(parsed.pathname.replace('/atlas/conversations/', ''))
      if (!threadId) { json(res, 400, { error: 'threadId required' }); return }
      const limitRaw = parsed.searchParams.get('limit')
      const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 200)
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, []); return }
      const { data, error } = await sb
        .from('atlas_conversations')
        .select('id, role, content, metadata, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) {
        json(res, 500, { error: `history query failed: ${error.message ?? JSON.stringify(error)}` })
        return
      }
      const rows = (data ?? []).reverse().map(r => ({
        id: r.id as string,
        role: r.role === 'atlas' ? 'assistant' : (r.role as 'user' | 'assistant'),
        content: r.content as string,
        metadata: r.metadata as Record<string, unknown> | undefined,
        created_at: r.created_at as string,
      }))
      json(res, 200, rows)
      return
    }

    if (url === '/atlas/mode' && method === 'POST') {
      if (!(await requireAuth(req, res))) return
      const body = await readBody(req)
      let payload: { mode: TrustMode; setBy?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      try {
        await setMode(payload.mode, payload.setBy ?? 'api')
        json(res, 200, { ok: true, ...getModeMetadata(), success: true })
      } catch (err) {
        // Distinguish bad-input (400) from persist-failure (500) so callers can
        // tell whether to retry. Validation errors come from setMode's known
        // "Invalid trust mode: …" path; everything else is a real server-side
        // failure (DB persist failure, missing client) and MUST surface as 500
        // — otherwise the dashboard sees 200 and the mode silently reverts on
        // next service restart (the bug spec 1.10y was filed to fix and 1.10af
        // re-asserted with the {ok:false,error} response contract).
        const msg = err instanceof Error ? err.message : String(err)
        const isValidationError = msg.startsWith('Invalid trust mode:')
        json(res, isValidationError ? 400 : 500, { ok: false, error: msg })
      }
      return
    }

    if (url === '/atlas/chat' && method === 'POST') {
      await handleChat(req, res)
      return
    }

    if (url === '/atlas/tts' && method === 'POST') {
      await handleTts(req, res)
      return
    }

    if (url === '/atlas/tts/voices' && method === 'GET') {
      await handleTtsVoices(req, res)
      return
    }

    if (url === '/atlas/stt' && method === 'POST') {
      await handleStt(req, res)
      return
    }

    if (url === '/atlas/costs' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      json(res, 200, await getBurnRate())
      return
    }

    if (url === '/atlas/status' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sbStatus = getSupabaseClient()
      if (!sbStatus) { json(res, 503, { error: 'Supabase not configured' }); return }
      const { data } = await sbStatus.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(1).maybeSingle()
      json(res, 200, data ?? { error: 'No snapshot yet — try again in 5 minutes' })
      return
    }

    if (url === '/atlas/artifacts/pending-specs' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { specs: [] }); return }
      const { data, error } = await sb
        .from('atlas_pending_specs')
        .select('id, thread_id, spec_markdown, filename, drafted_at, expires_at')
        .is('resolved_at', null)
        .order('drafted_at', { ascending: false })
        .limit(20)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { specs: data ?? [] })
      return
    }

    if (url === '/atlas/artifacts/design-audits' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { audits: [] }); return }
      const { data, error } = await sb
        .from('designer_runs')
        .select('id, task_id, operation, verdict, confidence, gaps, cost_usd, duration_ms, created_at')
        .eq('verdict', 'fail')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { audits: data ?? [] })
      return
    }

    if (url === '/atlas/artifacts/open-forks' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { forks: [] }); return }
      // "Open" = decisions awaiting a human pick. Schema requires chosen_option NOT NULL,
      // so the fork-author writes the literal string 'PENDING' until a human resolves it.
      // We additionally include rows where chosen_option IS NULL for forward-compat.
      const { data, error } = await sb
        .from('atlas_decisions')
        .select('id, decided_at, fork_question, options_considered, rationale, related_phase, chosen_option')
        .or('chosen_option.is.null,chosen_option.eq.PENDING')
        .order('decided_at', { ascending: false })
        .limit(20)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { forks: data ?? [] })
      return
    }

    // Match /atlas/artifacts/forks/<uuid>/decide
    {
      const decideMatch = url.match(/^\/atlas\/artifacts\/forks\/([0-9a-f-]{36})\/decide$/i)
      if (decideMatch && method === 'POST') {
        if (!(await requireAuth(req, res))) return
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const id = decideMatch[1]
        const body = await readBody(req)
        let payload: { chosen?: string; rationale?: string }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (!payload.chosen || typeof payload.chosen !== 'string') {
          json(res, 400, { error: '`chosen` is required' })
          return
        }
        const { error } = await sb
          .from('atlas_decisions')
          .update({
            chosen_option: payload.chosen,
            rationale: payload.rationale ?? null,
            decided_by: 'user',
            decided_at: new Date().toISOString(),
          })
          .eq('id', id)
        if (error) { json(res, 500, { error: error.message }); return }
        json(res, 200, { ok: true, id, chosen: payload.chosen })
        return
      }
    }

    // Match /atlas/decisions/<uuid>/approve  (legacy Approve-ADR wizard)
    {
      const approveMatch = url.match(/^\/atlas\/decisions\/([0-9a-f-]{36})\/approve$/i)
      if (approveMatch && method === 'POST') {
        if (!(await requireAuth(req, res))) return
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const id = approveMatch[1]
        const { error } = await sb
          .from('atlas_decisions')
          .update({
            chosen_option: 'APPROVED',
            decided_by: 'user',
            decided_at: new Date().toISOString(),
          })
          .eq('id', id)
        if (error) { json(res, 500, { error: error.message }); return }
        json(res, 200, { ok: true, id })
        return
      }
    }

    if (url === '/whatsapp/inbound' && method === 'POST') {
      await handleWhatsAppInbound(req, res)
      return
    }

    if (!(await requireAuth(req, res))) return

    json(res, 404, { error: 'Not found' })
  })

  attachTtsWebSocket(server)

  startSnapshotCron()
  startConductorLoop()

  server.listen(PORT, () => {
    console.log(`[atlas-server] Listening on :${PORT}`)
  })
}
