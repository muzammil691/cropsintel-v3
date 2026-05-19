import { useState, useEffect, useCallback, useRef } from 'react'
import {
  streamChat,
  fetchChatHistory,
  type ChatAttachment,
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
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  const attachments = Array.isArray(meta.attachments) ? (meta.attachments as ChatAttachment[]) : undefined
  const audio = (meta.audio && typeof meta.audio === 'object')
    ? (meta.audio as ChatMessage['audio'])
    : undefined
  return {
    id: row.id,
    role: row.role === 'atlas' ? 'atlas' : 'user',
    content: row.content,
    created_at: row.created_at,
    attachments,
    audio,
  }
}

export interface UseAtlasChatResult {
  messages: ChatMessage[]
  isStreaming: boolean
  historyLoading: boolean
  send: (
    text: string,
    attachments?: ChatAttachment[],
    options?: { replayContext?: { rangeStartAt?: string; summaryLong?: string } | null },
  ) => void
  cancel: () => void
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
  //
  // 1.10bd-rt-fix — supabase-js refuses .on() calls after the channel has
  // been .subscribe()'d. Two scenarios in this app re-triggered the effect
  // body against a still-subscribed channel and threw:
  //   (a) React 19 StrictMode in dev → mount → cleanup → mount. The cleanup
  //       removeChannel() is async/fire-and-forget; the second mount fires
  //       .channel(<same-name>) → .on() → .subscribe() while the prior
  //       channel is still being torn down.
  //   (b) AtlasCockpit renders both a desktop <aside> CockpitChat AND a
  //       mobile MobileChatSheet CockpitChat (hidden by Tailwind's md:
  //       breakpoint). Both are mounted; both call useAtlasChat with
  //       threadId='web-default'. Two channels with the same name race.
  //
  // Defences:
  //   • channelRef tracks the currently-subscribed channel; if it's already
  //     set (StrictMode remount), bail before re-wiring .on().
  //   • A unique random suffix on the channel name makes the (b) collision
  //     impossible — each consumer gets its own realtime topic. The cost is
  //     slightly more upstream subscribers; the trade is worth it vs. the
  //     hard crash.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  useEffect(() => {
    // Guard: don't re-subscribe if a channel is already wired for this
    // hook instance. The cleanup below null-outs the ref so legitimate
    // threadId changes (the dep) still re-subscribe.
    if (channelRef.current) return

    const suffix = Math.random().toString(36).slice(2, 8)
    const channel = supabase
      .channel(`atlas-chat:${threadId}:${suffix}`)
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
    channelRef.current = channel
    return () => {
      const current = channelRef.current
      channelRef.current = null
      if (current) void supabase.removeChannel(current)
    }
  }, [threadId])

  const send = useCallback(
    (
      text: string,
      attachments?: ChatAttachment[],
      options?: { replayContext?: { rangeStartAt?: string; summaryLong?: string } | null },
    ) => {
      const hasContent = !!text.trim() || (attachments && attachments.length > 0)
      if (isStreaming || !hasContent) return

      // Optimistically append the user message (with attachments for inline render)
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
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

      const cleanup = streamChat(
        threadId,
        text,
        (event, data) => {
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
        },
        { attachments, replayContext: options?.replayContext ?? null },
      )

      abortRef.current = cleanup
    },
    [isStreaming, threadId],
  )

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current()
      abortRef.current = null
    }
    setIsStreaming(false)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.()
    }
  }, [])

  return { messages, isStreaming, historyLoading, send, cancel }
}
