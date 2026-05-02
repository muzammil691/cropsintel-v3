// Atlas API client — wraps all HTTP calls to the Atlas Railway service.
//
// Phase 1.10aj: tokens live in localStorage under ATLAS_SESSION_TOKEN_KEY and
// are issued by /atlas/auth/verify-otp after a WhatsApp OTP login. We no
// longer read VITE_ATLAS_API_TOKEN — that value used to be baked into the
// GitHub Pages bundle and was extractable by anyone viewing source.

const ATLAS_URL =
  import.meta.env.VITE_ATLAS_URL ??
  'https://courteous-simplicity-production.up.railway.app'

export const ATLAS_SESSION_TOKEN_KEY = 'atlas_session_token'

export class AtlasUnauthorizedError extends Error {
  status = 401
  constructor(message = 'Atlas session is unauthorized') {
    super(message)
    this.name = 'AtlasUnauthorizedError'
  }
}

function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ATLAS_SESSION_TOKEN_KEY)
}

function authHeaders(): Record<string, string> {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Centralized JSON fetch — never returns non-OK garbage as parsed JSON,
// never throws SyntaxError on a 4xx HTML body. Callers can rely on the
// returned promise either resolving with parsed JSON or rejecting with
// a useful Error.
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (res.status === 401) {
    const body = await res.text().catch(() => '')
    throw new AtlasUnauthorizedError(`${init?.method ?? 'GET'} ${url} → 401${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const text = await res.text()
  if (!text) return undefined as unknown as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${url} returned non-JSON body: ${text.slice(0, 200)}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Auth (Phase 1.10aj) — WhatsApp OTP issued by Atlas server.
// Login flow: requestAtlasOtp(phone) → user receives WhatsApp code →
//             verifyAtlasOtp(phone, code) → token persisted to localStorage.
// AtlasAuthGuard validates the token on mount via fetchAtlasMe().
// ──────────────────────────────────────────────────────────────────────────

export type AtlasRole = 'owner' | 'admin' | 'operator' | 'viewer'

export interface AtlasMe {
  phone: string
  session_id: string
  device_label: string | null
  role: AtlasRole
  member_id: string | null
  display_name: string | null
  created_at: string | null
  last_seen_at: string | null
}

export interface AtlasSession {
  id: string
  device_label: string | null
  user_agent: string | null
  created_at: string
  last_seen_at: string
  current: boolean
}

export async function requestAtlasOtp(phone: string): Promise<{ ok: true; expires_in: number }> {
  return fetchJson<{ ok: true; expires_in: number }>(`${ATLAS_URL}/atlas/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
}

export async function verifyAtlasOtp(
  phone: string,
  code: string,
): Promise<{ ok: true; token: string; session_id: string }> {
  return fetchJson<{ ok: true; token: string; session_id: string }>(
    `${ATLAS_URL}/atlas/auth/verify-otp`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    },
  )
}

export async function fetchAtlasMe(): Promise<AtlasMe> {
  return fetchJson<AtlasMe>(`${ATLAS_URL}/atlas/auth/me`, {
    headers: authHeaders(),
  })
}

export async function logoutAtlas(): Promise<void> {
  try {
    await fetchJson<{ ok: true }>(`${ATLAS_URL}/atlas/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
    })
  } catch {
    // Even if the server call fails, we still clear local state.
  }
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(ATLAS_SESSION_TOKEN_KEY)
  }
}

export async function fetchAtlasSessions(): Promise<AtlasSession[]> {
  const data = await fetchJson<{ sessions?: AtlasSession[] }>(
    `${ATLAS_URL}/atlas/auth/sessions`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.sessions) ? data!.sessions! : []
}

export async function revokeAtlasSession(id: string): Promise<void> {
  await fetchJson<{ ok: true; id: string }>(
    `${ATLAS_URL}/atlas/auth/sessions/${encodeURIComponent(id)}/revoke`,
    {
      method: 'POST',
      headers: authHeaders(),
    },
  )
}

export type TrustMode = 'passive' | 'chat' | 'confirm' | 'auto' | 'stopped'

export interface Fork {
  id: string
  title: string
  description: string
  options?: string[]
  created_at: string
}

export interface RecentShip {
  id: string
  type: 'commit' | 'verifier_run'
  summary: string
  verdict?: 'pass' | 'fail' | 'skip'
  sha?: string
  created_at: string
}

export interface VerifierPoint {
  t: string
  pass: number
  fail: number
}

export interface AtlasStatus {
  trust_mode: TrustMode
  current_phase: string
  queued: number
  in_flight: number
  done_24h: number
  failed_24h: number
  memory_chunk_count: number
  verifier_pass_rate: number
  verifier_history: VerifierPoint[]
  forks: Fork[]
  recent_ships: RecentShip[]
}

export interface AtlasCosts {
  today: number
  month_to_date: number
  budget: number
}

export interface AtlasDecision {
  id: string
  title: string
  description: string
  created_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'atlas'
  content: string
  tool_calls?: ToolCallChip[]
  created_at: string
  // Phase 1.10am — attachments uploaded with this message (echoed back from
  // metadata.attachments for rendering thumbnails / cards in the bubble).
  attachments?: ChatAttachment[]
  // Audio metadata for messages that originated from voice (live mode or STT).
  audio?: {
    user?: { storage_path: string; signed_url: string; mime: string; bytes: number } | null
    atlas?: { storage_path: string; signed_url: string; mime: string; bytes: number } | null
  }
}

export interface ToolCallChip {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
}

export async function fetchStatus(): Promise<AtlasStatus> {
  return fetchJson<AtlasStatus>(`${ATLAS_URL}/atlas/status`, {
    headers: authHeaders(),
  })
}

export async function fetchCosts(): Promise<AtlasCosts> {
  return fetchJson<AtlasCosts>(`${ATLAS_URL}/atlas/costs`, {
    headers: authHeaders(),
  })
}

export async function fetchMode(): Promise<{ mode: TrustMode }> {
  return fetchJson<{ mode: TrustMode }>(`${ATLAS_URL}/atlas/mode`, {
    headers: authHeaders(),
  })
}

export async function setMode(mode: TrustMode): Promise<{ mode: TrustMode }> {
  return fetchJson<{ mode: TrustMode }>(`${ATLAS_URL}/atlas/mode`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, setBy: 'web-ui' }),
  })
}

export async function fetchPendingDecisions(): Promise<AtlasDecision[]> {
  const data = await fetchJson<AtlasDecision[] | { decisions?: AtlasDecision[] }>(
    `${ATLAS_URL}/atlas/decisions?status=pending`,
    { headers: authHeaders() },
  )
  if (Array.isArray(data)) return data
  if (data && Array.isArray((data as { decisions?: AtlasDecision[] }).decisions)) {
    return (data as { decisions: AtlasDecision[] }).decisions
  }
  return []
}

export async function approveDecision(id: string): Promise<void> {
  const res = await fetch(`${ATLAS_URL}/atlas/decisions/${id}/approve`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`approve ${id} → ${res.status}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Artifact panel (1.10w): pending specs, design audits, open forks
// ──────────────────────────────────────────────────────────────────────────

export interface PendingSpec {
  id: string
  thread_id: string
  spec_markdown: string
  filename: string
  drafted_at: string
  expires_at: string
}

export interface DesignAuditGap {
  check?: string
  severity?: 'high' | 'medium' | 'low' | string
  description?: string
  fix?: string
  file?: string
  line?: number | string
}

export interface DesignAudit {
  id: string
  task_id: string
  operation: 'review-spec' | 'audit-commit' | string
  verdict: 'pass' | 'fail' | 'unknown' | string
  confidence: number | null
  gaps: DesignAuditGap[]
  cost_usd: number
  duration_ms: number | null
  created_at: string
}

export interface OpenFork {
  id: string
  decided_at: string
  fork_question: string
  options_considered: Record<string, unknown> | unknown[] | null
  rationale: string | null
  related_phase: string | null
  chosen_option: string | null
}

export async function fetchPendingSpecs(): Promise<PendingSpec[]> {
  const data = await fetchJson<{ specs?: PendingSpec[] }>(
    `${ATLAS_URL}/atlas/artifacts/pending-specs`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.specs) ? data!.specs! : []
}

export async function fetchDesignAudits(): Promise<DesignAudit[]> {
  const data = await fetchJson<{ audits?: DesignAudit[] }>(
    `${ATLAS_URL}/atlas/artifacts/design-audits`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.audits) ? data!.audits! : []
}

export async function fetchOpenForks(): Promise<OpenFork[]> {
  const data = await fetchJson<{ forks?: OpenFork[] }>(
    `${ATLAS_URL}/atlas/artifacts/open-forks`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.forks) ? data!.forks! : []
}

export async function decideFork(
  id: string,
  chosen: string,
  rationale?: string,
): Promise<void> {
  await fetchJson<{ ok: true; id: string; chosen: string }>(
    `${ATLAS_URL}/atlas/artifacts/forks/${encodeURIComponent(id)}/decide`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ chosen, rationale }),
    },
  )
}

export async function fetchChatHistory(
  threadId: string,
  limit = 50,
): Promise<ChatMessage[]> {
  const data = await fetchJson<ChatMessage[] | { messages?: ChatMessage[] }>(
    `${ATLAS_URL}/atlas/conversations/${threadId}?limit=${limit}`,
    { headers: authHeaders() },
  )
  if (Array.isArray(data)) return data
  if (data && Array.isArray((data as { messages?: ChatMessage[] }).messages)) {
    return (data as { messages: ChatMessage[] }).messages
  }
  return []
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 1.10ar — chat summaries timeline
// ──────────────────────────────────────────────────────────────────────────

export interface ChatSummary {
  id: string
  range_start_at: string
  range_end_at: string
  range_start_msg_id: string
  range_end_msg_id: string
  message_count: number
  summary_short: string
  topics: string[]
  created_at: string
}

export async function fetchChatSummaries(
  threadId: string,
  limit = 30,
): Promise<ChatSummary[]> {
  const data = await fetchJson<{ summaries?: ChatSummary[] }>(
    `${ATLAS_URL}/atlas/conversations/${encodeURIComponent(threadId)}/summaries?limit=${limit}`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.summaries) ? data!.summaries! : []
}

export interface TtsVoice {
  voice_id: string
  name: string
  category?: string | null
  labels?: Record<string, string> | null
  preview_url?: string | null
}

export async function fetchVoices(): Promise<TtsVoice[]> {
  const data = await fetchJson<{ voices?: TtsVoice[] }>(`${ATLAS_URL}/atlas/tts/voices`, {
    headers: authHeaders(),
  })
  return Array.isArray(data?.voices) ? data!.voices! : []
}

export interface TtsResult {
  ok: true
  blob: Blob
  charCount: number
  voiceId: string
}

export interface TtsError {
  ok: false
  status: number
  error: string
  budgetExceeded: boolean
  message?: string
}

export async function streamTts(text: string, voiceId: string): Promise<TtsResult | TtsError> {
  const res = await fetch(`${ATLAS_URL}/atlas/tts`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voiceId }),
  })
  if (!res.ok) {
    let parsed: { error?: string; message?: string } = {}
    try { parsed = await res.json() as { error?: string; message?: string } } catch { /* ignore */ }
    return {
      ok: false,
      status: res.status,
      error: parsed.error ?? `HTTP ${res.status}`,
      budgetExceeded: res.status === 429 && parsed.error === 'budget_exceeded',
      message: parsed.message,
    }
  }
  const charCount = Number(res.headers.get('X-Atlas-Tts-Chars') ?? text.length)
  const usedVoice = res.headers.get('X-Atlas-Tts-Voice') ?? voiceId
  const blob = await res.blob()
  return { ok: true, blob, charCount, voiceId: usedVoice }
}

