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
  const res = await fetch(`${ATLAS_URL}/atlas/status`, {
    headers: authHeaders(),
  })
  return res.json()
}

export async function fetchCosts(): Promise<AtlasCosts> {
  const res = await fetch(`${ATLAS_URL}/atlas/costs`, {
    headers: authHeaders(),
  })
  return res.json()
}

export async function fetchMode(): Promise<{ mode: TrustMode }> {
  const res = await fetch(`${ATLAS_URL}/atlas/mode`, {
    headers: authHeaders(),
  })
  return res.json()
}

export async function setMode(mode: TrustMode): Promise<{ mode: TrustMode }> {
  const res = await fetch(`${ATLAS_URL}/atlas/mode`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, setBy: 'web-ui' }),
  })
  return res.json()
}

export async function fetchPendingDecisions(): Promise<AtlasDecision[]> {
  const res = await fetch(`${ATLAS_URL}/atlas/decisions?status=pending`, {
    headers: authHeaders(),
  })
  return res.json()
}

export async function approveDecision(id: string): Promise<void> {
  await fetch(`${ATLAS_URL}/atlas/decisions/${id}/approve`, {
    method: 'POST',
    headers: authHeaders(),
  })
}

export async function fetchChatHistory(
  threadId: string,
  limit = 50,
): Promise<ChatMessage[]> {
  const res = await fetch(
    `${ATLAS_URL}/atlas/conversations/${threadId}?limit=${limit}`,
    { headers: authHeaders() },
  )
  return res.json()
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
        onEvent('error', { error: `HTTP ${res.status}` })
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
