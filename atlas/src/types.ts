export type TrustMode = 'passive' | 'chat' | 'confirm' | 'auto' | 'stopped'

export interface Snapshot {
  takenAt: string
  currentPhase: string | null
  queuedSpecs: number
  inFlightSpecs: number
  doneSpecs24h: number
  failedSpecs24h: number
}

export interface ToolDispatchVerification {
  verified: boolean
  evidence: Record<string, unknown>
  error?: string
}

export interface ToolDispatchResult {
  dispatchId: string
  status: 'success' | 'failed' | 'blocked' | 'partial'
  result?: unknown
  error?: string
  durationMs: number
  verified?: ToolDispatchVerification | null
}