export interface SttResult {
  ok: true
  transcript: string
  durationMs: number
  audioSeconds: number
  costUsd: number
}

export interface SttError {
  ok: false
  status: number
  error: string
  budgetExceeded: boolean
  message?: string
}

// Upload an audio blob to /atlas/stt and return the Whisper transcript.
// Never throws — returns a discriminated union so callers can render errors inline.
export async function uploadStt(blob: Blob): Promise<SttResult | SttError> {
  const fd = new FormData()
  const filename = blob.type.includes('mp4') ? 'audio.mp4'
    : blob.type.includes('wav') ? 'audio.wav'
    : 'audio.webm'
  fd.append('audio', blob, filename)

  let res: Response
  try {
    res = await fetch(`${ATLAS_URL}/atlas/stt`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    })
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      budgetExceeded: false,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  if (!res.ok) {
    let parsed: { error?: string; message?: string } = {}
    try { parsed = await res.json() as { error?: string; message?: string } } catch { /* ignore */ }
    return {
      ok: false,
      status: res.status,
      error: parsed.error ?? `HTTP ${res.status}`,
      budgetExceeded: res.status === 429 && parsed.error === 'budget_exceeded',
      message: parsed.message,
    }
  }

  const data = await res.json() as {
    transcript?: string
    duration_ms?: number
    audio_seconds?: number
    cost_usd?: number
  }
  return {
    ok: true,
    transcript: data.transcript ?? '',
    durationMs: data.duration_ms ?? 0,
    audioSeconds: data.audio_seconds ?? 0,
    costUsd: data.cost_usd ?? 0,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Live-mode TTS WebSocket (1.10u). Browser opens a WS to Atlas; Atlas opens
// upstream WS to ElevenLabs and pipes JSON frames back. Messages:
//   client → server: { type: 'open', voiceId } | { type: 'text', text } | { type: 'flush' } | { type: 'close' }
//   server → client: { type: 'ready' } | { type: 'budget_exceeded' } | { type: 'error', error, detail? }
//                  | ElevenLabs raw JSON frame { audio: <base64>, isFinal?, alignment? }
//                  | { type: 'upstream_closed' }
// ──────────────────────────────────────────────────────────────────────────

export interface ElevenLabsAudioFrame {
  audio?: string | null
  isFinal?: boolean
  normalizedAlignment?: unknown
  alignment?: unknown
}

export type TtsWsEvent =
  | { kind: 'ready'; voiceId: string }
  | { kind: 'audio'; base64: string; isFinal: boolean }
  | { kind: 'budget_exceeded'; monthToDateUsd: number; gateUsd: number }
  | { kind: 'error'; error: string; detail?: string }
  | { kind: 'closed' }
  | { kind: 'heartbeat'; t: number }
  | { kind: 'turn_end'; reason: 'user-finished' | 'atlas-finished' | 'silence-timeout' }

export interface TtsWsHandle {
  sendText: (text: string) => void
  flush: () => void
  thinkingStart: () => void
  thinkingEnd: () => void
  close: () => void
  readonly state: 'connecting' | 'open' | 'closed'
}

export function openTtsWs(
  voiceId: string,
  onEvent: (e: TtsWsEvent) => void,
): TtsWsHandle {
  const wsUrl = ATLAS_URL.replace(/^http/, 'ws') + '/atlas/tts-ws'
  // Token is passed via Sec-WebSocket-Protocol — server validates `bearer.<token>` and echoes back.
  const sessionToken = getSessionToken()
  const protocols = sessionToken ? [`bearer.${sessionToken}`] : undefined
  let state: 'connecting' | 'open' | 'closed' = 'connecting'
  let ws: WebSocket
  try {
    ws = new WebSocket(wsUrl, protocols)
  } catch (err) {
    state = 'closed'
    onEvent({ kind: 'error', error: 'ws_construct_failed', detail: err instanceof Error ? err.message : String(err) })
    onEvent({ kind: 'closed' })
    return {
      sendText: () => { /* noop */ },
      flush: () => { /* noop */ },
      thinkingStart: () => { /* noop */ },
      thinkingEnd: () => { /* noop */ },
      close: () => { /* noop */ },
      get state() { return state },
    }
  }

  const queued: Array<{ type: string; text?: string; voiceId?: string }> = [
    { type: 'open', voiceId },
  ]
  const flushQueued = () => {
    if (ws.readyState !== ws.OPEN) return
    while (queued.length > 0) {
      ws.send(JSON.stringify(queued.shift()))
    }
  }

  ws.onopen = () => {
    state = 'open'
    flushQueued()
  }

  ws.onmessage = (ev) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const o = parsed as Record<string, unknown>
    const type = typeof o.type === 'string' ? o.type : null

    if (type === 'ready') {
      onEvent({ kind: 'ready', voiceId: typeof o.voice_id === 'string' ? o.voice_id : voiceId })
      return
    }
    if (type === 'budget_exceeded') {
      onEvent({
        kind: 'budget_exceeded',
        monthToDateUsd: Number(o.month_to_date_usd ?? 0),
        gateUsd: Number(o.gate_usd ?? 0),
      })
      return
    }
    if (type === 'error') {
      onEvent({
        kind: 'error',
        error: typeof o.error === 'string' ? o.error : 'unknown_error',
        detail: typeof o.detail === 'string' ? o.detail : undefined,
      })
      return
    }
    if (type === 'upstream_closed') {
      // Stream ended cleanly — surface but don't treat as error.
      return
    }
    if (type === 'heartbeat') {
      // Server-side keep-alive — reply with an ack so a future "client missed
      // 3 heartbeats" check on the server has actionable signal, then surface
      // the event to consumers that may want to render a small ping indicator.
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat-ack' }))
        }
      } catch { /* ignore */ }
      onEvent({ kind: 'heartbeat', t: typeof o.t === 'number' ? o.t : Date.now() })
      return
    }
    if (type === 'turn-end') {
      const reasonRaw = typeof o.reason === 'string' ? o.reason : 'atlas-finished'
      const reason: 'user-finished' | 'atlas-finished' | 'silence-timeout' =
        reasonRaw === 'user-finished' || reasonRaw === 'silence-timeout'
          ? reasonRaw
          : 'atlas-finished'
      onEvent({ kind: 'turn_end', reason })
      return
    }

    // Otherwise expect an ElevenLabs audio frame: { audio, isFinal? }
    const frame = parsed as ElevenLabsAudioFrame
    if (typeof frame.audio === 'string' && frame.audio.length > 0) {
      onEvent({ kind: 'audio', base64: frame.audio, isFinal: !!frame.isFinal })
    } else if (frame.isFinal) {
      onEvent({ kind: 'audio', base64: '', isFinal: true })
    }
  }

  ws.onerror = () => {
    onEvent({ kind: 'error', error: 'ws_error' })
  }
  ws.onclose = () => {
    state = 'closed'
    onEvent({ kind: 'closed' })
  }

  return {
    sendText: (text: string) => {
      if (!text) return
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'text', text }))
      } else {
        queued.push({ type: 'text', text })
      }
    },
    flush: () => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'flush' }))
      } else {
        queued.push({ type: 'flush' })
      }
    },
    thinkingStart: () => {
      // Tells the server "Atlas's LLM is thinking; if no text arrives soon,
      // stream a filler so the user doesn't hear silence."
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'thinking-start' })) } catch { /* ignore */ }
      } else {
        queued.push({ type: 'thinking-start' })
      }
    },
    thinkingEnd: () => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'thinking-end' })) } catch { /* ignore */ }
      } else {
        queued.push({ type: 'thinking-end' })
      }
    },
    close: () => {
      try {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'close' }))
      } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
    },
    get state() { return state },
  }
}

