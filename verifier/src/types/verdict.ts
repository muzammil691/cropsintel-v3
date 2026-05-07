// Phase 1.10v — Verdict aggregation types.
//
// Background: prior to this task, verify.ts could write verdict='pass' even
// when an AI judge's `passed` field was null or its judgment text said fail.
// `'inconclusive'` is the explicit third state so null can never be coerced to
// pass. See verifier/src/tests/verdict-resolver.test.ts for the regression
// fixture from phase-1.10b that motivated this.

import type { Gap } from '../types'

export type VerdictValue = 'pass' | 'fail' | 'inconclusive'

// Source tag on a Gap so consumers can distinguish gaps that came directly
// from a judge's structured output from gaps the resolver synthesized by
// reading the judgment text. Synthesized gaps are noisier — keep them
// distinguishable.
export type GapSource =
  | 'judge'
  | 'judgment-synthesis'
  | 'council'
  | 'programmatic'

export interface VerdictGap extends Gap {
  source?: GapSource
}

// Mirror of AIJudgment but with `passed: boolean | null` so null inputs from
// upstream parsers don't get silently coerced. The resolver is the only thing
// that converts null → inconclusive.
export interface JudgeOutput {
  passed: boolean | null
  notes: string
  gaps: VerdictGap[]
  confidence: number
}

export interface VerdictResolution {
  verdict: VerdictValue
  gaps: VerdictGap[]
  reason: string
  // rem3 — count of fail-keyword matches the council parser bucketed as
  // subject-matter rather than verdict (i.e. inside backticks / code blocks /
  // short quotes / task-ids / paths / 40-word post-introducer windows).
  // Surfaced so verifier_runs can monitor the false-positive rate post-fix.
  subjectMatterHits: number
}
