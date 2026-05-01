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

export interface AtlasMe {
  phone: string
  session_id: string
  device_label: string | null
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

export interface TtsWsHandle {
  sendText: (text: string) => void
  flush: () => void
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
    close: () => {
      try {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'close' }))
      } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
    },
    get state() { return state },
  }
}

// SSE chat — returns a cleanup function that aborts the stream.
export function streamChat(
  threadId: string,
  message: string,
  onEvent: (event: string, data: unknown) => void,
): () => void {
  const controller = new AbortController()

  fetch(`${ATLAS_URL}/atlas/chat`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId, channel: 'web', message }),
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