// Phase 1.10am — attachment record returned by /atlas/chat/upload and echoed
// back on /atlas/chat as `attachments`. Mirrors AttachmentPreview's
// AttachmentRecord — kept in this file so server callers don't need to import
// from a UI module.
export interface ChatAttachment {
  id: string
  name: string
  size: number
  mime: string
  storage_path: string
  signed_url: string
  signed_url_expires_at: string
}

export interface UploadAttachmentsResult {
  ok: true
  attachments: ChatAttachment[]
  thread_id: string
  message_id: string
}

export interface UploadAttachmentsError {
  ok: false
  status: number
  error: string
  filename?: string
  detail?: string
}

export async function uploadChatAttachments(
  files: File[],
  threadId = 'web-default',
): Promise<UploadAttachmentsResult | UploadAttachmentsError> {
  if (files.length === 0) {
    return { ok: false, status: 400, error: 'no_files' }
  }
  const fd = new FormData()
  fd.append('thread_id', threadId)
  for (const f of files) fd.append('file', f, f.name)
  let res: Response
  try {
    res = await fetch(`${ATLAS_URL}/atlas/chat/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    })
  } catch (err) {
    return { ok: false, status: 0, error: 'network_error', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    let parsed: { error?: string; filename?: string; detail?: string; max_bytes?: number; mime?: string } = {}
    try { parsed = await res.json() as typeof parsed } catch { /* ignore */ }
    return {
      ok: false,
      status: res.status,
      error: parsed.error ?? `HTTP ${res.status}`,
      filename: parsed.filename,
      detail: parsed.detail ?? (parsed.max_bytes ? `max ${parsed.max_bytes} bytes` : parsed.mime),
    }
  }
  const data = await res.json() as UploadAttachmentsResult
  return data
}

export interface UrlPreview {
  ok: true
  url: string
  host: string
  title: string | null
  description: string | null
  image: string | null
  site_name: string | null
}

export async function fetchUrlPreview(url: string): Promise<UrlPreview | null> {
  try {
    const res = await fetch(`${ATLAS_URL}/atlas/chat/preview-url?url=${encodeURIComponent(url)}`, {
      headers: authHeaders(),
    })
    if (!res.ok) return null
    const data = await res.json() as UrlPreview
    return data
  } catch {
    return null
  }
}

// SSE chat — returns a cleanup function that aborts the stream.
export function streamChat(
  threadId: string,
  message: string,
  onEvent: (event: string, data: unknown) => void,
  options?: {
    attachments?: ChatAttachment[]
    // Phase 1.10ar — when the user clicks a timeline chip the cockpit
    // forwards the summary of that segment as context for the NEXT message.
    replayContext?: { rangeStartAt?: string; summaryLong?: string } | null
  },
): () => void {
  const controller = new AbortController()

  fetch(`${ATLAS_URL}/atlas/chat`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      thread_id: threadId,
      channel: 'web',
      message,
      attachments: options?.attachments ?? [],
      replay_context: options?.replayContext ?? null,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const body = res.body ? await res.text().catch(() => '') : ''
        onEvent('error', {
          error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        let currentEvent = 'message'
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              onEvent(currentEvent, JSON.parse(line.slice(6)))
            } catch {
              // ignore malformed SSE data
            }
          }
        }
      }
      onEvent('done', {})
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onEvent('error', { error: String(err) })
    })

  return () => controller.abort()
}

// ──────────────────────────────────────────────────────────────────────────
// Team management (Phase 1.10ao)
// ──────────────────────────────────────────────────────────────────────────

export interface AtlasTeamMember {
  id: string
  phone: string
  display_name: string | null
  role: AtlasRole
  status: 'active' | 'suspended' | 'revoked'
  invited_by: string | null
  invited_at: string
  first_login_at: string | null
  last_seen_at: string | null
  notes: string | null
  active_session_count: number
  created_at: string
  updated_at: string
}

export interface AtlasTeamInvite {
  id: string
  phone: string
  role: 'admin' | 'operator' | 'viewer'
  display_name: string | null
  invited_by: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface AtlasTeamAuditEntry {
  id: string
  actor_id: string | null
  actor_phone: string | null
  action: string
  target_member_id: string | null
  target_invite_id: string | null
  target_phone: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export async function fetchTeamMembers(): Promise<AtlasTeamMember[]> {
  const data = await fetchJson<{ members?: AtlasTeamMember[] }>(
    `${ATLAS_URL}/atlas/team/members`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.members) ? data!.members! : []
}

export async function fetchTeamInvites(): Promise<AtlasTeamInvite[]> {
  const data = await fetchJson<{ invites?: AtlasTeamInvite[] }>(
    `${ATLAS_URL}/atlas/team/invites`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.invites) ? data!.invites! : []
}

export interface CreateInviteResponse {
  ok: true
  invite: {
    id: string
    phone: string
    role: 'admin' | 'operator' | 'viewer'
    display_name: string | null
    expires_at: string
    created_at: string
  }
  is_new: boolean
  whatsapp_sent: boolean
}

export async function createTeamInvite(params: {
  phone: string
  role: 'admin' | 'operator' | 'viewer'
  display_name?: string
}): Promise<CreateInviteResponse> {
  return fetchJson<CreateInviteResponse>(`${ATLAS_URL}/atlas/team/invite`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export async function revokeTeamInvite(id: string): Promise<void> {
  await fetchJson<{ ok: true; id: string }>(
    `${ATLAS_URL}/atlas/team/invites/${encodeURIComponent(id)}/revoke`,
    { method: 'POST', headers: authHeaders() },
  )
}

export async function updateTeamMember(
  id: string,
  patch: {
    role?: AtlasRole
    display_name?: string | null
    status?: 'active' | 'suspended' | 'revoked'
    notes?: string | null
  },
): Promise<{ ok: true; member: AtlasTeamMember; sessions_revoked: number }> {
  return fetchJson<{ ok: true; member: AtlasTeamMember; sessions_revoked: number }>(
    `${ATLAS_URL}/atlas/team/members/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
}

export async function revokeAllMemberSessions(
  id: string,
): Promise<{ ok: true; sessions_revoked: number }> {
  return fetchJson<{ ok: true; sessions_revoked: number }>(
    `${ATLAS_URL}/atlas/team/members/${encodeURIComponent(id)}/sessions/revoke-all`,
    { method: 'POST', headers: authHeaders() },
  )
}

export async function fetchTeamAuditLog(): Promise<AtlasTeamAuditEntry[]> {
  const data = await fetchJson<{ entries?: AtlasTeamAuditEntry[] }>(
    `${ATLAS_URL}/atlas/team/audit-log`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.entries) ? data!.entries! : []
}

export async function requestElevation(params: {
  tool: string
  required_role: AtlasRole
  context?: string
}): Promise<{ ok: true; whatsapp_sent: boolean }> {
  return fetchJson<{ ok: true; whatsapp_sent: boolean }>(
    `${ATLAS_URL}/atlas/team/request-elevation`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Plan + workflow authoring (Phase 1.10ak)
// ──────────────────────────────────────────────────────────────────────────

export interface PlanNode {
  id: string
  level: number
  title: string
  body: string
  children: PlanNode[]
  source: { line: number; raw: string }
}

export interface PlanResponse {
  updatedAt: string
  sha: string
  tree: PlanNode
  flat: PlanNode[]
}

export async function fetchPlan(): Promise<PlanResponse> {
  return fetchJson<PlanResponse>(`${ATLAS_URL}/atlas/plan`, { headers: authHeaders() })
}

export async function uploadPlan(markdown: string, message?: string): Promise<{ ok: true; sha: string; pushed: boolean }> {
  return fetchJson<{ ok: true; sha: string; pushed: boolean }>(`${ATLAS_URL}/atlas/plan/upload`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, message }),
  })
}

export async function amendPlan(instruction: string): Promise<{ ok: true; sha: string; pushed: boolean }> {
  return fetchJson<{ ok: true; sha: string; pushed: boolean }>(`${ATLAS_URL}/atlas/plan/amend`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  })
}

