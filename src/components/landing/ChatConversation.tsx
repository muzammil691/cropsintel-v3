// Phase 1.3b — Chat thread for the landing page.
//
// Renders user + assistant turns, scrolls to bottom on new messages, shows a
// thinking indicator while waiting for the edge function. Markdown-light: we
// keep it to plain text + paragraph breaks for the placeholder. Phase 1.10
// swaps in a real markdown renderer if Zyra returns formatted output.

import { useEffect, useRef } from 'react'
import { UpgradePitchInline } from './UpgradePitchInline'
import { UpgradeToVerifiedInline } from './UpgradeToVerifiedInline'
import type { ChatMessage } from '@/hooks/useGuestSession'

interface Props {
  history: ChatMessage[]
  isThinking?: boolean
  greeting?: string
}

export function ChatConversation({ history, isThinking = false, greeting }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [history.length, isThinking])

  return (
    <div
      data-testid="chat-conversation"
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 min-h-0"
    >
      {greeting && history.length === 0 && (
        <div className="flex justify-start" data-testid="chat-greeting">
          <Bubble side="ai">
            <p className="leading-relaxed">{greeting}</p>
          </Bubble>
        </div>
      )}

      {history.map((m, idx) => (
        <div
          key={idx}
          className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          data-testid={`chat-message-${m.role}-${idx}`}
        >
          <Bubble side={m.role === 'user' ? 'user' : 'ai'}>
            {m.is_deep_output && m.role === 'assistant' && (
              <div
                className="mb-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400"
                data-testid="deep-insight-badge"
              >
                Deep insight
              </div>
            )}
            <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
            {m.upgrade_pitch && <UpgradePitchInline pitch={m.upgrade_pitch} />}
            {m.verified_upgrade_pitch && <UpgradeToVerifiedInline pitch={m.verified_upgrade_pitch} />}
          </Bubble>
        </div>
      ))}

      {isThinking && (
        <div className="flex justify-start" data-testid="chat-thinking">
          <Bubble side="ai">
            <div className="flex items-center gap-1.5 text-slate-500">
              <span className="w-1.5 h-1.5 bg-current rounded-full animate-pulse" />
              <span className="w-1.5 h-1.5 bg-current rounded-full animate-pulse [animation-delay:120ms]" />
              <span className="w-1.5 h-1.5 bg-current rounded-full animate-pulse [animation-delay:240ms]" />
              <span className="ml-1.5 text-xs">CropsIntel is thinking…</span>
            </div>
          </Bubble>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}

function Bubble({ side, children }: { side: 'user' | 'ai'; children: React.ReactNode }) {
  const base = 'max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm'
  const tone =
    side === 'user'
      ? 'bg-emerald-600 text-white dark:bg-emerald-700'
      : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800'
  return <div className={`${base} ${tone}`}>{children}</div>
}
