// Phase 1.10v — Synthesize gaps when verdict=fail but the judges emitted
// none. A degenerate or malformed judge response cannot be allowed to pass
// silently because gaps[] is empty: that was the phase-1.10b incident.
//
// Synthesized gaps are tagged with source='judgment-synthesis' so downstream
// consumers can distinguish them from gaps the judges actually produced.

import type { VerdictGap } from '../types/verdict'

const MAX_NOTE_LEN = 280

function condense(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LEN)
}

export interface GapSynthesisInput {
  reason:
    | 'agreement-fail-empty-gaps'
    | 'judgment-text-fail'
    | 'inconclusive'
    | 'council-fail-empty-gaps'
  judgeNotes: string[]
}

export function buildSynthesizedGaps({ reason, judgeNotes }: GapSynthesisInput): VerdictGap[] {
  const summary = judgeNotes
    .map(n => condense(n))
    .filter(n => n.length > 0)
    .join(' / ')

  if (reason === 'inconclusive') {
    return [{
      check: 'verdict-inconclusive',
      severity: 'warn',
      expected: 'AI judges to emit a definitive pass or fail with structured gaps',
      actual: summary || 'Judges disagreed and judgment text contained no decisive keywords',
      remediation: 'Re-run builder; if still inconclusive, escalate to a human reviewer',
      source: 'judgment-synthesis',
    }]
  }

  return [{
    check: `judgment-synthesis-${reason}`,
    severity: 'fail',
    expected: 'Judges to emit at least one structured gap when concluding fail',
    actual: summary || `Synthesized from judgment context (reason=${reason})`,
    remediation: 'Inspect judgmentCallNotes for the full judge output and re-run builder against the missing components',
    source: 'judgment-synthesis',
  }]
}

// Convenience: when a verdict resolves to fail, ensure at least one severity='fail'
// gap exists. Returns the (possibly augmented) gap list.
export function ensureFailGap(
  gaps: VerdictGap[],
  synthesisInput: GapSynthesisInput,
): VerdictGap[] {
  const hasFail = gaps.some(g => g.severity === 'fail')
  if (hasFail) return gaps
  return [...gaps, ...buildSynthesizedGaps(synthesisInput)]
}
