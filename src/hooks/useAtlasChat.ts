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

// 1.10bd — refcounted module singleton for the realtime chat subscription.
//
// The cockpit mounts CockpitChat twice (desktop <aside> + MobileChatSheet,
// both kept in the DOM regardless of Tailwind breakpoint). Both consumers
// call useAtlasChat() with the same threadId. supabase-js v2 dedupes
// `supabase.channel(name)` by name across the whole client, so both
// consumers used to land on the same channel instance — consumer 1's
// .subscribe() ran, then consumer 2's .on() call threw "cannot add
// postgres_changes callbacks after subscribe()". Same risk on React 19
// StrictMode mount → cleanup → mount cycles.
//
// Fix: exactly one channel per threadId. The first consumer creates +
// subscribes + adds itself to a listener Set. Subsequent consumers (or
// re-mounts) just add their callback to the same Set; the channel's
// single .on() fans out to every registered listener. When the listener
// count drops to zero, the channel is torn down. No random suffixes, no
// per-consumer channel proliferation — connection count is capped at 1
// per active threadId.

type RealtimePayload = { new: { id: string; role: string; content: string; metadata?: Record<string, unknown> | null; created_at: string } }
type Listener = (payload: RealtimePayload) => void

interface ChannelEntry {
  channel: ReturnType<typeof supabase.channel>
  listeners: Set<Listener>
}

const channels = new Map<string, ChannelEntry>()

function subscribeChat(threadId: string, listener: Listener): () => void {
  let entry = channels.get(threadId)
  if (!entry) {
    // First consumer for this threadId. Register the listener BEFORE
    // wiring .on() so the fan-out closure has the listener in scope on
    // first invocation; subsequent consumers join the same Set.
    const listeners = new Set<Listener>([listener])
    const channel = supabase
      .channel(`atlas-chat:${threadId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js's
        // postgres_changes signature is a tagged tuple; the v2 typing surfaces a union
        // that doesn't narrow cleanly here. The runtime contract matches.
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'atlas_conversations',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload: RealtimePayload) => {
          for (const l of listeners) l(payload)
        },
      )
      .subscribe()
    entry = { channel, listeners }
    channels.set(threadId, entry)
  } else {
    entry.listeners.add(listener)
  }
  return () => {
    const e = channels.get(threadId)
    if (!e) return
    e.listeners.delete(listener)
    if (e.listeners.size === 0) {
      void supabase.removeChannel(e.channel)
      channels.delete(threadId)
    }
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
  // 1.10bd — Channel creation moved to subscribeChat (module-level
  // refcounted singleton above). See its block comment for why. This
  // hook just registers a listener and returns the cleanup that
  // un-registers it; the channel itself is shared across all consumers
  // of the same threadId.
  useEffect(() => {
    const cleanup = subscribeChat(threadId, (payload) => {
      const raw = payload.new
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
    })
    return cleanup
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
