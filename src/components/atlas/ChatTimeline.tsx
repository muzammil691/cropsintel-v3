// Phase 1.10ar — horizontal scrollable timeline of chat summary chips.
//
// One chip per atlas_chat_summaries row. Click a chip → notify the parent
// cockpit so it can scroll the message list to range_start_msg_id and stash
// a replay-context flag in localStorage that the next /atlas/chat call
// includes so Atlas knows what segment the user is referencing.
//
// Empty state: hide the bar entirely (no clutter on first conversation).

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchChatSummaries, type ChatSummary } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface ChatTimelineProps {
  threadId: string
  onChipClick: (summary: ChatSummary) => void
}

const REFETCH_INTERVAL_MS = 5 * 60 * 1000

export function ChatTimeline({ threadId, onChipClick }: ChatTimelineProps) {
  const [summaries, setSummaries] = useState<ChatSummary[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const refetch = useCallback(async () => {
    try {
      const data = await fetchChatSummaries(threadId, 30)
      // API returns DESC by range_end_at → reverse so chips render oldest → newest left-to-right.
      setSummaries([...data].reverse())
    } catch {
      // Silent failure — empty state is the natural fallback.
    }
  }, [threadId])

  useEffect(() => {
    void refetch()
    const t = window.setInterval(refetch, REFETCH_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [refetch])

  // Listen for the same broadcast the chat handler emits when a new summary
  // is created server-side (currently emitted via Supabase Realtime + a
  // cross-component CustomEvent — fallback path for cases where realtime is
  // disabled).
  useEffect(() => {
    function handler() { void refetch() }
    window.addEventListener('atlas:chat-summary-created', handler)
    return () => window.removeEventListener('atlas:chat-summary-created', handler)
  }, [refetch])

  // Translate vertical wheel into horizontal scroll so trackpad users can
  // pan the bar without holding shift.
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY
    }
  }

  if (summaries.length === 0) return null

  return (
    <div
      className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/30 shrink-0"
      role="region"
      aria-label="Conversation timeline"
    >
      <div
        ref={scrollRef}
        onWheel={onWheel}
        className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 scrollbar-thin"
        style={{ scrollbarWidth: 'thin' }}
      >
        {summaries.map((s) => (
          <TimelineChip key={s.id} summary={s} onClick={() => onChipClick(s)} />
        ))}
        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400 ml-1">
          <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          now
        </span>
      </div>
    </div>
  )
}

function TimelineChip({
  summary,
  onClick,
}: {
  summary: ChatSummary
  onClick: () => void
}) {
  const time = new Date(summary.range_end_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const label = truncate(summary.summary_short, 30)
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${summary.summary_short}${summary.topics.length > 0 ? `\n\nTopics: ${summary.topics.join(', ')}` : ''}`}
      className={cn(
        'shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border',
        'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
        'hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
      )}
    >
      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">{time}</span>
      <span className="text-slate-700 dark:text-slate-200 truncate max-w-[180px]">{label}</span>
    </button>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
