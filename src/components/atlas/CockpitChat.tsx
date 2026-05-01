import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MicButton } from './MicButton'
import { useStt } from '@/hooks/useStt'
import { useAtlasChat } from '@/hooks/useAtlasChat'
import type { UseTtsResult } from '@/hooks/useTts'
import { AudioPlayer } from './AudioPlayer'
import { ArtifactCardInChat } from './ArtifactCardInChat'
import { SlashCommandMenu } from './SlashCommandMenu'
import { MentionMenu } from './MentionMenu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  parseSlashCommand,
  commandSignature,
  type SlashCommand,
  type MentionAgent,
} from '@/lib/atlas-slash-commands'
import type { ChatMessage, ToolCallChip } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface CockpitChatProps {
  prefill?: string
  onPrefillConsumed?: () => void
  tts?: UseTtsResult
  onSlashNavigate: (tab: 'plan' | 'queue' | 'agents' | 'audit' | 'workflows' | 'artifacts') => void
}

const SAMPLE_PROMPTS = [
  'Show me the most recent failed audit and what should we do?',
  "What's in the queue right now?",
  'Draft a spec for phase-2.1',
  'Set trust mode to confirm',
]

/**
 * Persistent left-pane chat for the cockpit. Wraps useAtlasChat with slash
 * command + mention popovers and renders tool results as inline
 * ArtifactCardInChat components.
 */