export async function reorderPlan(
  movedId: string,
  newParentId: string,
  newIndex: number,
): Promise<{ ok: true; sha: string }> {
  return fetchJson<{ ok: true; sha: string }>(`${ATLAS_URL}/atlas/plan/reorder`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ moved_id: movedId, new_parent_id: newParentId, new_index: newIndex }),
  })
}

export async function buildFromPlanNode(
  title: string,
  nodeBody: string,
  phaseHint: string,
): Promise<{ ok: true; filename: string; sha: string; pushed: boolean }> {
  return fetchJson<{ ok: true; filename: string; sha: string; pushed: boolean }>(
    `${ATLAS_URL}/atlas/plan/build`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, node_body: nodeBody, phase_hint: phaseHint }),
    },
  )
}

export interface WorkflowGraphNode {
  id: string
  type: 'workflow' | 'department' | 'operating_model'
  title: string
  description: string
  meta: Record<string, unknown>
}

export interface WorkflowGraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
}

export async function fetchWorkflowGraph(): Promise<WorkflowGraph> {
  return fetchJson<WorkflowGraph>(`${ATLAS_URL}/atlas/workflow/graph`, { headers: authHeaders() })
}

export interface RelatedSpecHit {
  filename: string
  status: 'queued' | 'done' | 'failed' | 'in-progress'
}

