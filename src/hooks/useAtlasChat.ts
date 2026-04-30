import { useState, useEffect, useCallback, useRef } from 'react'
import {
  streamChat,
  fetchChatHistory,
  type ChatMessage,
  type ToolCallChip,
} from '@/lib/atlas-client'

const DEFAULT_THREAD = 'web-default'

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
        if (!cancelled) setMessages(history)
      })
      .catch(() => {
        // history unavailable — start fresh
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
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
