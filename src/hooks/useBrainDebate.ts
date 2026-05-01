// Phase 1.10ab — useBrainDebate
//
// Manages the local state of a streaming Multi-Brain debate:
//   - thread_id once the server allocates it
//   - per-author opinions as they arrive
//   - consensus when judging completes
//   - score_updated event for the score badge to react to
//   - error message if the stream fails or rate-limits

import { useCallback, useRef, useState } from 'react'
import {
  rerunConsensus,
  startDebate,
  type BrainConsensusEvent,
  type BrainOpinionEvent,
} from '@/lib/brain-client'
import { drAtlas } from '@/lib/drAtlas'

export type DebatePhase = 'idle' | 'streaming' | 'done' | 'error'

export type DebateOpinion = BrainOpinionEvent['opinion']
export type DebateConsensus = BrainConsensusEvent['consensus']

export interface UseBrainDebateResult {
  phase: DebatePhase
  threadId: string | null
  opinions: DebateOpinion[]
  consensus: DebateConsensus | null
  scoreChange: { before: number; after: number } | null
  error: string | null
  startedAt: number | null
  reset: () => void
  run: (args: { nodeId: string; nodeKey: string; prompt: string; context?: string }) => Promise<void>
  rerun: (args: { nodeId: string; nodeKey: string; threadId: string }) => Promise<void>
  cancel: () => void
}

export function useBrainDebate(): UseBrainDebateResult {
  const [phase, setPhase] = useState<DebatePhase>('idle')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [opinions, setOpinions] = useState<DebateOpinion[]>([])
  const [consensus, setConsensus] = useState<DebateConsensus | null>(null)
  const [scoreChange, setScoreChange] = useState<{ before: number; after: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    setPhase('idle')
    setThreadId(null)
    setOpinions([])
    setConsensus(null)
    setScoreChange(null)
    setError(null)
    setStartedAt(null)
  }, [])

  const cancel = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    if (phase === 'streaming') setPhase('idle')
  }, [phase])

  const run: UseBrainDebateResult['run'] = useCallback(async ({ nodeId, nodeKey, prompt, context }) => {
    reset()
    setPhase('streaming')
    setStartedAt(Date.now())
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    try {
      await startDebate(nodeId, prompt, context, {
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.type === 'thread_started') setThreadId(e.thread_id)
          else if (e.type === 'opinion_received') setOpinions((prev) => [...prev, e.opinion])
          else if (e.type === 'consensus_received') setConsensus(e.consensus)
          else if (e.type === 'score_updated') setScoreChange({ before: e.before, after: e.after })
          else if (e.type === 'error') {
            setError(e.message)
            setPhase('error')
          }
        },
      })
      setPhase((p) => (p === 'error' ? 'error' : 'done'))
      drAtlas.multi_brain('debate', nodeKey, true, ['claude', 'openai', 'gemini'])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('aborted')) {
        setPhase('idle')
        return
      }
      setError(msg)
      setPhase('error')
      drAtlas.multi_brain('debate', nodeKey, false, ['claude', 'openai', 'gemini'])
    } finally {
      ctrlRef.current = null
    }
  }, [reset])

  const rerun: UseBrainDebateResult['rerun'] = useCallback(async ({ nodeId, nodeKey, threadId: tid }) => {
    reset()
    setPhase('streaming')
    setThreadId(tid)
    setStartedAt(Date.now())
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    try {
      await rerunConsensus(nodeId, tid, {
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.type === 'opinion_received') setOpinions((prev) => [...prev, e.opinion])
          else if (e.type === 'consensus_received') setConsensus(e.consensus)
          else if (e.type === 'score_updated') setScoreChange({ before: e.before, after: e.after })
          else if (e.type === 'error') {
            setError(e.message)
            setPhase('error')
          }
        },
      })
      setPhase((p) => (p === 'error' ? 'error' : 'done'))
      drAtlas.multi_brain('consensus', nodeKey, true, ['openai'])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('aborted')) {
        setPhase('idle')
        return
      }
      setError(msg)
      setPhase('error')
      drAtlas.multi_brain('consensus', nodeKey, false, ['openai'])
    } finally {
      ctrlRef.current = null
    }
  }, [reset])

  return {
    phase,
    threadId,
    opinions,
    consensus,
    scoreChange,
    error,
    startedAt,
    reset,
    run,
    rerun,
    cancel,
  }
}
