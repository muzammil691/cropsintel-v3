// Phase 1.10bb-c — Plan Workshop engine.
//
// Replaces the per-phase wizard (wizard-engine.ts + wizard-session.ts +
// spec-from-wizard.ts), which the build prompt's Q1 decision deletes
// entirely. The new engine drives standing planning intelligence: deep
// multi-turn architectural conversations grounded in the 8 sources from
// workshop-context.ts, with anti-drift rules per Q3 baked into every
// system prompt.
//
// Five public functions (per the build prompt's session-3 spec):
//   • startWorkshopSession(input)         — create row, prime Opus, return first turn
//   • proposeNextTurn(sessionId)          — next question OR "ready to draft"
//   • recordTurnAnswer(sessionId, answer) — store + advance
//   • requestVerifierMidSessionAudit      — STUB (Session 5 wires real)
//   • finalizePlanDiff(sessionId)         — Opus generates diff, inserts plan_diffs row
//
// Model: claude-opus-4-7 only. Architectural decisions ride on this; quality
// over cost. recordCost() logs every Opus call to atlas_cost_log so Atlas's
// existing budget gates apply unchanged.

import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseClient } from './supabase'
import { recordCost } from './cost-log'
import { loadFullContext, type WorkshopContext, type WorkshopUpload } from './workshop-context'
import {
  loadSessionDecisions,
  loadSessionOpenQuestions,
  recordDecision,
  recordOpenQuestion,
  formatDecisionCitation,
  formatOpenQuestionCitation,
  type Decision,
  type OpenQuestion,
} from './decision-log'

// ─── Constants ──────────────────────────────────────────────────────────────

export const WORKSHOP_MODEL = 'claude-opus-4-7'
/** Confidence at which proposeNextTurn signals "ready to draft plan diff".
 *  User can still ask to finalize earlier — this is a recommendation, not a gate. */
export const READY_TO_DRAFT_THRESHOLD = 0.9
/** Hard cap on turns. Past 20 we log a warning; at 30 we refuse new turns. */
export const MAX_TURNS = 30
export const TURNS_WARNING_THRESHOLD = 20
/** Opus 4.7 pricing per 1M tokens (approximate, kept in sync w/ Anthropic). */
const OPUS_INPUT_PER_M = 15
const OPUS_OUTPUT_PER_M = 75

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CitedSource {
  /** Discriminator so the UI can render an icon: 'concept' | 'master_plan' | 'idea' | 'v1_file' | 'v3_file' | 'prior_decision' | 'open_question' | 'runtime_state' | 'v3_conventions'. */
  kind:
    | 'concept'
    | 'master_plan'
    | 'idea'
    | 'v1_file'
    | 'v3_file'
    | 'prior_decision'
    | 'open_question'
    | 'runtime_state'
    | 'v3_conventions'
  /** Stable identifier (concept id / file path / decision timestamp / etc.). */
  ref: string
  /** Short human-readable label for the citation chip. */
  label: string
  /** Optional excerpt (≤300 chars) the LLM said it pulled from this source. */
  excerpt?: string
}

export interface WorkshopTurnQuestion {
  kind: 'question'
  /** The actual question text (Markdown allowed). */
  question: string
  /** Optional multiple-choice options. Free text always allowed too. */
  options?: string[]
  /** Sources the LLM cited when constructing this question. Q3 anti-drift
   *  requires every question that touches a prior decision or known
   *  concept to cite explicitly. */
  cited_sources: CitedSource[]
  /** Confidence in CURRENT plan-diff readiness, 0..1. Rises with each
   *  recorded answer; ≥READY_TO_DRAFT_THRESHOLD signals "ready to draft". */
  confidence: number
  /** Optional Atlas-side commentary the UI can render below the question
   *  (e.g., "I'm asking this because concept X conflicts with prior decision Y"). */
  rationale?: string
}

export interface WorkshopTurnReady {
  kind: 'ready'
  /** Why we're ready: what's been resolved, what's still open. */
  rationale: string
  cited_sources: CitedSource[]
  confidence: number
}

export type WorkshopTurnResult = WorkshopTurnQuestion | WorkshopTurnReady

export interface WorkshopTurnRecord {
  /** 1-indexed turn number. */
  index: number
  /** The question Atlas asked on this turn. */
  question: string
  /** Optional options offered to the user. */
  options?: string[]
  /** The user's answer; null until recordTurnAnswer fills it in. */
  answer: string | null
  /** Sources cited when proposing the question. */
  cited_sources: CitedSource[]
  /** Cost in USD of the Opus call that produced this question. */
  model_cost_usd: number
  /** Confidence the engine reported when proposing this question. */
  confidence_at_propose: number
  /** ISO timestamps. */
  proposed_at: string
  answered_at: string | null
}

