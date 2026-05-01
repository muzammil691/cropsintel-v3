import { useState, useEffect, useCallback, useRef } from 'react'
import {
  streamChat,
  fetchChatHistory,
  type ChatMessage,
  type ToolCallChip,
} from '@/lib/atlas-client'
import { supabase } from '@/lib/supabase'

const DEFAULT_THREAD = 'web-default'

// Server stores roles as 'user' | 'atlas'; the UI consumes 'user' | 'atlas' too,
// but fetchChatHistory's GET /atlas/conversations endpoint normalises atlas →
// 'assistant' for some callers. The Realtime subscription gets RAW DB rows, so
// we do the normalisation here.
function normaliseRealtimeRow(row: {
  id: string
  role: string
  content: string
  metadata?: Record<string, unknown> | null
  created_at: string
}): ChatMessage {
  return {
    id: row.id,
    role: row.role === 'atlas' ? 'atlas' : 'user',
    content: row.content,
    created_at: row.created_at,
  }
}

export interface UseAtlasChatResult {
  messages: ChatMessage[]
  isStreaming: boolean
  historyLoading: boolean
  send: (text: string) => void
}

export function useAtlasChat(threadId = DEFAULT_THREAD): UseAtlasChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const abortRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchChatHistory(threadId)
      .then((history) => {
        if (cancelled) return
        // Defensive: API may return non-array on a fresh thread or error.
        // Always store an array so consumers can .map() safely.
        setMessages(Array.isArray(history) ? history : [])
      })
      .catch(() => {
        // history unavailable — start fresh
        if (!cancelled) setMessages([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [threadId])

  // Phase 1.10aj — Live multi-device sync. The browser opens a Supabase
  // Realtime channel scoped to this thread; INSERTs from any source (the
  // user's phone via WhatsApp, another open tab, the live-mode session)
  // appear here within ~1–2 s. We dedup against optimistic local rows so the
  // sender's own message doesn't appear twice.
  useEffect(() => {
    const channel = supabase
      .channel(`atlas-chat:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'atlas_conversations',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const raw = payload.new as {
            id: string
            role: string
            content: string
            metadata?: Record<string, unknown> | null
            created_at: string
          }
          if (!raw?.id) return
          const incoming = normaliseRealtimeRow(raw)
          setMessages((prev) => {
            // Already present (server echo of our optimistic row, or a second
            // delivery on reconnect) → skip.
            if (prev.some((m) => m.id === incoming.id)) return prev
            // If we're mid-stream and the latest assistant message is the
            // optimistic placeholder we just appended, leave it alone — the
            // SSE stream will keep filling its content. Avoid double-rendering.
            return [...prev, incoming]
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [threadId])

  const send = useCallback(
    (text: string) => {
      if (isStreaming || !text.trim()) return

      // Optimistically append the user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Placeholder for Atlas reply that gets built up incrementally
      const atlasId = `atlas-${Date.now()}`
      const atlasPlaceholder: ChatMessage = {
        id: atlasId,
        role: 'atlas',
        content: '',
        tool_calls: [],
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, atlasPlaceholder])
      setIsStreaming(true)

      const cleanup = streamChat(threadId, text, (event, data) => {
        const d = data as Record<string, unknown>

        if (event === 'text' || event === 'message') {
          const chunk = typeof d.text === 'string' ? d.text : typeof d.content === 'string' ? d.content : ''
          if (chunk) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === atlasId ? { ...m, content: m.content + chunk } : m,
              ),
            )
          }
        } else if (event === 'tool_call') {
          const chip: ToolCallChip = {
            id: String(d.id ?? Date.now()),
            name: String(d.name ?? ''),
            args: (d.args ?? {}) as Record<string, unknown>,
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === atlasId
                ? { ...m, tool_calls: [...(m.tool_calls ?? []), chip] }
                : m,
            ),
          )
        } else if (event === 'tool_result') {
          const chipId = String(d.id ?? '')
          setMessages((prev) =>
            prev.map((m) =>
              m.id === atlasId
                ? {
                    ...m,
                    tool_calls: (m.tool_calls ?? []).map((tc) =>
                      tc.id === chipId ? { ...tc, result: d.result } : tc,
                    ),
                  }
                : m,
            ),
          )
        } else if (event === 'done') {
          setIsStreaming(false)
        } else if (event === 'error') {
          const errMsg = typeof d.error === 'string' ? d.error : 'Unknown error'
          setMessages((prev) =>
            prev.map((m) =>
              m.id === atlasId
                ? { ...m, content: m.content || `[Error: ${errMsg}]` }
                : m,
            ),
          )
          setIsStreaming(false)
        }
      })

      abortRef.current = cleanup
    },
    [isStreaming, threadId],
  )

  useEffect(() => {
    return () => {
      abortRef.current?.()
    }
  }, [])

  return { messages, isStreaming, historyLoading, send }
}
