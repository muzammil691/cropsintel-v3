// Phase 1.10v — Deterministic regex parser for AI judgment text.
//
// HARD CONSTRAINT: this file makes ZERO LLM calls. It exists precisely so the
// disagree-branch of verdict-resolver.ts has a fast, cheap, reproducible
// answer for "does this judgment text describe a fail?" — independent of the
// boolean `passed` field the judge emitted (which has been observed to lie:
// passed=true while notes say "fail decision" — the phase-1.10b incident).
//
// Negation is the main false-positive risk. We treat "no fail", "not failing",
// "without missing components" etc. as not-fail by checking a short window
// (≈30 chars / ~5 tokens) preceding each fail keyword for negators.

import type { VerdictValue } from '../types/verdict'

const FAIL_KEYWORDS = /\b(fail(?:s|ed|ing|ure)?|missing|absent|deficien\w*)\b/gi
const PASS_KEYWORDS = /\b(pass(?:es|ed|ing)?|success(?:ful|fully)?|approve[ds]?|complete[ds]?|satisf(?:ies|ied|y))\b/gi
const NEGATOR_BEFORE = /\b(no|not|without|never|nothing|none|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\b[^.?!]{0,40}$/i

export interface ParsedJudgment {
  verdict: VerdictValue
  failHits: string[]
  passHits: string[]
  negatedFailHits: string[]
  reason: string
}

function isNegated(text: string, matchStart: number): boolean {
  // Look at up to 40 chars (≈5 tokens) before the match for a negator that
  // precedes the keyword without an intervening sentence boundary.
  const windowStart = Math.max(0, matchStart - 40)
  const window = text.slice(windowStart, matchStart)
  return NEGATOR_BEFORE.test(window)
}

function findHits(text: string, pattern: RegExp): { hits: string[]; negated: string[] } {
  const hits: string[] = []
  const negated: string[] = []
  // Reset regex state — pattern may be shared/reused.
  pattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (isNegated(text, m.index)) {
      negated.push(m[0])
    } else {
      hits.push(m[0])
    }
    if (m.index === pattern.lastIndex) pattern.lastIndex++
  }
  return { hits, negated }
}

export function parseJudgmentText(text: string | null | undefined): ParsedJudgment {
  if (!text || text.trim().length === 0) {
    return {
      verdict: 'inconclusive',
      failHits: [],
      passHits: [],
      negatedFailHits: [],
      reason: 'Empty judgment text',
    }
  }

  const fails = findHits(text, FAIL_KEYWORDS)
  const passes = findHits(text, PASS_KEYWORDS)

  if (fails.hits.length > 0) {
    return {
      verdict: 'fail',
      failHits: fails.hits,
      passHits: passes.hits,
      negatedFailHits: fails.negated,
      reason: `Found ${fails.hits.length} unnegated fail keyword(s): ${fails.hits.slice(0, 3).join(', ')}`,
    }
  }

  if (passes.hits.length > 0) {
    return {
      verdict: 'pass',
      failHits: [],
      passHits: passes.hits,
      negatedFailHits: fails.negated,
      reason: `Found ${passes.hits.length} pass keyword(s) and zero unnegated fail keywords`,
    }
  }

  return {
    verdict: 'inconclusive',
    failHits: [],
    passHits: [],
    negatedFailHits: fails.negated,
    reason: 'No definitive pass/fail keywords detected in judgment text',
  }
}
