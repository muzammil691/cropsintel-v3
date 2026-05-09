// CropsIntel V3 — Landing page (Phase 1.3b).
//
// Replaces the V2-style hero/features/CTA layout with the AI-agent front door
// locked with Muzammil 2026-05-09: hero rail on the left, chat panel on the
// right, hybrid starter (4 chips + free input box), 10-deep-insight gate for
// guests, in-thread upgrade pitch when the gate fires.
//
// Master plan ties: §11.2 Phase 1.5 (landing) + §9.2 Phase 1.10 (Zyra). The
// Zyra brain is a placeholder today; Phase 1.10 swaps in the real 13-module
// agent without changing this UI.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { useGuestSession } from '@/hooks/useGuestSession'
import { ChatConversation } from '@/components/landing/ChatConversation'
import { InsightCounter } from '@/components/landing/InsightCounter'
import { StarterChips } from '@/components/landing/StarterChips'

const DEFAULT_GREETING =
  "Welcome. I'm CropsIntel — I track almond markets globally and I'll tell you what I actually think. Are you buying, selling, trading, or just curious?"

export default function Landing() {
  const { user, tier, isLoading: authLoading } = useAuth()
  const {
    guestId,
    deepCount,
    deepLimit,
    history,
    isLoading: chatLoading,
    error,
    sendMessage,
    startGuestSession,
  } = useGuestSession()

  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const startedGuest = useRef(false)

  useEffect(() => {
    document.title = 'CropsIntel — AI agent for almond markets'
  }, [])

  // Bootstrap a guest session for anonymous visitors so the gate works.
  useEffect(() => {
    if (authLoading) return
    if (user) return // Authenticated users don't need a guest_id
    if (guestId) return
    if (startedGuest.current) return
    startedGuest.current = true
    void startGuestSession()
  }, [authLoading, user, guestId, startGuestSession])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await sendMessage(text)
    inputRef.current?.focus()
  }

  async function handleStarter(prompt: string) {
    setDraft('')
    await sendMessage(prompt, true)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50/30 via-white to-emerald-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[2fr_3fr] min-h-0">
        {/* Left rail — brand + tagline */}
        <aside className="hidden lg:flex flex-col justify-between p-10 xl:p-14 border-r border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-b from-white/40 to-emerald-50/40 dark:from-slate-900/40 dark:to-slate-950/40">
          <div className="space-y-6">
            <Link
              to="/"
              className="inline-block text-3xl font-bold tracking-tight text-emerald-700 dark:text-emerald-500"
              data-testid="brand-mark"
            >
              CropsIntel
            </Link>
            <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
              The AI agent for almond markets.
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-md">
              Direct, data-driven, opinionated. Ask anything — pricing, supply, demand, freight,
              arbitrage, suppliers, buyers. I'll tell you what I actually think.
            </p>

            <ul className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 mt-0.5">✓</span>
                <span>Live coverage of California, Spain, Australia, India</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 mt-0.5">✓</span>
                <span>USDA NASS, ABC Position Reports, broker desk feeds</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 mt-0.5">✓</span>
                <span>Built for buyers, packers, brokers, analysts</span>
              </li>
            </ul>
          </div>

          <div className="text-sm text-slate-500 dark:text-slate-400">
            Already a user?{' '}
            <Link
              to="/login"
              className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline transition-colors duration-200"
              data-testid="signin-link"
            >
              Sign in →
            </Link>
          </div>
        </aside>

        {/* Right panel — chat */}
        <section className="flex flex-col h-screen min-h-0">
          {/* Mobile header (visible <lg) */}
          <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur">
            <Link
              to="/"
              className="text-lg font-bold text-emerald-700 dark:text-emerald-500"
              data-testid="brand-mark-mobile"
            >
              CropsIntel
            </Link>
            <Link
              to="/login"
              className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline transition-colors duration-200"
            >
              Sign in →
            </Link>
          </header>

          {/* Counter + saved-sessions row */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200/50 dark:border-slate-800/50">
            <InsightCounter count={deepCount} limit={deepLimit} />
            {tier !== 'guest' && (
              <Link
                to="/dashboard"
                className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline transition-colors duration-200"
                data-testid="saved-sessions-link"
              >
                Saved sessions →
              </Link>
            )}
          </div>

          <ChatConversation
            history={history}
            isThinking={chatLoading}
            greeting={DEFAULT_GREETING}
          />

          {/* Composer */}
          <div className="border-t border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur px-4 sm:px-6 py-3 sm:py-4 space-y-3">
            {history.length === 0 && (
              <StarterChips onSelect={handleStarter} disabled={chatLoading} />
            )}

            {error && (
              <p className="text-xs text-rose-600 dark:text-rose-400" data-testid="chat-error">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} className="flex gap-2" data-testid="chat-form">
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask anything about almond markets…"
                disabled={chatLoading}
                data-testid="chat-input"
                autoComplete="off"
                className="flex-1"
              />
              <Button type="submit" disabled={chatLoading || !draft.trim()} data-testid="chat-send">
                Send
              </Button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
