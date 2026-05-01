import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles, X } from 'lucide-react'
import { useAtlasChat } from '@/hooks/useAtlasChat'
import type { UseTtsResult } from '@/hooks/useTts'
import type { ChatAttachment } from '@/lib/atlas-client'
import { MessageBubble } from './MessageBubble'
import { ComposeBar } from './ComposeBar'

interface ChatPaneProps {
  prefill?: string
  onPrefillConsumed?: () => void
  tts?: UseTtsResult
}

const SAMPLE_PROMPTS = [
  'Show me the most recent failed audit and what should we do?',
  'What\'s in the queue right now?',
  'Draft a spec for phase-2.1',
  'Set trust mode to confirm',
]

export function ChatPane({ prefill, onPrefillConsumed, tts }: ChatPaneProps) {
  const { messages, isStreaming, historyLoading, send, cancel } = useAtlasChat()
  const [input, setInput] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wasStreamingRef = useRef(false)
  const lastSpokenIdRef = useRef<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Auto-play assistant reply when SSE stream closes (isStreaming: true → false).
  useEffect(() => {
    if (!tts?.enabled) {
      wasStreamingRef.current = isStreaming
      return
    }
    if (wasStreamingRef.current && !isStreaming) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'atlas') {
          if (m.content && m.id !== lastSpokenIdRef.current) {
            lastSpokenIdRef.current = m.id
            void tts.speak(m.content)
          }
          break
        }
      }
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, messages, tts])

  function handleSend(attachments?: ChatAttachment[]) {
    const text = input.trim()
    if ((!text && (!attachments || attachments.length === 0)) || isStreaming) return
    send(text, attachments)
    setInput('')
  }

  const handleSearch = useCallback(() => {
    setSearchOpen(true)
    // Defer focus to after the input mounts.
    setTimeout(() => searchInputRef.current?.focus(), 30)
  }, [])

  const handleCopyLastReply = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'atlas' && m.content && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(m.content)
        return
      }
    }
  }, [messages])

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((m) => m.content?.toLowerCase().includes(q))
  }, [messages, searchQuery])

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] xl:h-[calc(100vh-7rem)] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">
      {/* Pane header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 shrink-0">
          Conversation
        </h2>
        {searchOpen ? (
          <div className="flex items-center gap-1 flex-1 max-w-md">
            <Search className="size-3.5 text-slate-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search messages…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchOpen(false)
                  setSearchQuery('')
                }
              }}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => { setSearchOpen(false); setSearchQuery('') }}
              className="rounded p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSearch}
            aria-label="Search messages (Cmd+K)"
            title="Search messages (Cmd+K)"
            className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
          >
            <Search className="size-3" />
            <span className="hidden sm:inline">Search</span>
          </button>
        )}
        {isStreaming && (
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            streaming
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/40 dark:bg-slate-900/20">
        {historyLoading && (
          <div className="text-xs text-slate-400 text-center py-8">Loading conversation…</div>
        )}

        {!historyLoading && !hasMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-12">
            <span className="grid place-items-center size-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              <Sparkles className="size-6" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Atlas is ready.</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Ask anything, or pick a starter prompt below.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-sm">
              {SAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => setInput(p)}
                  className="text-xs text-left px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors duration-150"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} tts={tts} />
        ))}
        {searchOpen && searchQuery && filteredMessages.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">
            No messages match "{searchQuery}".
          </p>
        )}

        {isStreaming && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 pl-1">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0ms]" />
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:150ms]" />
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:300ms]" />
            <span className="ml-1">Atlas is thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <ComposeBar
        value={input}
        onChange={setInput}
        onSend={handleSend}
        disabled={isStreaming}
        prefill={prefill}
        onPrefillConsumed={onPrefillConsumed}
        onSearch={handleSearch}
        onCancel={cancel}
        onCopyLastReply={handleCopyLastReply}
      />
    </div>
  )
}
