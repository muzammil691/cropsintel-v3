// Phase 1.10z — Dr. Atlas modal chat surface.
//
// Mounted by DrAtlasAssistant when the FAB is opened. Streams replies from the
// `dr-atlas` Supabase edge function via SSE. Logs every user message + assistant
// reply to atlas_events through the drAtlas SDK.

import { useEffect, useRef, useState } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { drAtlas } from '@/lib/drAtlas'
import { Button } from '@/components/ui/button'
import { Z } from '@/lib/z-indexes'
import { cn } from '@/lib/utils'

type Role = 'user' | 'assistant' | 'system'
interface Msg {
  id: string
  role: Role
  content: string
  pending?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  pagePath: string
}

const RATE_LIMIT_MS = 12_000 // ~5 messages/min per UX guideline

export function DrAtlasModal({ open, onClose, pagePath }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastSentAtRef = useRef<number>(0)
  const threadIdRef = useRef<string>(crypto.randomUUID())
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Lock body scroll while open + close on Escape
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Cancel any in-flight stream on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  if (!open) return null

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return

    const now = Date.now()
    if (now - lastSentAtRef.current < RATE_LIMIT_MS) {
      const wait = Math.ceil((RATE_LIMIT_MS - (now - lastSentAtRef.current)) / 1000)
      setError(`Please wait ${wait}s before sending another message.`)
      return
    }
    lastSentAtRef.current = now
    setError(null)

    const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    setMessages((m) => [...m, userMsg, { id: assistantId, role: 'assistant', content: '', pending: true }])
    setInput('')
    setBusy(true)

    drAtlas.log('dr_atlas_user_message', 'atlas', `len=${text.length}`, {
      source: 'dr_atlas',
      metadata: { thread_id: threadIdRef.current },
    })

    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in to chat with Dr. Atlas.')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dr-atlas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            thread_id: threadIdRef.current,
            message: text,
            page_path: pagePath,
          }),
          signal: ctrl.signal,
        },
      )

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`dr-atlas ${res.status}${errBody ? `: ${errBody.slice(0, 120)}` : ''}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Parse SSE frames: lines starting with `data:`
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const evt = JSON.parse(payload) as { delta?: string; error?: string }
              if (evt.error) throw new Error(evt.error)
              if (evt.delta) {
                acc += evt.delta
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === assistantId ? { ...msg, content: acc, pending: true } : msg,
                  ),
                )
              }
            } catch (e) {
              // Tolerate non-JSON keep-alives; surface only true parse errors
              if (payload.startsWith('{')) throw e
            }
          }
        }
      }

      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId ? { ...msg, content: acc || '(no reply)', pending: false } : msg,
        ),
      )
      drAtlas.log('dr_atlas_assistant_reply', 'atlas', `len=${acc.length}`, {
        source: 'dr_atlas',
        metadata: { thread_id: threadIdRef.current },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      if (message.includes('aborted')) return
      setError(message)
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: `_Sorry — I hit an error: ${message}_`, pending: false }
            : msg,
        ),
      )
      drAtlas.log('dr_atlas_error', 'atlas', message, {
        source: 'dr_atlas',
        severity: 'error',
        metadata: { thread_id: threadIdRef.current },
      })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div
      className="fixed inset-0 flex justify-end"
      style={{ zIndex: Z.fabModal }}
      role="dialog"
      aria-modal="true"
      aria-label="Dr. Atlas assistant"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close Dr. Atlas"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 supports-backdrop-filter:backdrop-blur-sm"
      />

      {/* Sheet — full-screen on mobile, 400px sheet on md+ */}
      <div
        className={cn(
          'relative flex flex-col bg-background shadow-2xl border-l',
          'h-full w-full md:max-w-[400px]',
          'animate-in slide-in-from-right duration-150',
        )}
      >
        <header className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
              DA
            </div>
            <div>
              <div className="text-sm font-semibold">Dr. Atlas</div>
              <div className="text-xs text-muted-foreground">CropsIntel helper</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </header>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8 space-y-1">
              <p className="font-medium text-foreground">How can I help?</p>
              <p className="text-xs">
                Ask about CropsIntel features, your data, or how to do something on this page.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>

        {error && (
          <div
            role="status"
            className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-t border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800"
          >
            {error}
          </div>
        )}

        <form
          className="border-t p-3 flex items-end gap-2 shrink-0"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Dr. Atlas…"
            rows={2}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            aria-label="Message Dr. Atlas"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !input.trim()}
            aria-label="Send message"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground border border-border/60',
        )}
      >
        {msg.content || (msg.pending && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> thinking…
          </span>
        ))}
      </div>
    </div>
  )
}