export interface SessionStateMetadata {
  turns: WorkshopTurnRecord[]
  /** The free-text framing the user provided at session start. */
  prompt: string
  /** Last confidence value the engine reported (cached for fast UI reads). */
  last_confidence: number
  /** True once Atlas has flagged "ready to draft plan diff" at least once. */
  ready_signaled: boolean
}

export interface StartSessionInput {
  /** Free-text framing (e.g., "Refine V3 plan to V1.0-alpha launch"). */
  prompt: string
  createdBy?: string | null
  /** Concept ids the user explicitly selected. */
  conceptIds?: readonly string[]
  /** Files attached at session start. */
  uploads?: readonly WorkshopUpload[]
  /** V3 file paths to seed context with. */
  v3Paths?: readonly string[]
  /** V1 file paths to seed context with (skipped without GITLAB_PAT). */
  v1Paths?: readonly string[]
  /** V1 search queries (skipped without GITLAB_PAT). */
  v1SearchQueries?: readonly string[]
  /** Master plan version label for traceability (e.g., 'v1.6'). */
  masterPlanVersion?: string
  /** Anthropic client. Required — engine refuses without it. */
  anthropic: Anthropic
}

export interface StartSessionResult {
  sessionId: string
  firstTurn: WorkshopTurnResult
  /** Honest unavailable-sources map from the context loader. */
  unavailableReasons: Record<string, string>
  /** Cost of the first turn (context load + first Opus call). */
  costUsd: number
}

export interface ProposeNextTurnInput {
  sessionId: string
  anthropic: Anthropic
}

export interface RecordAnswerInput {
  sessionId: string
  answer: string
  anthropic: Anthropic
  /** Whether to immediately propose the next turn after recording.
   *  Default true — UI flows want chained turns. */
  advance?: boolean
}

export interface RecordAnswerResult {
  /** Updated session state after recording. */
  totalTurns: number
  /** Next turn if advance=true; null if advance=false or session already
   *  ended. */
  nextTurn: WorkshopTurnResult | null
  costUsd: number
}

export interface FinalizePlanDiffInput {
  sessionId: string
  anthropic: Anthropic
}

export interface FinalizePlanDiffResult {
  diffId: string
  /** The proposed diff JSON — same shape as plan_diffs.diff_jsonb. */
  diff: PlanDiff
  costUsd: number
}

/**
 * Plan-diff op vocabulary. Aligns with Q2's "direct mutation with mandatory
 * diff approval" — Workshop emits these, the user approves, Session 6's
 * plan-mutator applies them atomically against atlas_plan_node_state.
 */
export type PlanDiffOp =
  | { op: 'add'; phase_id: string; parent_id?: string | null; title: string; body?: string; launch_tier?: string; metadata?: Record<string, unknown> }
  | { op: 'remove'; phase_id: string; reason?: string }
  | { op: 'reorder'; parent_id: string | null; ordered_phase_ids: string[] }
  | { op: 'edit'; phase_id: string; title?: string; body?: string; launch_tier?: string; metadata?: Record<string, unknown> }

export interface PlanDiff {
  /** Top-level summary the UI renders above the side-by-side tree. */
  summary: string
  /** The ordered ops to apply. Order matters for reorder + edit pairs. */
  ops: PlanDiffOp[]
  /** Atlas's own assessment of risks the user should weigh before approving. */
  risks: string[]
  /** Decisions cited as the basis for these ops — pulled from session.decision_log. */
  cited_decisions: CitedSource[]
}

export interface VerifierAuditResult {
  passed: boolean
  /** Each gap is { kind, description, severity }. Empty when passed=true. */
  gaps: Array<{ kind: string; description: string; severity: 'info' | 'warn' | 'critical' }>
  /** Free-text rationale the UI renders alongside the verdict. */
  rationale: string
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

async function getSessionRow(sessionId: string): Promise<{
  state: SessionStateMetadata
  decisionLog: Decision[]
  openQuestions: OpenQuestion[]
  status: string
  prompt: string
  totalTurns: number
  totalCostUsd: number
} | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data, error } = await sb
    .from('plan_workshop_sessions')
    .select('id, status, decision_log, open_questions, total_turns, total_cost_usd, metadata, started_at')
    .eq('id', sessionId)
    .single()
  if (error || !data) return null
  // We persist turn state inside metadata.workshop_state to avoid widening
  // the column set; decision_log + open_questions stay in dedicated columns
  // because decision-log.ts already operates on them.
  const meta = (data as { metadata?: Record<string, unknown> }).metadata ?? {}
  const state = (meta.workshop_state ?? { turns: [], prompt: '', last_confidence: 0, ready_signaled: false }) as SessionStateMetadata
  return {
    state,
    decisionLog: Array.isArray(data.decision_log) ? (data.decision_log as Decision[]) : [],
    openQuestions: Array.isArray(data.open_questions) ? (data.open_questions as OpenQuestion[]) : [],
    status: String(data.status ?? 'active'),
    prompt: state.prompt,
    totalTurns: Number(data.total_turns ?? 0),
    totalCostUsd: Number(data.total_cost_usd ?? 0),
  }
}

