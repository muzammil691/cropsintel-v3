// Phase 1.10ab — BrainNodeDetail
//
// Right pane: node header (label + score + sparkline + delta), action row
// (Run Multi-Brain / Re-Consensus / Manual Adjust), and the streaming/
// persisted debate thread.

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  listDiscussionsByNode,
  type BrainDiscussion,
  type BrainNode,
} from '@/lib/brain-client'
import { useBrainDebate } from '@/hooks/useBrainDebate'
import { useBrainHistory } from '@/hooks/useBrainHistory'
import { BrainScoreBadge } from './BrainScoreBadge'
import { BrainScoreSparkline } from './BrainScoreSparkline'
import { DebateThread } from './DebateThread'
import { RunDebateButton } from './RunDebateButton'
import { ScoreAdjustDialog } from './ScoreAdjustDialog'

export interface BrainNodeDetailProps {
  node: BrainNode | null
  onScoreAdjust: (newScore: number, reason: string) => Promise<void>
  onAfterDebate: (lastThreadId: string | null) => void
  budgetExhausted: boolean
}

export function BrainNodeDetail({ node, onScoreAdjust, onAfterDebate, budgetExhausted }: BrainNodeDetailProps) {
  const debate = useBrainDebate()
  const { history, refresh: refreshHistory } = useBrainHistory(node?.id ?? null)
  const [persisted, setPersisted] = useState<BrainDiscussion[]>([])
  const [persistedLoading, setPersistedLoading] = useState(false)
  const [persistedError, setPersistedError] = useState<string | null>(null)
  const [latestThreadId, setLatestThreadId] = useState<string | null>(null)

  // Reset live debate state on node change.
  useEffect(() => {
    debate.reset()
    setPersisted([])
    setLatestThreadId(null)
    if (!node) return
    setPersistedLoading(true)
    setPersistedError(null)
    listDiscussionsByNode(node.id, 200)
      .then((rows) => {
        setPersisted(rows)
        // Find latest thread_id (most recent created_at in the list)
        const last = rows[rows.length - 1]
        setLatestThreadId(last?.thread_id ?? null)
      })
      .catch((e) => setPersistedError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPersistedLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id])

  // After a fresh debate completes, refresh persisted thread + history + costs
  useEffect(() => {
    if (!node) return
    if (debate.phase !== 'done' || !debate.threadId) return
    setLatestThreadId(debate.threadId)
    listDiscussionsByNode(node.id, 200)
      .then(setPersisted)
      .catch(() => {})
    void refreshHistory()
    onAfterDebate(debate.threadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debate.phase, debate.threadId])

  const lastDelta = useMemo(() => {
    if (debate.scoreChange) return debate.scoreChange.after - debate.scoreChange.before
    if (history.length === 0) return null
    const last = history[history.length - 1]
    if (last.score_after == null || last.score_before == null) return null
    return Math.round(last.score_after - last.score_before)
  }, [debate.scoreChange, history])

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-slate-500 italic">
        Select a brain node to see its detail.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{node.label}</h2>
            <p className="text-[11px] text-slate-500 truncate">{node.node_key}</p>
            {node.description && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">{node.description}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <BrainScoreBadge score={node.score} size="lg" delta={lastDelta} />
            <p className="text-[10px] text-slate-400 mt-1">/ 100</p>
          </div>
        </div>

        <BrainScoreSparkline history={history} currentScore={node.score} />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <RunDebateButton
              busy={debate.phase === 'streaming'}
              disabled={budgetExhausted}
              onSubmit={(prompt, context) => debate.run({ nodeId: node.id, nodeKey: node.node_key, prompt, context })}
              nodeLabel={node.label}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={budgetExhausted || debate.phase === 'streaming' || !latestThreadId}
              onClick={() => latestThreadId && debate.rerun({ nodeId: node.id, nodeKey: node.node_key, threadId: latestThreadId })}
              title={latestThreadId ? 'Re-judge the latest thread with consensus' : 'No thread to re-judge yet'}
            >
              {debate.phase === 'streaming' ? (
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}{' '}
              Re-Consensus
            </Button>
            <ScoreAdjustDialog
              currentScore={node.score}
              nodeLabel={node.label}
              disabled={debate.phase === 'streaming'}
              onSubmit={onScoreAdjust}
            />
          </div>
          {budgetExhausted && (
            <p className="text-[11px] text-red-600 dark:text-red-400">Monthly AI cap reached — debates paused.</p>
          )}
        </div>

        {debate.error && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {debate.error}
          </p>
        )}
        {persistedError && !debate.error && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {persistedError}
          </p>
        )}
      </header>

      <div className="flex-1 min-h-0 p-3">
        {persistedLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-md bg-slate-100 dark:bg-slate-900 animate-pulse" />
            ))}
          </div>
        ) : (
          <DebateThread
            persisted={persisted}
            liveOpinions={debate.opinions}
            liveConsensus={debate.consensus}
            phase={debate.phase}
            livePrompt={debate.phase === 'streaming' || debate.phase === 'done' ? null : null}
          />
        )}
      </div>
    </div>
  )
}
