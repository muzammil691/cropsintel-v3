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

// Phase 1.10v: `verdict` is the canonical pass/fail/inconclusive value;
// `passed` is preserved for backwards compatibility (passed = verdict === 'pass').
// Inconclusive runs return passed=false so the gate blocks them by default —
// downstream consumers that need the three-state distinction read `verdict`.
export interface VerificationResult {
  taskId: string
  passed: boolean
  verdict: 'pass' | 'fail' | 'inconclusive'
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