async function persistSessionState(
  sessionId: string,
  state: SessionStateMetadata,
  totalTurns: number,
  totalCostUsd: number,
): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  // Read current metadata so we don't clobber sibling keys.
  const { data } = await sb
    .from('plan_workshop_sessions')
    .select('metadata')
    .eq('id', sessionId)
    .single()
  const existingMeta = (data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}
  const nextMeta = { ...existingMeta, workshop_state: state }
  await sb
    .from('plan_workshop_sessions')
    .update({ metadata: nextMeta, total_turns: totalTurns, total_cost_usd: totalCostUsd })
    .eq('id', sessionId)
}

function buildSystemPrompt(): string {
  // Q3 anti-drift rules verbatim from the build prompt + Session 3 user note.
  return `You are the Plan Workshop — a standing planning intelligence inside the CropsIntel V3 Atlas conductor.
Your job is to drive deep, architectural multi-turn conversations that resolve ambiguity in the master plan and produce approve-ready plan diffs.
You are NOT a code generator. You ask clarifying questions, you cite sources, you log open questions, and you propose plan-tree mutations only when the user has explicitly approved each architectural choice.

ANTI-DRIFT RULES — non-negotiable:

1. NEVER assume a prior decision applies to a new context — cite it and ask. Even if a prior decision sounds clearly relevant, list it back to the user verbatim and confirm before applying it.
2. NEVER make architectural choices the user hasn't approved. Your output is a question OR a proposed diff for review — never a fait accompli.
3. IF a prior decision conflicts with current context — flag it, don't auto-resolve. Surface the conflict, name both sides, and ask the user which holds.
4. AT session start, list 3-5 prior decisions and ask "still hold? revisit?". Use the prior_decisions input verbatim.
5. Each question MUST cite specific context: concept X, prior decision Y, V1 file Z, master plan §N. No floating questions. The cited_sources array is mandatory and must be non-empty for question turns past the first.
6. Be conservative on assumptions, aggressive on clarification. If a turn could be answered two ways depending on a missing detail, ask.
7. Log ambiguous discussion as open_question, not auto-resolved decision. Only the recordDecision path produces ratified decisions.

CONFIDENCE SEMANTICS:
• confidence = your subjective estimate that the user has provided enough resolved choices to draft a plan diff.
• Starts low (0.1-0.3 on the first turn even with rich context).
• Rises as the user answers each question — usually +0.1 to +0.2 per substantive answer, less when the answer raises a NEW open question.
• When confidence ≥ 0.9, return kind="ready" instead of kind="question".
• The user can still request finalize earlier — that's their call.

OUTPUT FORMAT (strict JSON):

For a question turn:
{
  "kind": "question",
  "question": "the actual question text, Markdown allowed",
  "options": ["optional", "multiple-choice", "options"],
  "cited_sources": [
    { "kind": "prior_decision", "ref": "<timestamp>", "label": "decided X over Y", "excerpt": "…" },
    { "kind": "concept",        "ref": "<concept-id>", "label": "<concept-title>" }
  ],
  "confidence": 0.55,
  "rationale": "optional one-line note about why you're asking this"
}

For a ready-to-draft turn:
{
  "kind": "ready",
  "rationale": "summary of what's resolved + what residual open_questions remain",
  "cited_sources": [...],
  "confidence": 0.92
}

Output ONLY the JSON object. No prose around it. No code fences.

DOMAIN CONTEXT — never drift from these:
• Master plan v1.6 is locked in shape; you propose diffs but the user approves.
• Five immutable rules from V3-CODING-INSTRUCTIONS apply to every diff: foundation-first, anti-restart, multi-commodity from day 1, AI keys server-side only, information walls.
• Cost cap is real: $400/mo total AI budget. Workshop costs feed into atlas_cost_log.
• Trust mode 'confirm': you propose, the user approves. No autopilot.`
}

