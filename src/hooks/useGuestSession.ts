// Phase 1.3b — Guest session hook for the landing page.
//
// Holds:
//   - the current guest_id (cookie + state)
//   - the deep_outputs_count + limit
//   - the conversation history (mirror of server-side state, for fast rendering)
//
// Trust model: server is authoritative. The client-side counter in this hook
// is for UI rendering only. Every send goes through the zyra-chat edge
// function which itself enforces the gate against guest_sessions in the DB.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { inferRole, inferGeography } from '@/lib/role-geo-inference'

const GUEST_ID_COOKIE = 'cropsintel_guest_id'
const COOKIE_MAX_AGE_DAYS = 30

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  is_deep_output?: boolean
  upgrade_pitch?: UpgradePitch | null
  verified_upgrade_pitch?: VerifiedUpgradePitch | null
  ts?: string
}

export interface UpgradePitch {
  kind: 'guest_to_registered'
  email_url: string
  whatsapp_url: string
  message: string
}

export interface VerifiedUpgradePitch {
  kind: 'registered_to_verified'
  cta_url: string
  message: string
}

export interface ZyraReply {
  response: string
  is_deep_output: boolean
  gated: boolean
  deep_outputs_count: number
  deep_outputs_limit: number | null
  role_inferred: string | null
  geography_inferred: string | null
  upgrade_pitch: UpgradePitch | null
  verified_upgrade_pitch: VerifiedUpgradePitch | null
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(name: string, value: string, days = COOKIE_MAX_AGE_DAYS) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`
}

async function postEdgeFunction<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error ?? ''
    } catch {
      // non-JSON response
    }
    throw new Error(`Edge function ${path} failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as T
}

export interface UseGuestSessionResult {
  guestId: string | null
  deepCount: number
  deepLimit: number
  basicCount: number
  history: ChatMessage[]
  isLoading: boolean
  error: string | null
  inferredRole: string | null
  inferredCountry: string | null
  startGuestSession: () => Promise<string | null>
  sendMessage: (content: string, isStarter?: boolean) => Promise<ZyraReply | null>
  recordDeepOutput: () => Promise<void>
  convertToUser: (userId: string) => Promise<void>
  resetSession: () => void
}

