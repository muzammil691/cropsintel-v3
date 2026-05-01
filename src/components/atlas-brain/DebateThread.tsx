// Phase 1.10ab — DebateThread
//
// Renders a chronological multi-author thread (human prompt + 3 opinions +
// consensus). Implements autoscroll-with-grab semantics: while new messages
// arrive, scroll to bottom; if user scrolls up, freeze; resuming bottom
// re-arms autoscroll. Per Replit AI Modify pattern (see research doc).

import { useEffect, useRef, useState } from 'react'
import type { BrainDiscussion } from '@/lib/brain-client'
import type { DebateConsensus, DebateOpinion, DebatePhase } from '@/hooks/useBrainDebate'
import { DebateMessageCard } from './DebateMessageCard'
import { cn } from '@/lib/utils'

export interface DebateThreadProps {
  /** Most-recent thread loaded from DB (history). */
  persisted: BrainDiscussion[]
  /** Live opinions arriving via SSE (override / extend persisted). */
  liveOpinions: DebateOpinion[]
  /** Live consensus arriving via SSE. */
  liveConsensus: DebateConsensus | null
  phase: DebatePhase
  livePrompt?: string | null
  emptyMessage?: string
}

const MAX_VISIBLE = 20

export function DebateThread({
  persisted,
  liveOpinions,
  liveConsensus,
  phase,
  livePrompt,
  emptyMessage = 'No debate yet — click Run Multi-Brain to start one.',
}: DebateThreadProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [autoscroll, setAutoscroll] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // Build the unified message list for render. If there's a live debate
  // (live prompt or live opinions), prefer the live state; otherwise show
  // the persisted thread.
  const live = !!livePrompt || liveOpinions.length > 0 || liveConsensus != null
  const all = live
    ? buildLiveMessages(livePrompt, liveOpinions, liveConsensus)
    : persisted

  const truncated = !showAll && all.length > MAX_VISIBLE
  const visible = truncated ? all.slice(-MAX_VISIBLE) : all
  const hiddenCount = all.length - visible.length

  // Autoscroll on new content if user hasn't scrolled away
  useEffect(() => {
    if (!autoscroll) return
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible.length, liveConsensus, autoscroll])

  // Detect user grab/release
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      setAutoscroll(atBottom)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  if (all.length === 0 && phase !== 'streaming') {
    return (
      <div className="flex items-center justify-center h-full text-xs text-slate-500 italic">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-1 space-y-2">
        {hiddenCount > 0 && (
          <div className="text-center py-1">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline-offset-2 hover:underline"
            >
              Load {hiddenCount} older message{hiddenCount === 1 ? '' : 's'}
            </button>
          </div>
        )}
        {visible.map((m, i) => renderMessage(m, i))}
        {phase === 'streaming' && <StreamingIndicator received={liveOpinions.map((o) => o.provider)} hasConsensus={!!liveConsensus} />}
      </div>
    </div>
  )
}

type Renderable =
  | { kind: 'persisted'; row: BrainDiscussion }
  | { kind: 'live-prompt'; content: string }
  | { kind: 'live-opinion'; opinion: DebateOpinion }
  | { kind: 'live-consensus'; consensus: DebateConsensus }

function buildLiveMessages(
  prompt: string | null | undefined,
  opinions: DebateOpinion[],
  consensus: DebateConsensus | null,
): Renderable[] {
  const out: Renderable[] = []
  if (prompt) out.push({ kind: 'live-prompt', content: prompt })
  for (const o of opinions) out.push({ kind: 'live-opinion', opinion: o })
  if (consensus) out.push({ kind: 'live-consensus', consensus })
  return out
}

function renderMessage(m: Renderable | BrainDiscussion, i: number) {
  if ('kind' in m) {
    if (m.kind === 'live-prompt') {
      return (
        <DebateMessageCard
          key={`live-prompt-${i}`}
          author="human"
          content={m.content}
        />
      )
    }
    if (m.kind === 'live-opinion') {
      const op = m.opinion
      return (
        <DebateMessageCard
          key={`live-op-${op.provider}-${i}`}
          author={op.provider}
          model={op.model}
          content={op.content}
          costUsd={op.costUsd}
          inputTokens={op.inputTokens}
          outputTokens={op.outputTokens}
          durationMs={op.durationMs}
          error={op.error}
        />
      )
    }
    if (m.kind === 'live-consensus') {
      const c = m.consensus
      return (
        <DebateMessageCard
          key={`live-consensus-${i}`}
          author="consensus"
          model={c.model}
          content={c.content}
          verdict={c.verdict}
          scoreDelta={c.scoreDelta}
          scoreReason={c.scoreReason}
          costUsd={c.costUsd}
          inputTokens={c.inputTokens}
          outputTokens={c.outputTokens}
          durationMs={c.durationMs}
        />
      )
    }
    return null
  }
  // persisted BrainDiscussion
  const row = m
  const meta = row.metadata as Record<string, unknown>
  return (
    <DebateMessageCard
      key={row.id}
      author={row.author}
      model={typeof meta.model === 'string' ? meta.model : undefined}
      content={row.content}
      costUsd={Number(row.cost_usd ?? 0)}
      inputTokens={typeof meta.input_tokens === 'number' ? meta.input_tokens : undefined}
      outputTokens={typeof meta.output_tokens === 'number' ? meta.output_tokens : undefined}
      durationMs={typeof meta.duration_ms === 'number' ? meta.duration_ms : undefined}
      verdict={typeof meta.verdict === 'string' ? meta.verdict : undefined}
      scoreDelta={typeof meta.score_delta === 'number' ? meta.score_delta : undefined}
      scoreReason={typeof meta.score_reason === 'string' ? meta.score_reason : undefined}
      error={typeof meta.error === 'string' ? meta.error : undefined}
      createdAt={row.created_at}
    />
  )
}

function StreamingIndicator({ received, hasConsensus }: { received: string[]; hasConsensus: boolean }) {
  const dot = (provider: 'claude' | 'openai' | 'gemini' | 'consensus', label: string, color: string) => {
    const got = provider === 'consensus' ? hasConsensus : received.includes(provider)
    return (
      <span
        key={provider}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium',
          got ? 'opacity-100' : 'opacity-40',
        )}
      >
        <span className={cn('size-1.5 rounded-full', color, !got && 'motion-safe:animate-pulse')} />
        {label}
      </span>
    )
  }
  return (
    <div
      className="flex items-center justify-center gap-1 py-2 text-slate-500"
      role="status"
      aria-live="polite"
    >
      <span className="text-[11px] mr-1">Atlas is thinking…</span>
      {dot('claude', 'Claude', 'bg-purple-600')}
      {dot('openai', 'GPT', 'bg-emerald-600')}
      {dot('gemini', 'Gemini', 'bg-blue-600')}
      {dot('consensus', 'Consensus', 'bg-amber-500')}
    </div>
  )
}
