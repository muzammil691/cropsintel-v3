// Phase 1.10ab — DebateMessageCard
//
// Single colored card per debate author. Per-spec author tokens:
//   Claude → purple-600, GPT/openai → emerald-600, Gemini → blue-600,
//   Consensus → amber-500, human prompt → slate.

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type AuthorKind = 'human' | 'claude' | 'openai' | 'gpt' | 'gemini' | 'consensus'

export interface DebateMessageCardProps {
  author: AuthorKind
  model?: string
  content: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  verdict?: string
  scoreDelta?: number
  scoreReason?: string
  error?: string | null
  createdAt?: string
}

interface AuthorMeta {
  label: string
  dot: string
  gutter: string
  badge: string
}

function authorMeta(author: AuthorKind): AuthorMeta {
  switch (author) {
    case 'claude':
      return {
        label: 'Claude',
        dot: 'bg-purple-600',
        gutter: 'border-l-4 border-purple-600',
        badge: 'text-purple-700 dark:text-purple-300',
      }
    case 'openai':
    case 'gpt':
      return {
        label: 'GPT-4o',
        dot: 'bg-emerald-600',
        gutter: 'border-l-4 border-emerald-600',
        badge: 'text-emerald-700 dark:text-emerald-300',
      }
    case 'gemini':
      return {
        label: 'Gemini',
        dot: 'bg-blue-600',
        gutter: 'border-l-4 border-blue-600',
        badge: 'text-blue-700 dark:text-blue-300',
      }
    case 'consensus':
      return {
        label: 'Consensus',
        dot: 'bg-amber-500',
        gutter: 'border-l-4 border-amber-500',
        badge: 'text-amber-700 dark:text-amber-300',
      }
    case 'human':
    default:
      return {
        label: 'You',
        dot: 'bg-slate-500',
        gutter: 'border-l-4 border-slate-400 dark:border-slate-600',
        badge: 'text-slate-600 dark:text-slate-400',
      }
  }
}

export function DebateMessageCard({
  author,
  model,
  content,
  costUsd,
  inputTokens,
  outputTokens,
  durationMs,
  verdict,
  scoreDelta,
  scoreReason,
  error,
  createdAt,
}: DebateMessageCardProps) {
  const meta = authorMeta(author)
  const [expanded, setExpanded] = useState(false)
  const isConsensus = author === 'consensus'

  return (
    <article
      className={cn(
        'rounded-md bg-white dark:bg-slate-950 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200',
        meta.gutter,
      )}
      aria-label={`${meta.label} message`}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-900">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('inline-block size-2 rounded-full', meta.dot)} aria-hidden />
          <span className={cn('text-xs font-semibold', meta.badge)}>{meta.label}</span>
          {model && (
            <span className="text-[10px] text-slate-400 truncate">{model}</span>
          )}
        </div>
        {createdAt && (
          <time className="text-[10px] text-slate-400 shrink-0" dateTime={createdAt}>
            {new Date(createdAt).toLocaleTimeString()}
          </time>
        )}
      </header>

      <div className="px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
        {error ? (
          <p className="text-red-600 dark:text-red-400 text-xs">[error: {error}]</p>
        ) : isConsensus && verdict ? (
          <>
            <p className="font-medium mb-1">{verdict}</p>
            {scoreDelta != null && scoreDelta !== 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-1">
                Score change: {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}
              </p>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline-offset-2 hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? 'Hide reasoning' : 'Why this score?'}
            </button>
            {expanded && (
              <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-900 space-y-2">
                {scoreReason && (
                  <p className="text-xs text-slate-600 dark:text-slate-400">{scoreReason}</p>
                )}
                <p className="text-[11px] text-slate-500 whitespace-pre-wrap">{content}</p>
              </div>
            )}
          </>
        ) : (
          <p>{content}</p>
        )}
      </div>

      {(costUsd != null || inputTokens != null || outputTokens != null || durationMs != null) && (
        <footer className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-900/40 rounded-b-md tabular-nums">
          {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
          {inputTokens != null && <span>{inputTokens} in</span>}
          {outputTokens != null && <span>{outputTokens} out</span>}
          {durationMs != null && <span>{(durationMs / 1000).toFixed(1)}s</span>}
        </footer>
      )}
    </article>
  )
}
