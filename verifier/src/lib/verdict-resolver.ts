// Phase 1.10v — Verdict resolver.
//
// Single entry point for turning two AI judge outputs into a final verdict.
// Replaces the inline disagree-branch logic that used to live in verify.ts,
// which could write verdict='pass' when:
//   • a judge returned passed=null (silent coercion to pass)
//   • a judge's `passed` boolean disagreed with its judgment notes text
//   • both judges returned passed=false but emitted gaps:[]
//
// All three holes close here. The resolver is deterministic — no LLM calls
// (the council LLM tiebreak still exists in escalate-to-council.ts and is
// invoked separately by verify.ts when the resolver returns 'inconclusive'
// AND a fallback is wanted; the resolver itself never calls it).

import type { JudgeOutput, VerdictGap, VerdictResolution } from '../types/verdict'
import { parseJudgmentText } from './council-parser'
import { ensureFailGap } from './gaps-builder'

function promoteToFail(gaps: VerdictGap[]): VerdictGap[] {
  // Judges sometimes emit severity='warn' or 'medium'; the consumer treats
  // only severity='fail' as blocking. When the resolver concludes fail, all
  // judge gaps are blocking.
  return gaps.map(g => ({
    ...g,
    severity: 'fail',
    actual: g.severity && g.severity !== 'fail'
      ? `${g.actual} [judge-severity=${g.severity}]`
      : g.actual,
    source: g.source ?? 'judge',
  }))
}

function dedupe(gaps: VerdictGap[]): VerdictGap[] {
  const seen = new Set<string>()
  const out: VerdictGap[] = []
  for (const g of gaps) {
    const key = `${g.check}::${g.actual}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g)
  }
  return out
}

export function resolveVerdict(
  o3: JudgeOutput,
  gemini: JudgeOutput,
): VerdictResolution {
  const o3Parsed = parseJudgmentText(o3.notes)
  const geminiParsed = parseJudgmentText(gemini.notes)
  const subjectMatterHits =
    o3Parsed.subjectMatterHits.length + geminiParsed.subjectMatterHits.length

  // ── Hard-fail rule: judgment text says fail ────────────────────────────────
  // If EITHER judgment text contains unnegated fail keywords, the verdict is
  // fail — regardless of what the boolean `passed` field says. This is the
  // exact bug from phase-1.10b: passed=true while notes said "fail decision".
  // Conservative-by-design: a judge whose text contradicts its boolean is
  // unreliable in either direction, so we trust the more pessimistic signal.
  if (o3Parsed.verdict === 'fail' || geminiParsed.verdict === 'fail') {
    const judgeGaps = dedupe(promoteToFail([...o3.gaps, ...gemini.gaps]))
    const gaps = ensureFailGap(judgeGaps, {
      reason: 'judgment-text-fail',
      judgeNotes: [o3.notes, gemini.notes],
    })
    return {
      verdict: 'fail',
      gaps,
      reason:
        `Council parser detected fail in judgment text ` +
        `(o3=${o3Parsed.verdict}: ${o3Parsed.reason}; ` +
        `gemini=${geminiParsed.verdict}: ${geminiParsed.reason})`,
      subjectMatterHits,
    }
  }

  // ── Boolean agreement ──────────────────────────────────────────────────────
  if (o3.passed === true && gemini.passed === true) {
    return {
      verdict: 'pass',
      gaps: [],
      reason: 'Both judges agree: pass',
      subjectMatterHits,
    }
  }

  if (o3.passed === false && gemini.passed === false) {
    const judgeGaps = dedupe(promoteToFail([...o3.gaps, ...gemini.gaps]))
    const gaps = ensureFailGap(judgeGaps, {
      reason: 'agreement-fail-empty-gaps',
      judgeNotes: [o3.notes, gemini.notes],
    })
    return {
      verdict: 'fail',
      gaps,
      reason: 'Both judges agree: fail',
      subjectMatterHits,
    }
  }

  // ── Disagreement OR null `passed` ──────────────────────────────────────────
  // Reaching here means at least one judge is null OR the two booleans
  // disagree, AND neither judgment text contains unnegated fail keywords.
  //
  // If both texts read as pass, we can resolve to pass. Otherwise inconclusive
  // — never pass (that was the phase-1.10b silent-coercion path).
  if (o3Parsed.verdict === 'pass' && geminiParsed.verdict === 'pass') {
    return {
      verdict: 'pass',
      gaps: [],
      reason: 'Boolean disagreement but both judgment texts read as pass with no fail keywords',
      subjectMatterHits,
    }
  }

  const inconclusiveGaps = ensureFailGap(
    dedupe([...o3.gaps, ...gemini.gaps]),
    { reason: 'inconclusive', judgeNotes: [o3.notes, gemini.notes] },
  )
  return {
    verdict: 'inconclusive',
    gaps: inconclusiveGaps,
    reason:
      `Inconclusive: o3.passed=${o3.passed}, gemini.passed=${gemini.passed}; ` +
      `parser o3=${o3Parsed.verdict}, gemini=${geminiParsed.verdict}`,
    subjectMatterHits,
  }
}