export async function fetchRelatedSpecs(query: string): Promise<RelatedSpecHit[]> {
  const data = await fetchJson<{ hits?: RelatedSpecHit[] }>(
    `${ATLAS_URL}/atlas/workflow/related-specs?q=${encodeURIComponent(query)}`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.hits) ? data!.hits! : []
}

// ──────────────────────────────────────────────────────────────────────────
// Audit feed (Phase 1.10ap) — verifier_runs + designer_runs activity stream
// ──────────────────────────────────────────────────────────────────────────

export interface VerifierRunRow {
  id: string
  task_id: string
  commit_sha: string | null
  mode: 'audit-only' | 'gate' | string
  passed: boolean
  gaps: Array<Record<string, unknown>>
  duration_ms: number | null
  ran_at: string
}

export interface DesignerRunRow {
  id: string
  task_id: string
  verdict: 'pass' | 'fail' | 'unknown' | string
  ai_judgment: Record<string, unknown> | null
  created_at: string
}

export async function fetchRecentVerifierRuns(limit = 50): Promise<VerifierRunRow[]> {
  const data = await fetchJson<{ runs?: VerifierRunRow[] }>(
    `${ATLAS_URL}/atlas/verifier/runs?limit=${limit}`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.runs) ? data!.runs! : []
}

