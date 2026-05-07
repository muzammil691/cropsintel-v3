// rem3 — subject-matter immunity tests for parseJudgmentText.
//
// Source spec: .agent/tasks/queued/phase-verifier-parser-subject-matter-immunity.md
// Source ADR : docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-1778161030385.md (rem3)
//
// The deterministic council parser used to flip every cluster-investigation
// ADR's pass-writeup to verdict=fail because the judges' text necessarily used
// `Verifier failures` / `was failing` / etc. as nouns naming the subject
// matter — not as verdicts. These cases pin the immunity rules:
//   1. backtick code spans
//   2. fenced code blocks
//   3. short straight/curly quoted strings (≤120 chars)
//   4. task-id tokens (phase-… / cluster-id-… / verifier-cluster-…)
//   5. file paths (matching the spec-parser FILE_EXT set)
//   6. 40-word post-introducer windows (subject:/topic:/investigat*/diagnos*/root cause)
//
// Plus the new threshold: ≥2 unnegated non-immune fail hits, OR ≥1 unnegated
// non-immune fail hit AND zero pass hits, before flipping to fail.

import { describe, it, expect } from 'vitest'
import { parseJudgmentText } from '../lib/council-parser'

describe('council-parser — subject-matter immunity (rem3)', () => {
  it('1. quoted ADR title containing "Verifier failures" resolves to pass when the rest reads pass', () => {
    const judgeNotes =
      'The agent investigated `Verifier failures` cluster and the implementation passed all checks successfully.'
    const parsed = parseJudgmentText(judgeNotes)
    expect(parsed.verdict).toBe('pass')
    expect(parsed.failHits).toEqual([])
    // The match for `failures` inside the backtick span must be bucketed as
    // subject matter, not silently dropped.
    expect(parsed.subjectMatterHits.length).toBeGreaterThanOrEqual(1)
  })

  it('2. task-id token containing fail-keyword substrings does not flip the verdict', () => {
    // Combines the spec-named example (no fail-keyword inside) with one that
    // does carry a `failed` substring, exercising the task-id mask end-to-end.
    const judgeNotes =
      'The agent shipped phase-1.10af-workflow-quality-gates-fix and ' +
      'phase-1.10b-failed-route-recovery; both task ids contain hyphenated ' +
      'tokens. The build is complete and tests pass.'
    const parsed = parseJudgmentText(judgeNotes)
    expect(parsed.verdict).toBe('pass')
    expect(parsed.failHits).toEqual([])
    expect(parsed.subjectMatterHits.length).toBeGreaterThanOrEqual(1)
    expect(parsed.subjectMatterHits.some(h => /^failed$/i.test(h))).toBe(true)
  })

  it('3. one un-negated `failed` followed by pass keywords resolves to pass (boundary case for new threshold)', () => {
    const judgeNotes =
      'The migration step initially failed but the implementation passed, ' +
      'the build is complete, and the spec is approved.'
    const parsed = parseJudgmentText(judgeNotes)
    expect(parsed.verdict).toBe('pass')
    // The lone fail hit should not bucket as subject matter — it's a real
    // unnegated fail keyword. The threshold is what suppresses the flip.
    expect(parsed.failHits.length).toBe(0) // dropped because triggerFail=false; not exposed
    expect(parsed.passHits.length).toBeGreaterThanOrEqual(3)
  })

  it('4. genuine fail text resolves to fail (regression guard — parser must not become too permissive)', () => {
    const judgeNotes =
      'the implementation failed because the migration is missing the trader_id column'
    const parsed = parseJudgmentText(judgeNotes)
    expect(parsed.verdict).toBe('fail')
    expect(parsed.failHits.length).toBeGreaterThanOrEqual(2)
  })

  it('5. round-trip: rem3 verbatim judges-notes excerpt resolves to pass', () => {
    // Verbatim from gaps[0].actual quoted at
    // docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-1778161030385.md rem3
    // (the o3 + gemini condensed summary that previously triggered the
    // judgment-synthesis-judgment-text-fail loop).
    const judgeNotes =
      'ADR explaining root-cause is provided at the required path and states ' +
      'that no code fix is needed, meeting the 3 acceptance points; follow-up ' +
      'spec is referenced as already present, so criteria for gap is met. / ' +
      'The agent has correctly diagnosed a complex, recursive issue where the ' +
      'Verifier was failing on an investigation task about Verifier failures. ' +
      'The submitted ADR is exceptionally thorough, providing a clear root ' +
      'cause analysis…'
    const parsed = parseJudgmentText(judgeNotes)
    expect(parsed.verdict).toBe('pass')
    expect(parsed.failHits).toEqual([])
    // Both `failing` and `failures` must be bucketed as subject matter — the
    // whole point of the rem3 fix.
    expect(parsed.subjectMatterHits.length).toBeGreaterThanOrEqual(2)
    expect(parsed.subjectMatterHits.some(h => /failing/i.test(h))).toBe(true)
    expect(parsed.subjectMatterHits.some(h => /failures/i.test(h))).toBe(true)
  })

  // ── Defence-in-depth assertions: existing phase-1.10b regression must hold ─
  it('phase-1.10b regression still fails on real fail text', () => {
    // The test fixture from verifier/src/tests/verdict-resolver.test.ts that
    // motivated the council parser in the first place. The new threshold +
    // immunity must not regress it.
    const judgmentText = `
The implementation looks structured and reads cleanly. However, this is a
fail decision because four critical components are missing from the
delivered code: (1) the migration file is absent, (2) the route is not
wired, (3) the e2e test is missing, (4) the type export is deficient.
`.trim()
    const parsed = parseJudgmentText(judgmentText)
    expect(parsed.verdict).toBe('fail')
    expect(parsed.failHits.length).toBeGreaterThanOrEqual(2)
  })
})