export function useGuestSession(): UseGuestSessionResult {
  const { user, tier } = useAuth()
  const [guestId, setGuestId] = useState<string | null>(null)
  const [deepCount, setDeepCount] = useState(0)
  const [deepLimit, setDeepLimit] = useState(10)
  const [basicCount, setBasicCount] = useState(0)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inferredRole, setInferredRole] = useState<string | null>(null)
  const [inferredCountry, setInferredCountry] = useState<string | null>(null)

  // On mount: read cookie, hydrate state from server
  useEffect(() => {
    const cookieId = readCookie(GUEST_ID_COOKIE)
    if (cookieId) {
      setGuestId(cookieId)
      void hydrateFromServer(cookieId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function hydrateFromServer(id: string) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/guest-gate/state?guest_id=${encodeURIComponent(id)}`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        },
      )
      if (!res.ok) return
      const data = (await res.json()) as {
        deep_outputs_count: number
        basic_chat_count: number
        conversation_history: ChatMessage[] | null
        limit: number
        role_inferred: string | null
        geography_country_inferred: string | null
      }
      setDeepCount(data.deep_outputs_count ?? 0)
      setBasicCount(data.basic_chat_count ?? 0)
      setDeepLimit(data.limit ?? 10)
      setHistory(Array.isArray(data.conversation_history) ? data.conversation_history : [])
      setInferredRole(data.role_inferred ?? null)
      setInferredCountry(data.geography_country_inferred ?? null)
    } catch (err) {
      // Silently ignore — landing should still work without prior history
      console.warn('[useGuestSession] hydrate failed', err)
    }
  }

  const startGuestSession = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await postEdgeFunction<{
        guest_id: string
        deep_outputs_count: number
        basic_chat_count: number
        limit: number
      }>('guest-gate/start', {})
      setGuestId(data.guest_id)
      setDeepCount(data.deep_outputs_count)
      setBasicCount(data.basic_chat_count)
      setDeepLimit(data.limit)
      writeCookie(GUEST_ID_COOKIE, data.guest_id)
      return data.guest_id
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const sendMessage = useCallback(
    async (content: string, _isStarter = false): Promise<ZyraReply | null> => {
      const trimmed = content.trim()
      if (!trimmed) return null

      setError(null)
      setIsLoading(true)

      // Local inference for instant UI feedback (server confirms authoritatively)
      const localRole = inferRole(trimmed)
      const localGeo = inferGeography(trimmed)
      if (localRole !== 'unknown' && !inferredRole) setInferredRole(localRole)
      if (localGeo.country && !inferredCountry) setInferredCountry(localGeo.country)

      // Optimistic user message
      const userMsg: ChatMessage = { role: 'user', content: trimmed, ts: new Date().toISOString() }
      setHistory((prev) => [...prev, userMsg])

      // Make sure we have a guest_id when no user is signed in
      let sessionId = guestId
      if (!sessionId && !user) {
        sessionId = await startGuestSession()
      }

      try {
        const reply = await postEdgeFunction<ZyraReply>('zyra-chat', {
          guest_id: user ? undefined : sessionId,
          user_id: user?.id,
          message: trimmed,
          conversation_history: history,
        })

        const aiMsg: ChatMessage = {
          role: 'assistant',
          content: reply.response,
          is_deep_output: reply.is_deep_output,
          upgrade_pitch: reply.upgrade_pitch,
          verified_upgrade_pitch: reply.verified_upgrade_pitch,
          ts: new Date().toISOString(),
        }
        setHistory((prev) => [...prev, aiMsg])

        setDeepCount(reply.deep_outputs_count ?? 0)
        if (reply.deep_outputs_limit) setDeepLimit(reply.deep_outputs_limit)
        if (reply.role_inferred) setInferredRole(reply.role_inferred)
        if (reply.geography_inferred) setInferredCountry(reply.geography_inferred)

        // Bump basic-chat counter server-side for non-deep guest messages
        if (!user && sessionId && !reply.is_deep_output) {
          void postEdgeFunction<unknown>('guest-gate/record-basic', { guest_id: sessionId }).catch(() => {})
          setBasicCount((prev) => prev + 1)
        }

        return reply
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message'
        setError(message)
        // Roll back optimistic user message
        setHistory((prev) => prev.slice(0, -1))
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [guestId, history, inferredCountry, inferredRole, startGuestSession, user],
  )

  const recordDeepOutput = useCallback(async () => {
    if (!guestId || tier !== 'guest') return
    try {
      const data = await postEdgeFunction<{ ok: boolean; gated: boolean; count: number }>(
        'guest-gate/record-deep',
        { guest_id: guestId },
      )
      setDeepCount(data.count)
    } catch (err) {
      console.warn('[useGuestSession] recordDeepOutput failed', err)
    }
  }, [guestId, tier])

  const convertToUser = useCallback(
    async (userId: string) => {
      if (!guestId) return
      try {
        await postEdgeFunction('guest-gate/convert', { guest_id: guestId, user_id: userId })
      } catch (err) {
        console.warn('[useGuestSession] convertToUser failed', err)
      }
    },
    [guestId],
  )

  const resetSession = useCallback(() => {
    clearCookie(GUEST_ID_COOKIE)
    setGuestId(null)
    setDeepCount(0)
    setBasicCount(0)
    setHistory([])
    setInferredRole(null)
    setInferredCountry(null)
  }, [])

  return {
    guestId,
    deepCount,
    deepLimit,
    basicCount,
    history,
    isLoading,
    error,
    inferredRole,
    inferredCountry,
    startGuestSession,
    sendMessage,
    recordDeepOutput,
    convertToUser,
    resetSession,
  }
}
