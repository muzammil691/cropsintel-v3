// Phase 1.10bb-a — Decision log + open-questions helper for Plan Workshop sessions.
//
// The Workshop's Q3 architectural decision (locked 2026-05-10) requires
// anti-drift across sessions: every session must read all prior decisions,
// must explicitly cite them when asking related questions, must never
// silently assume prior decisions extend to new contexts, and ambiguous
// discussion must be logged as `open_question` rather than auto-resolved.
//
// This module is the read/write surface for that contract. Session 3's
// workshop-engine.ts orchestrates the LLM turns; it calls in here whenever
// a decision crystalizes or an open question is raised.
//
// Source of truth: plan_workshop_sessions table.
//   • decision_log   jsonb array of Decision rows
//   • open_questions jsonb array of OpenQuestion rows
//
// Best-effort throughout: a missing Supabase client returns ok=false with
// reason, never throws to the caller's caller.

import { getSupabaseClient } from './supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A crystalized architectural choice from a workshop turn. Stored in
 * plan_workshop_sessions.decision_log (jsonb array).
 *
 * The {decided, over, because, phase_id?, timestamp} shape comes verbatim
 * from CLAUDE-CODE-BUILD-PROMPT-plan-workshop.md §Q3:
 *   "Each session produces a decision log:
 *    {decided X, over Y, because Z, phase_id?, timestamp} array".
 */
export interface Decision {
  /** What was chosen (the answer). */
  decided: string
  /** What it was chosen over (the alternative). */
  over: string
  /** Reasoning — must be substantive, not just a restatement of `decided`. */
  because: string
  /** Optional plan-node id this decision is scoped to. Null for cross-cutting. */
  phase_id?: string | null
  /** ISO 8601 timestamp; the helper sets this on record. */
  timestamp: string
  /** Free-form metadata so future sessions can cite source turns / concepts. */
  metadata?: Record<string, unknown>
}

/**
 * An ambiguity left unresolved in this turn. The Workshop MUST NOT
 * auto-resolve open questions — they survive as work-items for later
 * turns, later sessions, or a Verifier audit pass.
 */
export interface OpenQuestion {
  /** Stable id within the session — used to resolve later. */
  id: string
  /** The actual question text, framed neutrally. */
  question: string
  /** Why it can't be resolved now (missing context, fork awaiting user, etc.). */
  reason: string
  /** Optional plan-node scope. */
  phase_id?: string | null
  /** ISO 8601 of when raised. */
  raised_at: string
  /** Free-form metadata. */
  metadata?: Record<string, unknown>
}

export interface OpResult {
  ok: boolean
  reason?: string
}

/**
 * Anti-drift summary handed to a NEW workshop session at session start.
 * Workshop's first turn lists 3-5 prior decisions and asks
 * "still hold? revisit?" — this is what powers that turn.
 */
