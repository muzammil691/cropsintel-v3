export interface TaskSpec {
  id: string
  filesRequired: string[]
  componentsRequired: string[]
  migrationsRequired: { tablesCreated: string[]; functionsCreated: string[] }
  routesRequired: string[]
  testsRequired: string[]
  acceptanceCriteria: string[]
  outOfScope: string[]
  rawMarkdown: string
}

export interface Gap {
  check: string
  severity: 'fail' | 'warn'
  expected: string
  actual: string
  remediation: string
}

export interface VerificationResult {
  taskId: string
  passed: boolean
  gaps: Gap[]
  durationMs: number
  judgmentCallNotes: string
}

export interface AIJudgment {
  passed: boolean
  gaps: Gap[]
  notes: string
  confidence: number
}

export interface CouncilTiebreak {
  finalDecision: string
  passes: boolean
  gaps: Gap[]
}
