export type AIProvider = 'claude' | 'gpt' | 'gemini'

export type CouncilMode = 'cli' | 'auto-task-writer' | 'runtime'
export type CouncilDepth = 'quick' | 'deep'

export interface CouncilInput {
  question: string
  context?: Record<string, unknown>
  mode: CouncilMode
  depth: CouncilDepth
  invokedBy?: string
}

// ─── Provider response ────────────────────────────────────────────────

export interface ProviderResponse {
  provider: AIProvider
  content: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  durationMs: number
  timedOut?: boolean
}

// ─── Quick mode ───────────────────────────────────────────────────────

export interface JudgeResponse {
  synthesis: string
  confidence: number
  reasoning: string
  costUsd: number
  durationMs: number
}

export interface QuickTrace {
  claude: ProviderResponse | null
  gpt: ProviderResponse | null
  gemini: ProviderResponse | null
  judge: JudgeResponse
}

// ─── Deep mode ────────────────────────────────────────────────────────

export interface PairTurn {
  speaker: AIProvider
  content: string
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export interface ReviewerOutput {
  strengths: string[]
  weaknesses: string[]
  blindspots: string[]
  alternatives_to_consider: string[]
  overall_quality_score: number
  detailed_critique: string
  costUsd: number
  durationMs: number
}

export interface PairSession {
  pair: [AIProvider, AIProvider]
  reviewer: AIProvider
  dialogue: PairTurn[]
  solution: string
  review: ReviewerOutput
  totalCostUsd: number
  durationMs: number
}

export interface TriCouncilRound {
  [provider: string]: {
    favoriteSolution: string
    reasoning: string
    commonGround: string
    disagreements: string
    proposedSynthesis: string
  }
}

export interface TriCouncilResult {
  rounds: TriCouncilRound[]
  decision: string
  confidence: number
  convergedAt: number
  usedTiebreaker: boolean
  tiebreakerOutput?: string
  totalCostUsd: number
  durationMs: number
}

export interface ValidationResult {
  provider: AIProvider
  findings: string
  technicalAssumptions: string[]
  knownAntiPatterns: string[]
  suggestedRefinements: string[]
  costUsd: number
  durationMs: number
}

export interface DeepTrace {
  pairSessions: [PairSession, PairSession, PairSession]
  triCouncil: TriCouncilResult
  validation: [ValidationResult, ValidationResult, ValidationResult]
}

// ─── Output ───────────────────────────────────────────────────────────

export interface CouncilOutput {
  finalDecision: string
  confidence: number
  costUsd: number
  durationMs: number
  depth: CouncilDepth
  trace: QuickTrace | DeepTrace
  runId: string
  adrMarkdown: string
}

// ─── Pair session input ───────────────────────────────────────────────

export interface PairSessionInput {
  pair: [AIProvider, AIProvider]
  reviewer: AIProvider
  question: string
  context?: Record<string, unknown>
  maxTurns: number
}

export interface TriCouncilInput {
  sessions: [PairSession, PairSession, PairSession]
  maxNegotiationRounds: number
  question: string
  context?: Record<string, unknown>
}
