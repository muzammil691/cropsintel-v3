import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAtlasChat } from '@/hooks/useAtlasChat'
import type { UseTtsResult } from '@/hooks/useTts'
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
  const { messages, isStreaming, historyLoading, send } = useAtlasChat()
  const [input, setInput] = useState('')
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

  function handleSend() {
    const text = input.trim()
    if (!text || isStreaming) return
    send(text)
    setInput('')
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] xl:h-[calc(100vh-7rem)] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">
      {/* Pane header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Conversation
        </h2>
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

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} tts={tts} />
        ))}

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
      />
    </div>
  )
}