export function CockpitChat({
  prefill,
  onPrefillConsumed,
  tts,
  onSlashNavigate,
}: CockpitChatProps) {
  const { messages, isStreaming, historyLoading, send } = useAtlasChat()
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stt = useStt()

  // Slash + mention menu state — driven by what's at the start of the input.
  const slashState = computeSlashState(input)
  const mentionState = computeMentionState(input)
  const [confirmMention, setConfirmMention] = useState<{
    raw: string
    agent: MentionAgent
    args: string
  } | null>(null)
  const [slashHelpOpen, setSlashHelpOpen] = useState(false)

  const wasStreamingRef = useRef(false)
  const lastSpokenIdRef = useRef<string | null>(null)

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // TTS auto-play when stream closes.
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

  // Prefill from external sources (WizardBar buttons in legacy shells).
  useEffect(() => {
    if (prefill) {
      setInput(prefill)
      textareaRef.current?.focus()
      onPrefillConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  function handleTranscript(text: string) {
    const trimmed = input.trim()
    setInput(trimmed ? `${trimmed} ${text}` : text)
    textareaRef.current?.focus()
  }

  function pickSlashCommand(cmd: SlashCommand) {
    if (cmd.kind === 'navigate' && cmd.targetTab) {
      onSlashNavigate(cmd.targetTab)
      setInput('')
      return
    }
    if (cmd.kind === 'help') {
      setSlashHelpOpen(true)
      setInput('')
      return
    }
    // Default: expand the signature inline so the user can fill in args.
    const sig = commandSignature(cmd)
    setInput(cmd.argHint ? `${sig} ` : `${sig} `)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function pickMentionAgent(agent: MentionAgent) {
    const replaced = input.replace(/@\w*$/, `@${agent} `)
    setInput(replaced)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleSend() {
    const text = input.trim()
    if (!text || isStreaming) return

    // @builder restart and similar destructive mentions require a confirm.
    const destructiveMention = detectDestructiveMention(text)
    if (destructiveMention) {
      setConfirmMention(destructiveMention)
      return
    }

    // Slash commands: dispatch through the chat handler so server-side tools
    // also fire. We pass the raw `/word ...args` straight through; the
    // backend parses it. The cockpit also synthesizes a local hint message
    // for navigation/help — those are handled in pickSlashCommand and never
    // reach handleSend.
    send(text)
    setInput('')
  }

  function confirmAndSend() {
    if (!confirmMention) return
    send(confirmMention.raw)
    setInput('')
    setConfirmMention(null)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // If a popover is open, let its global keydown handler handle Up/Down/Enter.
    if (slashState.open || mentionState.open) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Pane header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 shrink-0">
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
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50/40 dark:bg-slate-900/20">
        {historyLoading && (
          <div className="text-xs text-slate-400 text-center py-8">Loading conversation…</div>
        )}

        {!historyLoading && !hasMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
            <span className="grid place-items-center size-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              <Sparkles className="size-6" />
            </span>
            <div>
              <p className="text-sm font-medium">Atlas is ready.</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Type <code className="font-mono">/</code> for commands, <code className="font-mono">@</code> to address an agent.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-sm">
              {SAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => setInput(p)}
                  className="text-xs text-left px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors duration-150"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} msg={msg} tts={tts} onRetry={(chip) => {
            const args = typeof chip.args === 'object' && chip.args !== null
              ? Object.entries(chip.args).map(([k, v]) => `${k}=${String(v)}`).join(' ')
              : ''
            const cmd = `/${chip.name.split('.').pop() ?? chip.name} ${args}`.trim()
            send(cmd)
          }} />
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
      <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2 bg-white dark:bg-slate-950 shrink-0">
        {stt.lastError && (
          <div className="mb-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {stt.lastError}
          </div>
        )}

        <div className="relative flex items-end gap-1.5">
          <SlashCommandMenu
            query={slashState.query}
            open={slashState.open}
            onSelect={pickSlashCommand}
            onClose={() => setInput((v) => v.replace(/^\s*\/[a-zA-Z]*$/, ''))}
          />
          <MentionMenu
            query={mentionState.query}
            open={mentionState.open}
            onSelect={pickMentionAgent}
            onClose={() => {
              /* Leaving the @ token in place is fine — user can keep typing. */
            }}
          />

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              stt.recording ? 'Listening…'
                : stt.transcribing ? 'Transcribing…'
                : 'Ask Atlas — / for commands, @ for agents'
            }
            className={cn(
              'flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors duration-150 max-h-40 overflow-y-auto placeholder:text-slate-400',
            )}
            style={{ fieldSizing: 'content' } as React.CSSProperties}
            disabled={isStreaming}
          />
          <MicButton stt={stt} onTranscript={handleTranscript} disabled={isStreaming} />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 mb-0.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Send className="size-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>

      {/* Destructive @mention confirmation */}
      <Dialog
        open={confirmMention !== null}
        onOpenChange={(o) => !o && setConfirmMention(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm destructive action</DialogTitle>
            <DialogDescription>
              Sending <code className="font-mono">@{confirmMention?.agent} {confirmMention?.args}</code>{' '}
              will issue a Railway redeploy or service-level command. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmMention(null)}>
              Cancel
            </Button>
            <Button onClick={confirmAndSend} className="bg-amber-600 hover:bg-amber-700 text-white">
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* /help dialog */}
      <Dialog open={slashHelpOpen} onOpenChange={setSlashHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Slash commands</DialogTitle>
            <DialogDescription>Type / at the start of any message.</DialogDescription>
          </DialogHeader>
          <SlashHelpList />
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function computeSlashState(input: string): { open: boolean; query: string } {
  // Show only when `/` is at position 0 of the trimmed input, optionally
  // followed by zero-or-more letters (and NOTHING else yet — once the user
  // starts typing args after a space, the menu hides).
  const trimmed = input.trimStart()
  const match = trimmed.match(/^\/([a-zA-Z]*)$/)
  if (!match) return { open: false, query: '' }
  return { open: true, query: match[1] }
}

function computeMentionState(input: string): { open: boolean; query: string } {
  const match = input.match(/(?:^|\s)@(\w*)$/)
  if (!match) return { open: false, query: '' }
  return { open: true, query: match[1] }
}

function detectDestructiveMention(
  text: string,
): { raw: string; agent: MentionAgent; args: string } | null {
  const m = text.match(/@(Atlas|Builder|Verifier|Designer|Council|Memory|Adela)\s+(restart|stop|kill|redeploy)/i)
  if (!m) return null
  const agent = capitalise(m[1]) as MentionAgent
  return { raw: text, agent, args: m[2] }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

import { SLASH_COMMANDS } from '@/lib/atlas-slash-commands'

function SlashHelpList() {
  return (
    <ul className="grid gap-1 max-h-72 overflow-y-auto">
      {SLASH_COMMANDS.map((c) => (
        <li
          key={c.name}
          className="flex items-baseline gap-2 px-2 py-1 rounded text-xs hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors duration-100"
        >
          <code className="font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
            {commandSignature(c)}
          </code>
          <span className="text-slate-500">{c.description}</span>
        </li>
      ))}
    </ul>
  )
}

// ─── chat message bubble (cockpit variant — uses ArtifactCardInChat) ────────
// Replaces the simple ToolChip from ChatPane/MessageBubble with the rich
// inline artifact card so EVERY tool result carries its own fix path.
import { ChevronRight, ChevronDown } from 'lucide-react'

function ChatMessageBubble({
  msg,
  tts,
  onRetry,
}: {
  msg: ChatMessage
  tts?: UseTtsResult
  onRetry: (chip: ToolCallChip) => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`rounded-lg px-3 py-2 max-w-[92%] shadow-sm text-sm ${
          isUser
            ? 'bg-emerald-600 text-white rounded-br-sm'
            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-bl-sm'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose-sm">{renderMarkdownBlocks(msg.content)}</div>
        )}
        {(msg.tool_calls ?? []).length > 0 && (
          <div className="mt-1.5 space-y-1">
            {msg.tool_calls!.map((chip) => (
              <ArtifactCardInChat key={chip.id} chip={chip} onRetry={onRetry} />
            ))}
          </div>
        )}
        {!isUser && tts?.enabled && msg.content && (
          <AudioPlayer text={msg.content} voiceId={tts.voiceId} enabled={tts.enabled} />
        )}
      </div>
      <span className="text-[10px] text-slate-400 px-1 tabular-nums">
        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

// Lightweight markdown — same rules as ChatPane/MessageBubble but with a
// collapsible code-block default for compactness in the narrower 380px column.
function renderMarkdownBlocks(text: string): React.ReactNode {
  const blocks = text.split(/\n\n+/)
  return blocks.map((block, bi) => {
    const codeMatch = block.match(/^```(\w*)\n([\s\S]*?)```$/)
    if (codeMatch) {
      return <CollapsibleCode key={bi} body={codeMatch[2]} />
    }
    if (/^[-*] /m.test(block)) {
      const items = block.split(/\n/).filter((l) => /^[-*] /.test(l))
      return (
        <ul key={bi} className="my-1 list-disc pl-4 space-y-0.5">
          {items.map((item, i) => (
            <li key={i}>{inlineMarkdown(item.replace(/^[-*] /, ''))}</li>
          ))}
        </ul>
      )
    }
    const headingMatch = block.match(/^(#{1,3}) (.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5'
      const cls = level === 1 ? 'text-sm font-semibold mt-2 mb-0.5' : 'text-xs font-semibold mt-1.5 mb-0.5'
      return (
        <Tag key={bi} className={cls}>
          {inlineMarkdown(headingMatch[2])}
        </Tag>
      )
    }
    return (
      <p key={bi} className="my-0.5 leading-relaxed">
        {inlineMarkdown(block)}
      </p>
    )
  })
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code
          key={i}
          className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      )
    return part
  })
}

function CollapsibleCode({ body }: { body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150"
      >
        {open ? <ChevronDown className="size-3 text-slate-400" /> : <ChevronRight className="size-3 text-slate-400" />}
        <span className="font-mono text-slate-500">code block ({body.split('\n').length} lines)</span>
      </button>
      {open && (
        <pre className="border-t border-slate-200 dark:border-slate-700 px-2 py-1.5 overflow-x-auto font-mono text-[11px]">
          <code>{body}</code>
        </pre>
      )}
    </div>
  )
}

// Parsed-command export so callers (cockpit-level handlers if needed) can
// inspect what the user submitted before it reaches the backend.
export { parseSlashCommand }
