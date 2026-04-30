import { createServer, IncomingMessage, ServerResponse } from 'http'
import Anthropic from '@anthropic-ai/sdk'
import { validateEnv } from './lib/env'
import { dispatch } from './lib/dispatch'
import { TOOLS, ToolName } from './lib/tools'
import { getSupabaseClient } from './lib/supabase'
import { getBurnRate } from './lib/cost-gate'
import { sendWhatsAppReply, phoneToThreadId } from './lib/twilio'
import { startSnapshotCron } from './cron/snapshot'
import { startConductorLoop } from './cron/conductor'
import { getCurrentMode, getModeMetadata, setMode, loadTrustModeFromDb } from './lib/trust-mode'
import { buildHonestyPrompt } from './lib/system-prompt'
import { detectIntent, buildIntentHint } from './lib/intent-detect'
import { streamTts, listVoices, truncateForTts, VOICE_DEFAULT, estimateTtsCostUsd } from './lib/elevenlabs'
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

function authenticate(req: IncomingMessage): boolean {
  if (!ATLAS_API_TOKEN) return true
  const auth = req.headers['authorization'] ?? ''
  return auth === `Bearer ${ATLAS_API_TOKEN}`
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
}): Promise<string> {
  const { threadId, channel, message, overrideToken, onEvent } = params
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
      metadata: { totalCostUsd, iterations: iteration },
    })
  }

  return assistantText
}

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticate(req)) {
    json(res, 401, { error: 'Unauthorized' })
    return
  }

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

async function handleWhatsAppInbound(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  const params = new URLSearchParams(body)

  const from = params.get('From')
  const messageBody = params.get('Body')
  const messageSid = params.get('MessageSid')

  if (!from || !messageBody) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Missing From or Body')
    return
  }

  // Acknowledge to Twilio immediately (within 10s SLA)
  res.writeHead(200, { 'Content-Type': 'text/xml' })
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')

  // Process async — don't block the webhook
  processWhatsAppMessage(from, messageBody, messageSid).catch(err =>
    console.error('[whatsapp-inbound] processing error:', err),
  )
}

async function processWhatsAppMessage(
  from: string,
  body: string,
  messageSid: string | null,
): Promise<void> {
  const threadId = phoneToThreadId(from)
  const sb = getSupabaseClient()

  if (sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: threadId,
      channel: 'whatsapp',
      role: 'user',
      content: body,
      metadata: { from, messageSid },
    })
  }

  const assistantText = await runChatTurn({ threadId, channel: 'whatsapp', message: body })

  const reply = await sendWhatsAppReply(from, assistantText)
  if ('error' in reply) {
    console.error('[whatsapp-inbound] reply failed:', reply.error)
  } else {
    console.log(`[whatsapp-inbound] replied with sid=${reply.sid}`)
  }
}

async function handleTtsVoices(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
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
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }

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
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }

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

    if (url === '/atlas/mode' && method === 'GET') {
      if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
      json(res, 200, getModeMetadata())
      return
    }

    if (url === '/atlas/mode' && method === 'POST') {
      if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
      const body = await readBody(req)
      let payload: { mode: TrustMode; setBy?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      try {
        await setMode(payload.mode, payload.setBy ?? 'api')
        json(res, 200, { ...getModeMetadata(), success: true })
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : String(err) })
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
      if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
      json(res, 200, await getBurnRate())
      return
    }

    if (url === '/atlas/status' && method === 'GET') {
      if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
      const sbStatus = getSupabaseClient()
      if (!sbStatus) { json(res, 503, { error: 'Supabase not configured' }); return }
      const { data } = await sbStatus.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(1).maybeSingle()
      json(res, 200, data ?? { error: 'No snapshot yet — try again in 5 minutes' })
      return
    }

    if (url === '/whatsapp/inbound' && method === 'POST') {
      await handleWhatsAppInbound(req, res)
      return
    }

    if (!authenticate(req)) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    json(res, 404, { error: 'Not found' })
  })

  startSnapshotCron()
  startConductorLoop()

  server.listen(PORT, () => {
    console.log(`[atlas-server] Listening on :${PORT}`)
  })
}
