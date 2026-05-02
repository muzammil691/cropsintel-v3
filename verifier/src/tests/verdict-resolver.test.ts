import { describe, it, expect } from 'vitest'
import { resolveVerdict } from '../lib/verdict-resolver'
import { parseJudgmentText } from '../lib/council-parser'
import { buildSynthesizedGaps, ensureFailGap } from '../lib/gaps-builder'
import type { JudgeOutput, VerdictGap } from '../types/verdict'

function judge(overrides: Partial<JudgeOutput> = {}): JudgeOutput {
  return {
    passed: true,
    notes: 'Implementation satisfies the spec.',
    gaps: [],
    confidence: 90,
    ...overrides,
  }
}

function gap(overrides: Partial<VerdictGap> = {}): VerdictGap {
  return {
    check: 'sample',
    severity: 'fail',
    expected: 'something',
    actual: 'something else',
    remediation: 'fix it',
    ...overrides,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// council-parser
// ────────────────────────────────────────────────────────────────────────────

describe('parseJudgmentText', () => {
  it('returns inconclusive for empty input', () => {
    expect(parseJudgmentText('').verdict).toBe('inconclusive')
    expect(parseJudgmentText(null).verdict).toBe('inconclusive')
    expect(parseJudgmentText(undefined).verdict).toBe('inconclusive')
    expect(parseJudgmentText('   \n  ').verdict).toBe('inconclusive')
  })

  it('detects fail keywords (fail, missing, absent, deficien)', () => {
    expect(parseJudgmentText('this is a fail decision').verdict).toBe('fail')
    expect(parseJudgmentText('component is missing critical wiring').verdict).toBe('fail')
    expect(parseJudgmentText('the export is absent from the index').verdict).toBe('fail')
    expect(parseJudgmentText('handling is deficient for null inputs').verdict).toBe('fail')
  })

  it('does not flag negated fail keywords as fail', () => {
    expect(parseJudgmentText('no fail conditions found').verdict).not.toBe('fail')
    expect(parseJudgmentText('not missing any required components').verdict).not.toBe('fail')
    expect(parseJudgmentText('without any deficiencies in coverage').verdict).not.toBe('fail')
    expect(parseJudgmentText('isn\'t failing any acceptance criteria').verdict).not.toBe('fail')
  })

  it('returns pass when only pass keywords appear', () => {
    expect(parseJudgmentText('all checks passed successfully').verdict).toBe('pass')
    expect(parseJudgmentText('the implementation satisfies the spec').verdict).toBe('pass')
  })

  it('regression: phase-1.10b judgment text returns fail', () => {
    // Excerpt resembling the original phase-1.10b fixture: positive framing
    // followed by a clear fail conclusion + listed missing components.
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

  it('does not call any LLM (no network)', () => {
    // The parser is regex-only; calling it 1000× is essentially free.
    // If somehow an LLM client got imported it would error here without a key.
    for (let i = 0; i < 1000; i++) {
      parseJudgmentText('quick smoke test for performance and side-effects')
    }
    expect(true).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// gaps-builder
// ────────────────────────────────────────────────────────────────────────────

describe('buildSynthesizedGaps + ensureFailGap', () => {
  it('synthesizes a fail gap tagged source=judgment-synthesis', () => {
    const synth = buildSynthesizedGaps({
      reason: 'agreement-fail-empty-gaps',
      judgeNotes: ['both judges said fail but gave no gaps'],
    })
    expect(synth).toHaveLength(1)
    expect(synth[0].severity).toBe('fail')
    expect(synth[0].source).toBe('judgment-synthesis')
    expect(synth[0].check).toContain('judgment-synthesis')
  })

  it('synthesizes a warn gap for inconclusive', () => {
    const synth = buildSynthesizedGaps({
      reason: 'inconclusive',
      judgeNotes: ['judges disagreed'],
    })
    expect(synth[0].severity).toBe('warn')
    expect(synth[0].source).toBe('judgment-synthesis')
  })

  it('ensureFailGap leaves existing fail gaps untouched', () => {
    const existing = [gap({ severity: 'fail', check: 'real-judge-gap' })]
    const result = ensureFailGap(existing, {
      reason: 'agreement-fail-empty-gaps',
      judgeNotes: [''],
    })
    expect(result).toHaveLength(1)
    expect(result[0].check).toBe('real-judge-gap')
  })

  it('ensureFailGap synthesizes when no fail gaps exist', () => {
    const result = ensureFailGap([], {
      reason: 'agreement-fail-empty-gaps',
      judgeNotes: ['empty'],
    })
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('fail')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// resolveVerdict — six required scenarios
// ────────────────────────────────────────────────────────────────────────────

describe('resolveVerdict', () => {
  it('all-pass: both judges pass → verdict=pass, no gaps', () => {
    const r = resolveVerdict(
      judge({ passed: true, notes: 'all checks passed' }),
      judge({ passed: true, notes: 'spec satisfied successfully' }),
    )
    expect(r.verdict).toBe('pass')
    expect(r.gaps).toEqual([])
  })

  it('all-fail: both judges fail with gaps → verdict=fail, gaps populated', () => {
    const r = resolveVerdict(
      judge({
        passed: false,
        notes: 'critical fail in routing',
        gaps: [gap({ check: 'o3-judgment', actual: 'route missing' })],
      }),
      judge({
        passed: false,
        notes: 'fail — migration absent',
        gaps: [gap({ check: 'gemini-judgment', actual: 'migration file not found' })],
      }),
    )
    expect(r.verdict).toBe('fail')
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(r.gaps.some(g => g.severity === 'fail')).toBe(true)
  })

  it('disagree-fail-wins: o3=true, gemini=false → verdict=fail (judgment text says fail)', () => {
    const r = resolveVerdict(
      judge({ passed: true, notes: 'looks fine to me' }),
      judge({
        passed: false,
        notes: 'fail decision — components missing',
        gaps: [gap({ check: 'gemini-judgment' })],
      }),
    )
    expect(r.verdict).toBe('fail')
    expect(r.gaps.length).toBeGreaterThan(0)
  })

  it('disagree-pass-wins: booleans disagree, both texts read as pass → verdict=pass', () => {
    const r = resolveVerdict(
      // o3 boolean says true, plain pass language
      judge({ passed: true, notes: 'all checks passed successfully' }),
      // gemini boolean spuriously false but text agrees with pass
      judge({ passed: false, notes: 'implementation satisfies all acceptance criteria', gaps: [] }),
    )
    expect(r.verdict).toBe('pass')
  })

  it('null-coercion-blocked: passed=null + notes say fail → verdict=fail (NEVER pass)', () => {
    // The phase-1.10b root cause: passed was effectively null/missing while
    // judgment text said fail. The pre-fix code coerced this to pass.
    const r = resolveVerdict(
      judge({ passed: null, notes: 'this is a fail decision; missing route, missing migration, missing test, deficient types' }),
      judge({ passed: null, notes: 'fail — at least 4 components missing' }),
    )
    expect(r.verdict).toBe('fail')
    expect(r.verdict).not.toBe('pass')
    expect(r.gaps.some(g => g.severity === 'fail')).toBe(true)
  })

  it('inconclusive: booleans disagree, neither text decisive → verdict=inconclusive (NEVER pass)', () => {
    const r = resolveVerdict(
      judge({ passed: null, notes: '' }),
      judge({ passed: null, notes: 'unable to determine; insufficient context' }),
    )
    expect(r.verdict).toBe('inconclusive')
    expect(r.verdict).not.toBe('pass')
    // Inconclusive must still emit at least one gap so consumers see the signal
    expect(r.gaps.length).toBeGreaterThan(0)
  })

  it('agreement-fail with empty gaps[] is rescued by synthesis', () => {
    const r = resolveVerdict(
      judge({ passed: false, notes: 'fail — but I forgot to include gaps', gaps: [] }),
      judge({ passed: false, notes: 'definite fail with no structured gaps', gaps: [] }),
    )
    expect(r.verdict).toBe('fail')
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(r.gaps.some(g => g.severity === 'fail')).toBe(true)
    expect(r.gaps.some(g => (g as VerdictGap).source === 'judgment-synthesis')).toBe(true)
  })

  it('promotes warn-severity judge gaps to fail when verdict=fail', () => {
    const r = resolveVerdict(
      judge({
        passed: false,
        notes: 'fail — gap below',
        gaps: [gap({ severity: 'warn', check: 'lint-style' })],
      }),
      judge({ passed: false, notes: 'fail — agreed' }),
    )
    expect(r.verdict).toBe('fail')
    // The previously-warn gap should now be fail-severity
    const lintGap = r.gaps.find(g => g.check === 'lint-style')
    expect(lintGap?.severity).toBe('fail')
  })

  it('regression: phase-1.10b — passed=true + judgment text says fail → verdict=fail', () => {
    // Direct reproduction of the bug: o3 returns passed=true but its notes
    // describe a fail decision with 4 missing components. Pre-fix, this would
    // have shipped as verdict=pass with gaps:[].
    const r = resolveVerdict(
      judge({
        passed: true, // ← the lying boolean
        notes: 'On second look this is a fail decision: migration file is missing, route is not wired, e2e test is missing, type export is deficient.',
        gaps: [],
      }),
      judge({ passed: true, notes: 'looks fine' }),
    )
    expect(r.verdict).toBe('fail')
    expect(r.verdict).not.toBe('pass')
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(r.gaps.some(g => g.severity === 'fail')).toBe(true)
  })

  it('never returns gaps:[] when verdict=fail', () => {
    // Property check across malformed inputs.
    const variants: Array<[JudgeOutput, JudgeOutput]> = [
      [judge({ passed: false, notes: '', gaps: [] }), judge({ passed: false, notes: '', gaps: [] })],
      [judge({ passed: null, notes: 'fail' }), judge({ passed: null, notes: 'fail' })],
      [judge({ passed: true, notes: 'missing critical export' }), judge({ passed: true, notes: 'missing test' })],
    ]
    for (const [a, b] of variants) {
      const r = resolveVerdict(a, b)
      if (r.verdict === 'fail') {
        expect(r.gaps.length).toBeGreaterThan(0)
        expect(r.gaps.some(g => g.severity === 'fail')).toBe(true)
      }
    }
  })
})