export async function fetchRecentDesignerRuns(limit = 50): Promise<DesignerRunRow[]> {
  const data = await fetchJson<{ runs?: DesignerRunRow[] }>(
    `${ATLAS_URL}/atlas/designer/runs?limit=${limit}`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.runs) ? data!.runs! : []
}

// Phase 1.10as — Designer screenshots for the cockpit Preview tab.
export interface DesignerScreenshotRow {
  id: string
  task_id: string
  verdict: 'pass' | 'fail' | 'unknown' | string
  screenshot_url: string
  head_after: string | null
  created_at: string
}

export async function fetchRecentScreenshots(limit = 12): Promise<DesignerScreenshotRow[]> {
  const data = await fetchJson<{ screenshots?: DesignerScreenshotRow[] }>(
    `${ATLAS_URL}/atlas/designer/recent-screenshots?limit=${limit}`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.screenshots) ? data!.screenshots! : []
}

// ──────────────────────────────────────────────────────────────────────────
// Builder queue manager (Phase 1.10ap)
// ──────────────────────────────────────────────────────────────────────────

export interface BuilderQueueSpec {
  id: string
  filename: string
  priority: number
  depends_on: string[]
  blocked: boolean
  blocked_by: string[]
}

export interface BuilderInFlightSpec {
  id: string
  filename: string
  started_at: string | null
}

