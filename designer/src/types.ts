export interface DesignGap {
  check: string
  severity: 'high' | 'medium' | 'low'
  description: string
  fix: string
  file?: string
  line?: number
}

export type Verdict = 'pass' | 'fail' | 'unknown'

export interface AIBrainResult {
  verdict: Verdict
  reasoning: string
  gaps: DesignGap[]
  confidence: number
  costUsd: number
}

export interface DesignerReview {
  taskId: string
  operation: 'review-spec' | 'audit-commit'
  verdict: Verdict
  confidence: number
  gaps: DesignGap[]
  aiJudgment: {
    claude?: AIBrainResult
    gptVision?: AIBrainResult
  }
  costUsd: number
  durationMs: number
}

export interface ChangedFile {
  path: string
  contents: string
}

export interface DesignSystem {
  rawMarkdown: string
}