function buildContextSection(ctx: WorkshopContext, decisions: Decision[], openQs: OpenQuestion[]): string {
  // Top-N prior decisions formatted as the canonical citation lines from
  // decision-log. Workshop's first turn lists these per Q3 rule #4.
  const priorDecisionsLines = ctx.priorDecisions.recent.map(d => `- ${formatDecisionCitation(d)}`).join('\n') || '(none yet)'
  const openQuestionLines = ctx.priorDecisions.recentOpenQuestions.map(q => `- ${formatOpenQuestionCitation(q)}`).join('\n') || '(none yet)'
  // Same for THIS session's decisions / open questions accumulated so far.
  const sessionDecisionsLines = decisions.map(d => `- ${formatDecisionCitation(d)}`).join('\n') || '(none yet — first turn)'
  const sessionOpenLines = openQs.map(q => `- ${formatOpenQuestionCitation(q)}`).join('\n') || '(none yet)'

  // Concepts: just title + theme + summarized body for the LLM. Full bodies
  // would balloon the context — workshop-context already summarized the big ones.
  const conceptLines = ctx.concepts.summaries.map(s => `### Concept: ${s.title}${s.summarized ? ' (Haiku-summarized)' : ''}\n${s.body}`).join('\n\n') || '(no concepts loaded)'

  const v1Section = ctx.v1.reachable
    ? `V1 codebase tree: ${ctx.v1.tree.length} files visible\nV1 snippets loaded: ${ctx.v1.snippets.length}${
        ctx.v1.searchHits.length ? `\nV1 search results: ${ctx.v1.searchHits.map(h => `${h.query} (${h.hits.length} hits)`).join(', ')}` : ''
      }`
    : 'V1 codebase: NOT loaded — GITLAB_PAT not set or unreachable. Treat V1 as a known-unknown.'

  const v3Section = ctx.v3.treeAvailable
    ? `V3 codebase tree: ${ctx.v3.tree.length} files visible\nV3 snippets loaded: ${ctx.v3.snippets.length}`
    : 'V3 codebase: NOT loaded — GITHUB_PAT not set or unreachable. Treat V3 as a known-unknown.'

  const unavail = Object.entries(ctx.unavailableReasons).map(([k, v]) => `- ${k}: ${v}`).join('\n')

  return `## Master plan (.agent/master-plan.md)

${ctx.masterPlan.slice(0, 30_000)}${ctx.masterPlan.length > 30_000 ? '\n\n[…truncated to 30k chars for prompt budget…]' : ''}

## Idea file (.agent/idea.md)

${ctx.idea}

## Runtime state (.agent/runtime-state.md)

${ctx.runtimeState}

## V3 conventions (V3-CODING-INSTRUCTIONS.md)

${ctx.v3Conventions.slice(0, 12_000)}${ctx.v3Conventions.length > 12_000 ? '\n\n[…truncated…]' : ''}

## Concepts (ranked, top ${ctx.concepts.ranked.length} of ${ctx.concepts.totalAvailable})

${conceptLines}

## V3 codebase

${v3Section}

## V1 codebase

${v1Section}

## Prior decisions (across all non-abandoned sessions)

Total: ${ctx.priorDecisions.total}
Most recent ${ctx.priorDecisions.recent.length}:
${priorDecisionsLines}

## Prior open questions

Total: ${ctx.priorDecisions.openQuestionsTotal}
Most recent ${ctx.priorDecisions.recentOpenQuestions.length}:
${openQuestionLines}

## THIS session's decisions so far

${sessionDecisionsLines}

## THIS session's open questions so far

${sessionOpenLines}

${unavail ? `## Sources NOT loaded (be honest in your questions about what you don't have)\n\n${unavail}\n` : ''}`
}

function buildHistorySection(state: SessionStateMetadata): string {
  if (state.turns.length === 0) {
    return `## Conversation history\n\n(this is turn 1 — the user's framing prompt was: "${state.prompt}")`
  }
  const lines: string[] = ['## Conversation history']
  for (const t of state.turns) {
    lines.push(`### Turn ${t.index} (Atlas)`)
    lines.push(t.question)
    if (t.options && t.options.length > 0) {
      lines.push('Options offered:')
      for (const o of t.options) lines.push(`  - ${o}`)
    }
    if (t.answer !== null) {
      lines.push(`### Turn ${t.index} (User answered)`)
      lines.push(t.answer)
    } else {
      lines.push('(awaiting answer)')
    }
  }
  return lines.join('\n\n')
}

interface OpusInvocation {
  parsed: WorkshopTurnResult | null
  rawText: string
  costUsd: number
  inputTokens: number
  outputTokens: number
}