export interface BuilderQueueResponse {
  queued: BuilderQueueSpec[]
  in_flight: BuilderInFlightSpec[]
}

export async function fetchBuilderQueue(): Promise<BuilderQueueResponse> {
  const data = await fetchJson<BuilderQueueResponse>(`${ATLAS_URL}/atlas/builder/queue`, {
    headers: authHeaders(),
  })
  return {
    queued: Array.isArray(data?.queued) ? data.queued : [],
    in_flight: Array.isArray(data?.in_flight) ? data.in_flight : [],
  }
}

export async function setBuilderPriority(
  taskId: string,
  priority: number,
): Promise<{ ok: true; updated: boolean }> {
  return fetchJson<{ ok: true; updated: boolean }>(
    `${ATLAS_URL}/atlas/builder/queue/${encodeURIComponent(taskId)}/priority`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    },
  )
}

export async function cancelBuilderTask(taskId: string): Promise<{ ok: true }> {
  return fetchJson<{ ok: true }>(
    `${ATLAS_URL}/atlas/builder/queue/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST', headers: authHeaders() },
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Discussion queue (Phase 1.10ak)
// ──────────────────────────────────────────────────────────────────────────

export type ArtifactKind = 'design_audit' | 'open_fork' | 'pending_spec' | 'plan_node'

export interface DiscussionQueueItem {
  id: string
  artifact_kind: ArtifactKind
  artifact_ref: string
  context: Record<string, unknown>
  notes: string | null
  created_at: string
  resolved_at: string | null
  resolution: string | null
}

export interface MoveToDiscussionPayload {
  kind: ArtifactKind
  ref: string
  context?: Record<string, unknown>
  notes?: string
}

export async function moveArtifactsToDiscussion(
  items: MoveToDiscussionPayload[],
): Promise<{ ok: true; inserted: number }> {
  return fetchJson<{ ok: true; inserted: number }>(
    `${ATLAS_URL}/atlas/artifacts/move-to-discussion`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  )
}

export async function fetchDiscussionQueue(): Promise<DiscussionQueueItem[]> {
  const data = await fetchJson<{ items?: DiscussionQueueItem[] }>(
    `${ATLAS_URL}/atlas/artifacts/discussion-queue`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.items) ? data!.items! : []
}

export async function resolveDiscussion(
  id: string,
  resolution: 'queued' | 'dismissed' | 'forked',
): Promise<{ ok: true; id: string }> {
  return fetchJson<{ ok: true; id: string }>(
    `${ATLAS_URL}/atlas/artifacts/discussion/${encodeURIComponent(id)}/resolve`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    },
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Smart diagnosis (Phase 1.10al)
// ──────────────────────────────────────────────────────────────────────────

export type DiagnoseArtifactKind =
  | 'designer_audit'
  | 'verifier_run'
  | 'workflow_violation'
  | 'open_fork'
  | 'pending_spec'

export const KNOWN_DIAGNOSE_ACTION_IDS = [
  'mark-stub-intentional',
  'update-gemini-model',
  'update-anthropic-model',
  'flip-trust-mode',
  'rotate-api-key',
  'dismiss-as-waived',
] as const
export type KnownDiagnoseActionId = (typeof KNOWN_DIAGNOSE_ACTION_IDS)[number]

export type DiagnosisBucket =
  | { bucket: 'auto-remediate'; spec_filename: string; spec_body: string; reason: string }
  | { bucket: 'claude-code'; prompt: string; affected_files: string[]; reason: string }
  | {
      bucket: 'in-app-action'
      action_id: string
      label: string
      payload: Record<string, unknown>
      reason: string
    }
  | { bucket: 'discuss'; chat_seed: string; reason: string }

export async function diagnoseArtifact(input: {
  kind: DiagnoseArtifactKind
  ref: string
  payload: Record<string, unknown>
}): Promise<DiagnosisBucket> {
  return fetchJson<DiagnosisBucket>(`${ATLAS_URL}/atlas/artifacts/diagnose`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Batch diagnose + cascade + auto-fix lifecycle (Phase 1.10aq)
// ──────────────────────────────────────────────────────────────────────────

export interface BatchDiagnoseItem {
  kind: DiagnoseArtifactKind
  ref: string
  payload: Record<string, unknown>
}

export interface BatchAutoRemediateRow {
  kind: DiagnoseArtifactKind
  ref: string
  spec_filename: string
  spec_body: string
  reason: string
}

export interface BatchClaudeCodeRow {
  kind: DiagnoseArtifactKind
  ref: string
  task_id: string
  prompt: string
  affected_files: string[]
  reason: string
}

export interface BatchInAppRow {
  kind: DiagnoseArtifactKind
  ref: string
  action_id: string
  label: string
  payload: Record<string, unknown>
  reason: string
}

export interface BatchDiscussRow {
  kind: DiagnoseArtifactKind
  ref: string
  chat_seed: string
  reason: string
}

export interface BatchDiagnoseResult {
  results: Array<{ kind: DiagnoseArtifactKind; ref: string; bucket: DiagnosisBucket['bucket'] }>
  combined: {
    auto_remediate: BatchAutoRemediateRow[]
    claude_code:
      | { prompt: string; affected_files: string[]; items: BatchClaudeCodeRow[] }
      | null
    in_app: BatchInAppRow[]
    discuss: { seed: string; items: BatchDiscussRow[] } | null
  }
}

export async function diagnoseBatch(items: BatchDiagnoseItem[]): Promise<BatchDiagnoseResult> {
  return fetchJson<BatchDiagnoseResult>(`${ATLAS_URL}/atlas/artifacts/diagnose-batch`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
}

export type CascadeRelation =
  | { kind: 'introduced-here'; reason: 'first commit to touch this file' }
  | {
      kind: 'introduced-by-prior-fix'
      prior_sha: string
      prior_subject: string
      same_check: boolean
    }
  | { kind: 'pre-existing'; oldest_sha: string; days_old: number }
  | { kind: 'unknown' }

export async function fetchCascadeRelation(
  commitSha: string,
  gap: { check?: string; file?: string },
): Promise<CascadeRelation> {
  return fetchJson<CascadeRelation>(`${ATLAS_URL}/atlas/artifacts/cascade`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: commitSha, gap }),
  })
}

export interface AutoFixQueueResult {
  ok: true
  spec_filename: string
  path: string
  sha: string
  pushed: boolean
}

export async function autoFixQueue(input: {
  kind: DiagnoseArtifactKind
  ref: string
  payload: Record<string, unknown>
  spec_filename: string
  spec_body: string
}): Promise<AutoFixQueueResult> {
  return fetchJson<AutoFixQueueResult>(`${ATLAS_URL}/atlas/artifacts/auto-fix-queue`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export type DiagnosisLifecycleState =
  | 'pending-user'
  | 'auto-fix-queued'
  | 'auto-fix-shipped'
  | 'auto-fix-resolved'
  | 'auto-fix-failed'
  | 'escalated-cc'
  | 'dismissed'

export interface DiagnosisLifecycleRow {
  id: string
  artifact_kind: DiagnoseArtifactKind
  bucket: DiagnosisBucket['bucket']
  lifecycle_state: DiagnosisLifecycleState
  lifecycle_updated_at: string
  auto_fix_spec_filename: string | null
  auto_fix_commit_sha: string | null
  auto_fix_queued_at: string | null
  auto_fix_shipped_at: string | null
  auto_fix_resolved_at: string | null
  auto_fix_failure_reason: string | null
  task_id: string | null
  commit_sha: string | null
  result: DiagnosisBucket | null
  reason: string | null
  created_at: string
}

export async function fetchDiagnosisLifecycle(): Promise<DiagnosisLifecycleRow[]> {
  const data = await fetchJson<{ rows?: DiagnosisLifecycleRow[] }>(
    `${ATLAS_URL}/atlas/artifacts/diagnoses`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.rows) ? data!.rows! : []
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 1.10ax — agent heartbeats, log proxy, restart, force-pick
// ──────────────────────────────────────────────────────────────────────────

export type AgentName =
  | 'atlas' | 'builder' | 'verifier' | 'designer' | 'memory' | 'council' | 'adela'

export type AgentState =
  | 'idle' | 'starting' | 'running' | 'shipping' | 'verifying' | 'unreachable' | 'stale'

export interface AgentHeartbeat {
  agent: string
  state: AgentState
  task: string | null
  elapsed_s: number
  msg: string | null
  updated_at: string
}

export async function fetchAgentHeartbeats(): Promise<AgentHeartbeat[]> {
  const data = await fetchJson<{ heartbeats?: AgentHeartbeat[] }>(
    `${ATLAS_URL}/atlas/agents/heartbeats`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.heartbeats) ? data!.heartbeats! : []
}

export interface AgentLogLine {
  ts: string
  line: string
}

export async function fetchAgentLogs(agent: string, limit = 50): Promise<AgentLogLine[]> {
  const data = await fetchJson<{ lines?: AgentLogLine[] }>(
    `${ATLAS_URL}/atlas/agents/${encodeURIComponent(agent)}/logs?limit=${limit}`,
    { headers: authHeaders() },
  )
  return Array.isArray(data?.lines) ? data!.lines! : []
}

export async function restartAgent(agent: string): Promise<{ ok: true; agent: string }> {
  return fetchJson<{ ok: true; agent: string }>(
    `${ATLAS_URL}/atlas/agents/${encodeURIComponent(agent)}/restart`,
    { method: 'POST', headers: authHeaders() },
  )
}

export async function forcePickBuilder(): Promise<{ ok: true; intent: 'force-pick' }> {
  return fetchJson<{ ok: true; intent: 'force-pick' }>(
    `${ATLAS_URL}/atlas/agents/builder/force-pick`,
    { method: 'POST', headers: authHeaders() },
  )
}

