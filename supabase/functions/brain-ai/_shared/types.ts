// Phase 1.10aa — shared types for brain-ai edge function.

export type BrainProvider = 'claude' | 'openai' | 'gemini' | 'consensus' | 'human'

export type BrainMessageType =
  | 'prompt'
  | 'comment'
  | 'ai_analysis'
  | 'consensus'
  | 'decision'

export interface BrainOpinion {
  provider: 'claude' | 'openai' | 'gemini'
  model: string
  content: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  error?: string
}

export interface BrainConsensus {
  provider: 'consensus'
  model: string
  content: string
  verdict: string
  scoreDelta: number
  scoreReason: string
  specReadyPrompt: string | null
  costUsd: number
  inputTokens: number
  outputTokens: number
  durationMs: number
}

export interface BrainNode {
  id: string
  node_key: string
  label: string
  description: string | null
  category: string | null
  status: string
  score: number
  metadata: Record<string, unknown>
}

export interface DebateRequest {
  action: 'debate'
  node_id: string
  prompt: string
  context?: string
}

export interface ConsensusRerunRequest {
  action: 'consensus'
  node_id: string
  thread_id: string
}

export type BrainAiRequest = DebateRequest | ConsensusRerunRequest