async function callOpus(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  service: string,
  sessionId: string,
): Promise<OpusInvocation> {
  // Anthropic SDK call. Failures here propagate so the caller can surface a
  // clean error to the UI instead of producing a synthetic response.
  const response = await anthropic.messages.create({
    model: WORKSHOP_MODEL,
    max_tokens: 4_096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  const costUsd = (inputTokens / 1_000_000) * OPUS_INPUT_PER_M + (outputTokens / 1_000_000) * OPUS_OUTPUT_PER_M

  await recordCost('anthropic', service, WORKSHOP_MODEL, inputTokens, outputTokens, costUsd, { session_id: sessionId })

  const rawText = response.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => (b as { text: string }).text)
    .join('\n')
    .trim()

  // Strip optional code fences in case Opus wraps despite the system prompt.
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: WorkshopTurnResult | null = null
  try {
    parsed = JSON.parse(stripped) as WorkshopTurnResult
  } catch {
    parsed = null
  }
  return { parsed, rawText, costUsd, inputTokens, outputTokens }
}

function clampConfidence(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function normalizeTurnResult(parsed: unknown, fallback: { confidence: number }): WorkshopTurnResult {
  if (!parsed || typeof parsed !== 'object') {
    return {
      kind: 'question',
      question: 'I had trouble parsing my own response. Could you re-state the most recent decision so I can recalibrate?',
      cited_sources: [],
      confidence: fallback.confidence,
      rationale: 'engine fallback — JSON parse failed',
    }
  }
  const obj = parsed as Record<string, unknown>
  const kind = obj.kind === 'ready' ? 'ready' : 'question'
  const cited = Array.isArray(obj.cited_sources) ? (obj.cited_sources as CitedSource[]) : []
  const confidence = clampConfidence(obj.confidence ?? fallback.confidence)

  if (kind === 'ready') {
    return {
      kind: 'ready',
      rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
      cited_sources: cited,
      confidence,
    }
  }
  return {
    kind: 'question',
    question: typeof obj.question === 'string' ? obj.question : '(engine produced no question text)',
    options: Array.isArray(obj.options) ? (obj.options as string[]) : undefined,
    cited_sources: cited,
    confidence,
    rationale: typeof obj.rationale === 'string' ? obj.rationale : undefined,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new workshop session row, load full context, and return the first turn.
 * Q3 anti-drift requires the first turn to list 3-5 prior decisions — that
 * directive is in the system prompt; the LLM follows it.
 */
export async function startWorkshopSession(input: StartSessionInput): Promise<StartSessionResult> {
  if (!input.anthropic) throw new Error('startWorkshopSession: anthropic client required')
  const sb = getSupabaseClient()
  if (!sb) throw new Error('startWorkshopSession: Supabase client not configured')

  // 1. Insert session row.
  const { data: insertData, error: insertErr } = await sb
    .from('plan_workshop_sessions')
    .insert({
      created_by: input.createdBy ?? null,
      status: 'active',
      decision_log: [],
      open_questions: [],
      concepts_referenced: input.conceptIds ?? [],
      master_plan_version: input.masterPlanVersion ?? null,
      total_turns: 0,
      total_cost_usd: 0,
      metadata: {
        workshop_state: {
          turns: [],
          prompt: input.prompt,
          last_confidence: 0,
          ready_signaled: false,
        } as SessionStateMetadata,
      },
    })
    .select('id')
    .single()
  if (insertErr || !insertData) {
    throw new Error(`startWorkshopSession: row insert failed: ${insertErr?.message ?? 'no data returned'}`)
  }
  const sessionId = insertData.id as string

  // 2. Load full context.
  const ctx = await loadFullContext({
    sessionId,
    query: input.prompt,
    conceptIds: input.conceptIds,
    uploads: input.uploads,
    v3Paths: input.v3Paths,
    v1Paths: input.v1Paths,
    v1SearchQueries: input.v1SearchQueries,
    anthropic: input.anthropic,
  })

  // 3. Prime Opus and produce the first turn.
  const systemPrompt = buildSystemPrompt()
  const userPrompt = `${buildContextSection(ctx, [], [])}

## User's framing prompt for this Workshop session

${input.prompt}

## Your task right now

This is the FIRST turn. Per anti-drift rule #4, you must list 3-5 prior decisions (or say "no prior decisions yet" if total=0) and ask "still hold? revisit?" before any new question. Then ask one focused question (or proceed to a ready signal if confidence is already ≥ 0.9, which is unlikely on turn 1).

Output JSON only.`

  const opus = await callOpus(input.anthropic, systemPrompt, userPrompt, 'workshop.start', sessionId)
  const firstTurn = normalizeTurnResult(opus.parsed, { confidence: 0.1 })

  // 4. Persist turn state.
  const turnRecord: WorkshopTurnRecord = {
    index: 1,
    question: firstTurn.kind === 'question' ? firstTurn.question : '[ready signal — see rationale]',
    options: firstTurn.kind === 'question' ? firstTurn.options : undefined,
    answer: null,
    cited_sources: firstTurn.cited_sources,
    model_cost_usd: opus.costUsd,
    confidence_at_propose: firstTurn.confidence,
    proposed_at: nowIso(),
    answered_at: null,
  }
  const stateAfter: SessionStateMetadata = {
    turns: [turnRecord],
    prompt: input.prompt,
    last_confidence: firstTurn.confidence,
    ready_signaled: firstTurn.kind === 'ready',
  }
  await persistSessionState(sessionId, stateAfter, 1, ctx.costUsd + opus.costUsd)

  return {
    sessionId,
    firstTurn,
    unavailableReasons: ctx.unavailableReasons,
    costUsd: ctx.costUsd + opus.costUsd,
  }
}

/**
 * Drive the next turn — either a follow-up question or a ready-to-draft signal.
 * Reloads context every call so concept additions / runtime-state edits land
 * immediately. Caller decides whether to record the user's answer first
 * (recordTurnAnswer does both in sequence).
 */
export async function proposeNextTurn(input: ProposeNextTurnInput): Promise<{ turn: WorkshopTurnResult; costUsd: number }> {
  const { sessionId, anthropic } = input
  if (!anthropic) throw new Error('proposeNextTurn: anthropic client required')
  const row = await getSessionRow(sessionId)
  if (!row) throw new Error(`proposeNextTurn: session ${sessionId} not found`)
  if (row.status !== 'active' && row.status !== 'awaiting_approval') {
    throw new Error(`proposeNextTurn: session ${sessionId} is ${row.status}; cannot advance`)
  }

  const turnsSoFar = row.state.turns.length
  if (turnsSoFar >= MAX_TURNS) {
    // Synthetic ready signal — caller can override by calling finalizePlanDiff.
    return {
      turn: {
        kind: 'ready',
        rationale: `Hit MAX_TURNS (${MAX_TURNS}). Forcing ready signal so the user can finalize or abandon. ${row.openQuestions.length} open questions remain.`,
        cited_sources: [],
        confidence: 0.7,
      },
      costUsd: 0,
    }
  }
  if (turnsSoFar >= TURNS_WARNING_THRESHOLD) {
    console.warn(`[workshop-engine] session ${sessionId} at ${turnsSoFar}/${MAX_TURNS} turns — consider finalizing`)
  }

  // Load context + this session's accumulated decisions / open questions.
  const ctx = await loadFullContext({
    sessionId,
    query: row.state.prompt,
    anthropic,
  })
  const sessionDecisions = await loadSessionDecisions(sessionId)
  const sessionOpenQs = await loadSessionOpenQuestions(sessionId)

  const systemPrompt = buildSystemPrompt()
  const history = buildHistorySection(row.state)
  const userPrompt = `${buildContextSection(ctx, sessionDecisions, sessionOpenQs)}

${history}

## Your task right now

Decide the next turn:
- If the user's most recent answer resolved enough ambiguity that a plan diff is now drafttable (confidence ≥ ${READY_TO_DRAFT_THRESHOLD}), output kind="ready".
- Otherwise output kind="question". Cite specific sources. Per anti-drift rule #5, cited_sources must be non-empty.
- If the previous answer raised a new ambiguity, log it as an open_question via your rationale and ask the next focused question.

Output JSON only.`

  const opus = await callOpus(anthropic, systemPrompt, userPrompt, 'workshop.propose', sessionId)
  const result = normalizeTurnResult(opus.parsed, { confidence: row.state.last_confidence })
  const totalCost = ctx.costUsd + opus.costUsd

  // Persist the new turn record.
  const newTurn: WorkshopTurnRecord = {
    index: turnsSoFar + 1,
    question: result.kind === 'question' ? result.question : '[ready signal — see rationale]',
    options: result.kind === 'question' ? result.options : undefined,
    answer: null,
    cited_sources: result.cited_sources,
    model_cost_usd: opus.costUsd,
    confidence_at_propose: result.confidence,
    proposed_at: nowIso(),
    answered_at: null,
  }
  const stateAfter: SessionStateMetadata = {
    ...row.state,
    turns: [...row.state.turns, newTurn],
    last_confidence: result.confidence,
    ready_signaled: row.state.ready_signaled || result.kind === 'ready',
  }
  await persistSessionState(sessionId, stateAfter, turnsSoFar + 1, row.totalCostUsd + totalCost)

  return { turn: result, costUsd: totalCost }
}

/**
 * Record the user's answer to the most recent question turn. By default
 * also calls proposeNextTurn so the UI can render the next question
 * without a second round-trip.
 */
export async function recordTurnAnswer(input: RecordAnswerInput): Promise<RecordAnswerResult> {
  const { sessionId, answer, anthropic } = input
  const advance = input.advance !== false
  const row = await getSessionRow(sessionId)
  if (!row) throw new Error(`recordTurnAnswer: session ${sessionId} not found`)
  if (row.state.turns.length === 0) {
    throw new Error('recordTurnAnswer: no turns recorded yet — start a session first')
  }
  const lastTurn = row.state.turns[row.state.turns.length - 1]
  if (lastTurn.answer !== null) {
    throw new Error(`recordTurnAnswer: most recent turn already answered`)
  }

  const updatedLast: WorkshopTurnRecord = {
    ...lastTurn,
    answer,
    answered_at: nowIso(),
  }
  const turnsAfterAnswer = [...row.state.turns.slice(0, -1), updatedLast]
  const stateAfterAnswer: SessionStateMetadata = {
    ...row.state,
    turns: turnsAfterAnswer,
  }
  await persistSessionState(sessionId, stateAfterAnswer, row.totalTurns, row.totalCostUsd)

  if (!advance) {
    return { totalTurns: row.totalTurns, nextTurn: null, costUsd: 0 }
  }

  const next = await proposeNextTurn({ sessionId, anthropic })
  // proposeNextTurn already persisted the new turn + bumped totals.
  const refreshed = await getSessionRow(sessionId)
  return {
    totalTurns: refreshed?.state.turns.length ?? row.totalTurns + 1,
    nextTurn: next.turn,
    costUsd: next.costUsd,
  }
}

/**
 * Convenience: append a Decision to the session's decision_log. Workshop UI
 * calls this when the user accepts a proposed answer-as-decision (e.g., a
 * "lock this" button on a Q&A row).
 */
export async function ratifyDecisionFromTurn(args: {
  sessionId: string
  decided: string
  over: string
  because: string
  phaseId?: string | null
}): Promise<{ ok: boolean; reason?: string }> {
  return recordDecision(args.sessionId, {
    decided: args.decided,
    over: args.over,
    because: args.because,
    phase_id: args.phaseId ?? null,
  })
}

/**
 * Convenience: append an OpenQuestion. Workshop UI calls this when the
 * engine returns an ambiguity it can't auto-resolve.
 */
export async function logOpenQuestionFromTurn(args: {
  sessionId: string
  question: string
  reason: string
  phaseId?: string | null
}): Promise<{ ok: boolean; id?: string; reason?: string }> {
  return recordOpenQuestion(args.sessionId, {
    question: args.question,
    reason: args.reason,
    phase_id: args.phaseId ?? null,
  })
}

/**
 * Verifier mid-session audit — Session 5 wired. Delegates to the verifier
 * package's plan-diff-audit, which compares the session's most recently
 * generated (unapplied, unrejected) plan diff against the current baseline
 * — the latest applied plan_diffs row, falling back to .agent/master-plan.md.
 *
 * Flags surfaced (any → passed=false):
 *   • `remove` ops on phases that exist in the baseline (deleted phase)
 *   • `reorder` ops that change relative order of baseline phases
 *   • `edit` ops whose new body drops baseline-defined milestones
 *
 * The verifier package is a sibling workspace; we import lazily so the atlas
 * compile path doesn't pull in verifier-only deps. The import string is
 * resolved at runtime from REPO_ROOT (set by the dispatcher) or via Node's
 * default resolution when both packages share a parent.
 */
export async function requestVerifierMidSessionAudit(sessionId: string): Promise<VerifierAuditResult> {
  try {
    // Lazy + relative — verifier dist sits at ../../verifier/dist/checks/plan-diff-audit.js
    // when both packages live under cropsintel-v3/. Falls back to a name-based
    // import if a runner has linked the workspace.
    type PlanDiffAuditFn = (input: { sessionId: string }) => Promise<{
      pass: boolean
      flags: string[]
      summary: string
    }>
    let auditPlanDiff: PlanDiffAuditFn
    try {
      const mod = await import('../../../verifier/dist/checks/plan-diff-audit.js')
      auditPlanDiff = mod.auditPlanDiff as PlanDiffAuditFn
    } catch {
      const mod = await import('cropsintel-v3-verifier/dist/checks/plan-diff-audit.js')
      auditPlanDiff = mod.auditPlanDiff as PlanDiffAuditFn
    }
    const result = await auditPlanDiff({ sessionId })
    return {
      passed: result.pass,
      gaps: result.flags.map((f) => ({
        kind: f.split(':')[0] ?? 'unknown',
        description: f,
        severity: result.pass ? 'info' : 'critical',
      })),
      rationale: result.summary,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      passed: false,
      gaps: [{ kind: 'audit_unreachable', description: message, severity: 'critical' }],
      rationale: `Verifier mid-session audit failed to run: ${message}. Blocking by default (null=FAIL convention).`,
    }
  }
}

/**
 * Generate a structured plan diff from the session's accumulated decisions +
 * open questions, insert into plan_diffs (awaiting Verifier audit + user
 * approval), return diff_id. Q2: "Direct mutation with mandatory diff approval".
 *
 * Caller (Session 6's approval flow) will:
 *   1. Pass diff_jsonb to Verifier audit (Session 5 wires that)
 *   2. Render side-by-side preview to user
 *   3. On approve → plan-mutator applies ops atomically
 *   4. On reject → set rejected_at + rejection_reason
 */
export async function finalizePlanDiff(input: FinalizePlanDiffInput): Promise<FinalizePlanDiffResult> {
  const { sessionId, anthropic } = input
  if (!anthropic) throw new Error('finalizePlanDiff: anthropic client required')
  const sb = getSupabaseClient()
  if (!sb) throw new Error('finalizePlanDiff: Supabase client not configured')
  const row = await getSessionRow(sessionId)
  if (!row) throw new Error(`finalizePlanDiff: session ${sessionId} not found`)

  // Fresh context — the diff must reflect master plan state at finalize time.
  const ctx = await loadFullContext({
    sessionId,
    query: row.state.prompt,
    anthropic,
  })
  const sessionDecisions = await loadSessionDecisions(sessionId)
  const sessionOpenQs = await loadSessionOpenQuestions(sessionId)

  const systemPrompt = `${buildSystemPrompt()}

NOW SWITCHING ROLE: stop asking questions. Generate the plan diff.

DIFF FORMAT (strict JSON, no prose around it):
{
  "summary": "one-paragraph human-readable summary of the changes",
  "ops": [
    { "op": "add", "phase_id": "1.4d", "parent_id": "1.4", "title": "…", "body": "…", "launch_tier": "v1.0-beta" },
    { "op": "edit", "phase_id": "1.6", "title": "…", "body": "…" },
    { "op": "remove", "phase_id": "1.10x", "reason": "…" },
    { "op": "reorder", "parent_id": "1.10", "ordered_phase_ids": ["1.10a","1.10b","1.10c"] }
  ],
  "risks": ["risk 1", "risk 2"],
  "cited_decisions": [
    { "kind": "prior_decision", "ref": "<timestamp>", "label": "…", "excerpt": "…" }
  ]
}

Op semantics:
- "add" introduces a new phase node. parent_id may be null for top-level.
- "edit" updates a phase's title/body/launch_tier in place.
- "remove" marks a phase as removed (stored, not destroyed — Q2 keeps audit trail).
- "reorder" sets the ordering of all children of parent_id; ordered_phase_ids must be exhaustive for that parent.

Constraints:
- Every op must trace back to at least one ratified decision in this session OR a prior decision cited verbatim.
- DO NOT propose ops that contradict the V3-CODING-INSTRUCTIONS five rules.
- DO NOT propose ops outside the master plan v1.6 phase numbering scheme.
- If the session's open_questions are unresolved AND material to a proposed op, explicitly call that out in risks.

Output ONLY the JSON object.`

  const userPrompt = `${buildContextSection(ctx, sessionDecisions, sessionOpenQs)}

${buildHistorySection(row.state)}

## Your task right now

Generate the plan diff. Output JSON only, conforming to the format in the system prompt.`

  const response = await anthropic.messages.create({
    model: WORKSHOP_MODEL,
    max_tokens: 8_192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  const opusCost = (inputTokens / 1_000_000) * OPUS_INPUT_PER_M + (outputTokens / 1_000_000) * OPUS_OUTPUT_PER_M
  await recordCost('anthropic', 'workshop.finalize', WORKSHOP_MODEL, inputTokens, outputTokens, opusCost, { session_id: sessionId })

  const rawText = response.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => (b as { text: string }).text)
    .join('\n')
    .trim()
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()

  let diff: PlanDiff
  try {
    const parsed = JSON.parse(stripped) as PlanDiff
    diff = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '(model produced no summary)',
      ops: Array.isArray(parsed.ops) ? parsed.ops : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      cited_decisions: Array.isArray(parsed.cited_decisions) ? parsed.cited_decisions : [],
    }
  } catch (err) {
    throw new Error(`finalizePlanDiff: failed to parse Opus diff output: ${err instanceof Error ? err.message : err}`)
  }

  // Insert plan_diffs row.
  const { data: diffRow, error: diffErr } = await sb
    .from('plan_diffs')
    .insert({
      session_id: sessionId,
      diff_jsonb: diff,
    })
    .select('id')
    .single()
  if (diffErr || !diffRow) {
    throw new Error(`finalizePlanDiff: plan_diffs insert failed: ${diffErr?.message ?? 'no data returned'}`)
  }
  const diffId = diffRow.id as string

  // Update session: link diff + flip status to awaiting_approval, bump totals.
  const totalCostUsd = row.totalCostUsd + ctx.costUsd + opusCost
  await sb
    .from('plan_workshop_sessions')
    .update({
      plan_diff_id: diffId,
      status: 'awaiting_approval',
      total_cost_usd: totalCostUsd,
    })
    .eq('id', sessionId)

  return { diffId, diff, costUsd: ctx.costUsd + opusCost }
}

export const __test_only__ = {
  buildSystemPrompt,
  buildContextSection,
  buildHistorySection,
  normalizeTurnResult,
  clampConfidence,
}
