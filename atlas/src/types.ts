export type TrustMode = 'passive' | 'chat' | 'confirm' | 'auto' | 'stopped'

export interface Snapshot {
  takenAt: string
  currentPhase: string | null
  queuedSpecs: number
  inFlightSpecs: number
  doneSpecs24h: number
  failedSpecs24h: number
}
