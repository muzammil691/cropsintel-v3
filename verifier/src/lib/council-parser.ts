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
//
// Subject-matter immunity (rem3 — verifier-cluster-1778161030385): a judge
// reviewing an investigation/ADR whose *topic* is a Verifier failure cluster
// will repeatedly use the words "Verifier failures", "was failing", etc. as
// nouns naming the subject of the analysis, not as a verdict on the analysis.
// We mask out positions inside backtick spans, fenced blocks, short quoted
// strings, task-id tokens, file paths, and the 40-word window after a
// "subject:"/"topic:"/"investigating"/"diagnose"-class introducer; fail
// matches at masked positions are bucketed as `subjectMatterHits` and are
// excluded from the verdict trigger.

import type { VerdictValue } from '../types/verdict'

const FAIL_KEYWORDS = /\b(fail(?:s|ed|ing|ures?)?|missing|absent|deficien\w*)\b/gi
const PASS_KEYWORDS = /\b(pass(?:es|ed|ing)?|success(?:ful|fully)?|approve[ds]?|complete[ds]?|satisf(?:ies|ied|y)|meet(?:s|ing)?|met)\b/gi
const NEGATOR_BEFORE = /\b(no|not|without|never|nothing|none|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\b[^.?!]{0,40}$/i

// Subject-matter masks. Computed once per text and reused for both fail and
// pass keyword scans (the code-shape masks below) and for fail keywords only
// (the introducer mask, since pass keywords inside an investigation are still
// real verdicts about that investigation).
const FENCED_BLOCK_RE = /```[\s\S]*?```/g
const BACKTICK_SPAN_RE = /`[^`\n]+`/g
const QUOTED_STRAIGHT_RE = /"([^"\n]{1,120})"/g
const QUOTED_CURLY_RE = /“([^“”\n]{1,120})”/g
// Task-id tokens — phase-x.y[-...], cluster-id-N, verifier-cluster-N, cluster-N
// (10+ digit). These names commonly contain fail-keyword substrings (e.g.
// `phase-1.10af-failed-route-fix`) and naming a task is not the same as
// rendering a verdict on it.
const TASK_ID_RE = /\b(?:phase-[\w.-]+|cluster-id-\d+|verifier-cluster-\d+|cluster-\d{10,})\b/gi
// Paths — anything that ends in a recognised source extension. Mirrors the
// extension set in verifier/src/lib/spec-parser.ts:3 so the two regex agree on
// what counts as a "path".
const FILE_PATH_RE = /\b\w[\w./-]*\.(?:ts|tsx|js|jsx|json|sql|md|sh|yaml|yml|html|css)\b/gi
// Introducers that open a 40-word "subject matter" window. Inside this window
// a fail keyword is treated as naming the topic, not as a verdict.
const INTRODUCER_RE = /\b(?:subject\s*:|topic\s*:|investigat\w*|diagnos\w*|root[\s-]+cause)\b/gi

export interface ParsedJudgment {
  verdict: VerdictValue
  failHits: string[]
  passHits: string[]
  negatedFailHits: string[]
  subjectMatterHits: string[]
  reason: string
}

interface Span { start: number; end: number }

function pushSpansFromRe(text: string, re: RegExp, spans: Span[]): void {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length })
    if (m.index === re.lastIndex) re.lastIndex++
  }
}

function computeCodeShapeSpans(text: string): Span[] {
  const spans: Span[] = []
  pushSpansFromRe(text, FENCED_BLOCK_RE, spans)
  pushSpansFromRe(text, BACKTICK_SPAN_RE, spans)
  pushSpansFromRe(text, QUOTED_STRAIGHT_RE, spans)
  pushSpansFromRe(text, QUOTED_CURLY_RE, spans)
  pushSpansFromRe(text, TASK_ID_RE, spans)
  pushSpansFromRe(text, FILE_PATH_RE, spans)
  return spans
}

function computeIntroducerSpans(text: string): Span[] {
  const spans: Span[] = []
  INTRODUCER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INTRODUCER_RE.exec(text)) !== null) {
    const start = m.index + m[0].length
    let end = start
    let words = 0
    while (end < text.length && words < 40) {
      while (end < text.length && /\s/.test(text[end])) end++
      if (end >= text.length) break
      while (end < text.length && /\S/.test(text[end])) end++
      words++
    }
    spans.push({ start, end })
    if (m.index === INTRODUCER_RE.lastIndex) INTRODUCER_RE.lastIndex++
  }
  return spans
}

function isInSpan(pos: number, spans: Span[]): boolean {
  for (const s of spans) {
    if (pos >= s.start && pos < s.end) return true
  }
  return false
}

function isNegated(text: string, matchStart: number): boolean {
  // Look at up to 40 chars (≈5 tokens) before the match for a negator that
  // precedes the keyword without an intervening sentence boundary.
  const windowStart = Math.max(0, matchStart - 40)
  const window = text.slice(windowStart, matchStart)
  return NEGATOR_BEFORE.test(window)
}

interface FailHits {
  hits: string[]
  negated: string[]
  subjectMatter: string[]
}

function findFailHits(text: string, codeImmune: Span[], introducerImmune: Span[]): FailHits {
  const hits: string[] = []
  const negated: string[] = []
  const subjectMatter: string[] = []
  FAIL_KEYWORDS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FAIL_KEYWORDS.exec(text)) !== null) {
    if (isNegated(text, m.index)) {
      negated.push(m[0])
    } else if (isInSpan(m.index, codeImmune) || isInSpan(m.index, introducerImmune)) {
      subjectMatter.push(m[0])
    } else {
      hits.push(m[0])
    }
    if (m.index === FAIL_KEYWORDS.lastIndex) FAIL_KEYWORDS.lastIndex++
  }
  return { hits, negated, subjectMatter }
}

interface PassHits {
  hits: string[]
  negated: string[]
}

function findPassHits(text: string, codeImmune: Span[]): PassHits {
  // Pass keywords are masked only by the *code-shape* spans — not the
  // introducer windows. "this is an investigation about Verifier failures and
  // the agent passed" still has a real `passed` verdict; the introducer
  // immunises only the fail noun.
  const hits: string[] = []
  const negated: string[] = []
  PASS_KEYWORDS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PASS_KEYWORDS.exec(text)) !== null) {
    if (isInSpan(m.index, codeImmune)) {
      // Pass keyword inside a code span / quote / path / task-id is also
      // subject matter (e.g. quoting another ADR's title that says
      // "Implementation passed"). Drop it.
    } else if (isNegated(text, m.index)) {
      negated.push(m[0])
    } else {
      hits.push(m[0])
    }
    if (m.index === PASS_KEYWORDS.lastIndex) PASS_KEYWORDS.lastIndex++
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
      subjectMatterHits: [],
      reason: 'Empty judgment text',
    }
  }

  const codeImmune = computeCodeShapeSpans(text)
  const introducerImmune = computeIntroducerSpans(text)
  const fails = findFailHits(text, codeImmune, introducerImmune)
  const passes = findPassHits(text, codeImmune)

  // Threshold (rem3): one lone non-immune fail hit alone should not flip the
  // verdict. Require either ≥2 unnegated, non-immune fail hits, OR ≥1
  // unnegated non-immune fail hit AND zero pass hits. This protects
  // "the implementation is missing the API call" (true fail) without
  // over-triggering on "the agent investigated a missing-API-call cluster"
  // (subject matter that happens to leak past the immunity masks).
  const triggerFail =
    fails.hits.length >= 2 ||
    (fails.hits.length >= 1 && passes.hits.length === 0)

  if (triggerFail) {
    return {
      verdict: 'fail',
      failHits: fails.hits,
      passHits: passes.hits,
      negatedFailHits: fails.negated,
      subjectMatterHits: fails.subjectMatter,
      reason: `Found ${fails.hits.length} unnegated, non-immune fail keyword(s): ${fails.hits.slice(0, 3).join(', ')}`,
    }
  }

  if (passes.hits.length > 0) {
    const subjectNote = fails.subjectMatter.length > 0
      ? `; ${fails.subjectMatter.length} subject-matter fail keyword(s) immunised`
      : ''
    return {
      verdict: 'pass',
      failHits: [],
      passHits: passes.hits,
      negatedFailHits: fails.negated,
      subjectMatterHits: fails.subjectMatter,
      reason: `Found ${passes.hits.length} pass keyword(s) and zero unnegated non-immune fail keywords${subjectNote}`,
    }
  }

  return {
    verdict: 'inconclusive',
    failHits: [],
    passHits: [],
    negatedFailHits: fails.negated,
    subjectMatterHits: fails.subjectMatter,
    reason: 'No definitive pass/fail keywords detected in judgment text',
  }
}
