import { useRef, useEffect, useState } from 'react'
import { Send, ChevronRight, ChevronDown, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAtlasChat } from '@/hooks/useAtlasChat'
import type { ChatMessage, ToolCallChip } from '@/lib/atlas-client'
import { AudioPlayer } from '@/components/atlas/AudioPlayer'
import type { UseTtsResult } from '@/hooks/useTts'

// --- Simple markdown renderer (no external library)
// Handles: headers, bold, italic, inline-code, code-blocks, bullets, line breaks
function renderMarkdown(text: string): React.ReactNode {
  const blocks = text.split(/\n\n+/)
  return blocks.map((block, bi) => {
    // Fenced code block
    const codeMatch = block.match(/^```(\w*)\n([\s\S]*?)```$/)
    if (codeMatch) {
      return (
        <pre key={bi} className="my-2 rounded bg-muted/80 px-3 py-2 text-xs overflow-x-auto font-mono">
          <code>{codeMatch[2]}</code>
        </pre>
      )
    }

    // Unordered list
    if (/^[-*] /m.test(block)) {
      const items = block.split(/\n/).filter((l) => /^[-*] /.test(l))
      return (
        <ul key={bi} className="my-1.5 list-disc pl-4 space-y-0.5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{inlineMarkdown(item.replace(/^[-*] /, ''))}</li>
          ))}
        </ul>
      )
    }

    // Header
    const headingMatch = block.match(/^(#{1,3}) (.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5'
      const cls = level === 1 ? 'text-base font-semibold mt-3 mb-1' : 'text-sm font-semibold mt-2 mb-0.5'
      return <Tag key={bi} className={cls}>{inlineMarkdown(headingMatch[2])}</Tag>
    }

    // Normal paragraph
    const lines = block.split('\n')
    return (
      <p key={bi} className="my-1 text-sm leading-relaxed">
        {lines.map((line, li) => (
          <span key={li}>
            {inlineMarkdown(line)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    )
  })
}

function inlineMarkdown(text: string): React.ReactNode {
  // Split on **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs font-mono">{part.slice(1, -1)}</code>
    return part
  })
}

// --- Tool call chip
function ToolChip({ chip }: { chip: ToolCallChip }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1 rounded border border-border/60 bg-muted/40 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 hover:bg-muted/60 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench className="size-3 text-muted-foreground shrink-0" />
        <span className="font-mono text-muted-foreground">{chip.name}</span>
        {open ? (
          <ChevronDown className="size-3 ml-auto text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 ml-auto text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 px-2 py-1.5 space-y-1">
          <div>
            <span className="text-muted-foreground">args: </span>
            <code className="font-mono text-xs break-all">
              {JSON.stringify(chip.args, null, 2)}
            </code>
          </div>
          {chip.result !== undefined && (
            <div>
              <span className="text-muted-foreground">result: </span>
              <code className="font-mono text-xs break-all">
                {JSON.stringify(chip.result, null, 2)}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Single message bubble
function MessageBubble({ msg, tts }: { msg: ChatMessage; tts?: UseTtsResult }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`rounded-xl px-4 py-2.5 max-w-[85%] ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted/60 rounded-bl-sm'
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose-sm">{renderMarkdown(msg.content)}</div>
        )}
        {/* Tool calls rendered below message body */}
        {(msg.tool_calls ?? []).length > 0 && (
          <div className="mt-2 space-y-1">
            {msg.tool_calls!.map((chip) => (
              <ToolChip key={chip.id} chip={chip} />
            ))}
          </div>
        )}
        {/* Per-message replay control when voice is enabled */}
        {!isUser && tts?.enabled && msg.content && (
          <AudioPlayer
            text={msg.content}
            voiceId={tts.voiceId}
            enabled={tts.enabled}
          />
        )}
      </div>
      <span className="text-[10px] text-muted-foreground px-1">
        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

// --- Public component
interface ChatPanelProps {
  prefill?: string
  onPrefillConsumed?: () => void
  tts?: UseTtsResult
}

export function ChatPanel({ prefill, onPrefillConsumed, tts }: ChatPanelProps) {
  const { messages, isStreaming, historyLoading, send } = useAtlasChat()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wasStreamingRef = useRef(false)
  const lastSpokenIdRef = useRef<string | null>(null)

  // Inject prefill text (from WizardBar)
  useEffect(() => {
    if (prefill) {
      setInput(prefill)
      textareaRef.current?.focus()
      onPrefillConsumed?.()
    }
  }, [prefill, onPrefillConsumed])

  // Auto-scroll on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Auto-play assistant reply when SSE stream closes (isStreaming: true → false)
  // and TTS is enabled. Tracks lastSpokenIdRef to avoid replaying on rerenders.
  useEffect(() => {
    if (!tts?.enabled) {
      wasStreamingRef.current = isStreaming
      return
    }
    if (wasStreamingRef.current && !isStreaming) {
      // Stream just finished — find the latest atlas message.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'atlas') {
          if (m.content && m.id !== lastSpokenIdRef.current) {
            lastSpokenIdRef.current = m.id
            // Fire and forget — TTS failure must never block UI.
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] rounded-lg border bg-card overflow-hidden">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {historyLoading && (
          <p className="text-xs text-muted-foreground text-center py-8">Loading conversation…</p>
        )}
        {!historyLoading && messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No messages yet. Ask Atlas anything.
          </p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} tts={tts} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
            <span className="inline-block size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
            <span className="inline-block size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
            <span className="inline-block size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            <span className="ml-1">Atlas is thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t px-3 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Atlas…"
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition max-h-40 overflow-y-auto placeholder:text-muted-foreground"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          disabled={isStreaming}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={isStreaming || !input.trim()}
          className="shrink-0 mb-0.5"
        >
          <Send className="size-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  )
}
