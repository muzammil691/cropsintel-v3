// Atlas API client — wraps all HTTP calls to the Atlas Railway service.
// SECURITY NOTE: VITE_ATLAS_API_TOKEN is baked into the client bundle.
// This is acceptable for single-user v0.1 (Muzammil only). Replace with a
// Supabase Auth-gated proxy in a follow-up task. See .agent/questions/phase-1.10k-q.md.

const ATLAS_URL =
  import.meta.env.VITE_ATLAS_URL ??
  'https://courteous-simplicity-production.up.railway.app'
const ATLAS_TOKEN = import.meta.env.VITE_ATLAS_API_TOKEN as string | undefined

function authHeaders(): Record<string, string> {
  return ATLAS_TOKEN ? { Authorization: `Bearer ${ATLAS_TOKEN}` } : {}
}

// Centralized JSON fetch — never returns non-OK garbage as parsed JSON,
// never throws SyntaxError on a 4xx HTML body. Callers can rely on the
// returned promise either resolving with parsed JSON or rejecting with
// a useful Error.
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
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