export interface PriorDecisionsSummary {
  /** All decisions across all completed/active prior sessions. */
  total: number
  /** Most-recent N decisions (default 5) for the first-turn cite list. */
  recent: Decision[]
  /** Total open questions not yet resolved. */
  openQuestionsTotal: number
  /** Most-recent N open questions for the first-turn cite list. */
  recentOpenQuestions: OpenQuestion[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Generate a stable id for a new open question. Avoids pulling crypto.randomUUID
 * directly so callers in older Node runtimes (e.g. legacy Builder containers)
 * still work — falls back to a millisecond+random suffix.
 */
function newOpenQuestionId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `oq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// ─── Read API ───────────────────────────────────────────────────────────────

/**
 * Load every decision recorded in a single workshop session, oldest first.
 * Returns empty array on missing client / missing row / parse error.
 */
export async function loadSessionDecisions(sessionId: string): Promise<Decision[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('plan_workshop_sessions')
    .select('decision_log')
    .eq('id', sessionId)
    .single()
  if (error || !data) return []
  const log = (data.decision_log ?? []) as unknown
  return Array.isArray(log) ? (log as Decision[]) : []
}

/**
 * Load every decision across every workshop session (active + completed +
 * awaiting_approval). Used by Session 3's workshop-engine when priming a
 * new session — the anti-drift contract requires reading ALL prior
 * decisions, not just the most recent session's.
 *
 * Excludes 'abandoned' sessions deliberately: an abandoned session's
 * decisions weren't ratified through the diff-approval gate and should
 * not silently propagate into future sessions.
 */
export async function loadAllPriorDecisions(): Promise<Decision[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('plan_workshop_sessions')
    .select('id, decision_log, started_at')
    .neq('status', 'abandoned')
    .order('started_at', { ascending: true })
  if (error || !data) return []
  const out: Decision[] = []
  for (const row of data as Array<{ decision_log: unknown }>) {
    const log = row.decision_log
    if (Array.isArray(log)) out.push(...(log as Decision[]))
  }
  return out
}

/**
 * Load open questions from a single session, oldest first.
 */
export async function loadSessionOpenQuestions(sessionId: string): Promise<OpenQuestion[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('plan_workshop_sessions')
    .select('open_questions')
    .eq('id', sessionId)
    .single()
  if (error || !data) return []
  const oq = (data.open_questions ?? []) as unknown
  return Array.isArray(oq) ? (oq as OpenQuestion[]) : []
}

/**
 * Load all unresolved open questions across non-abandoned sessions. Surfaced
 * to a new session so it can offer to revisit unresolved ambiguities first.
 */
export async function loadAllOpenQuestions(): Promise<OpenQuestion[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('plan_workshop_sessions')
    .select('id, open_questions, started_at')
    .neq('status', 'abandoned')
    .order('started_at', { ascending: true })
  if (error || !data) return []
  const out: OpenQuestion[] = []
  for (const row of data as Array<{ open_questions: unknown }>) {
    const oq = row.open_questions
    if (Array.isArray(oq)) out.push(...(oq as OpenQuestion[]))
  }
  return out
}

// ─── Write API ──────────────────────────────────────────────────────────────

/**
 * Append a decision to a session's decision_log. Caller passes the substantive
 * fields; we set timestamp + return ok/reason. Read-modify-write pattern is
 * acceptable here because Workshop sessions are single-writer per turn (the
 * engine drives them; no concurrent UI writes).
 */
export async function recordDecision(
  sessionId: string,
  decision: Omit<Decision, 'timestamp'> & { timestamp?: string },
): Promise<OpResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'Supabase client not configured' }

  const existing = await loadSessionDecisions(sessionId)
  const next: Decision = {
    decided: decision.decided,
    over: decision.over,
    because: decision.because,
    phase_id: decision.phase_id ?? null,
    timestamp: decision.timestamp ?? nowIso(),
    metadata: decision.metadata,
  }
  const merged = [...existing, next]

  const { error } = await sb
    .from('plan_workshop_sessions')
    .update({ decision_log: merged })
    .eq('id', sessionId)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

/**
 * Append an open question. Generates a stable id so callers can resolve
 * later without re-reading the array.
 */
export async function recordOpenQuestion(
  sessionId: string,
  question: Omit<OpenQuestion, 'id' | 'raised_at'> & { id?: string; raised_at?: string },
): Promise<OpResult & { id?: string }> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'Supabase client not configured' }

  const existing = await loadSessionOpenQuestions(sessionId)
  const id = question.id ?? newOpenQuestionId()
  const next: OpenQuestion = {
    id,
    question: question.question,
    reason: question.reason,
    phase_id: question.phase_id ?? null,
    raised_at: question.raised_at ?? nowIso(),
    metadata: question.metadata,
  }
  const merged = [...existing, next]

  const { error } = await sb
    .from('plan_workshop_sessions')
    .update({ open_questions: merged })
    .eq('id', sessionId)
  if (error) return { ok: false, reason: error.message }
  return { ok: true, id }
}

/**
 * Resolve an open question by promoting it into the decision_log. Removes
 * the question from open_questions and appends a Decision derived from it.
 * If the question id isn't found, returns ok=false (caller can surface).
 */
export async function resolveOpenQuestion(
  sessionId: string,
  questionId: string,
  resolution: Omit<Decision, 'timestamp' | 'phase_id'> & { phase_id?: string | null },
): Promise<OpResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'Supabase client not configured' }

  const existing = await loadSessionOpenQuestions(sessionId)
  const idx = existing.findIndex(q => q.id === questionId)
  if (idx < 0) return { ok: false, reason: `open question not found: ${questionId}` }

  const removed = existing[idx]
  const remainingQuestions = [...existing.slice(0, idx), ...existing.slice(idx + 1)]

  const decisions = await loadSessionDecisions(sessionId)
  const next: Decision = {
    decided: resolution.decided,
    over: resolution.over,
    because: resolution.because,
    phase_id: resolution.phase_id ?? removed.phase_id ?? null,
    timestamp: nowIso(),
    metadata: { ...(resolution.metadata ?? {}), resolved_open_question_id: questionId },
  }
  const mergedDecisions = [...decisions, next]

  const { error } = await sb
    .from('plan_workshop_sessions')
    .update({
      open_questions: remainingQuestions,
      decision_log: mergedDecisions,
    })
    .eq('id', sessionId)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

// ─── Summarize API ──────────────────────────────────────────────────────────

/**
 * Build the prior-decisions summary for a NEW session's first turn. Per Q3,
 * Workshop's first turn lists 3-5 prior decisions and asks "still hold?
 * revisit?". The `recent` slice (default 5) is what populates that turn.
 *
 * The `recent` items are returned newest-first — the conversation surface
 * cares most about the freshest decisions.
 */
export async function summarizeForNewSession(
  recentLimit: number = 5,
): Promise<PriorDecisionsSummary> {
  const allDecisions = await loadAllPriorDecisions()
  const allOpenQuestions = await loadAllOpenQuestions()

  // Newest-first slice without mutating the source array.
  const sortedDecisions = [...allDecisions].sort((a, b) => {
    const ta = a.timestamp ?? ''
    const tb = b.timestamp ?? ''
    return tb.localeCompare(ta)
  })
  const sortedQuestions = [...allOpenQuestions].sort((a, b) => {
    const ta = a.raised_at ?? ''
    const tb = b.raised_at ?? ''
    return tb.localeCompare(ta)
  })

  return {
    total: allDecisions.length,
    recent: sortedDecisions.slice(0, recentLimit),
    openQuestionsTotal: allOpenQuestions.length,
    recentOpenQuestions: sortedQuestions.slice(0, recentLimit),
  }
}

/**
 * Format a Decision as a one-line citation suitable for embedding in an
 * Atlas chat turn. The Workshop must "explicitly cite" prior decisions —
 * this is the canonical citation shape so all citation surfaces match.
 */
export function formatDecisionCitation(d: Decision): string {
  const scope = d.phase_id ? ` (phase ${d.phase_id})` : ''
  const ts = d.timestamp ? d.timestamp.slice(0, 10) : ''
  return `[${ts}${scope}] decided "${d.decided}" over "${d.over}" because: ${d.because}`
}

/**
 * Format an OpenQuestion the same way, for "we still need to resolve"
 * citation lists at session start.
 */
export function formatOpenQuestionCitation(q: OpenQuestion): string {
  const scope = q.phase_id ? ` (phase ${q.phase_id})` : ''
  const ts = q.raised_at ? q.raised_at.slice(0, 10) : ''
  return `[${ts}${scope}] open: "${q.question}" — ${q.reason}`
}
