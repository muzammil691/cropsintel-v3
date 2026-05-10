// Phase 1.10bb-b — Concept retrieval for Plan Workshop.
//
// Workshop turns ground questions in the user's saved concepts (paste,
// upload, voice, past-chat — populated by the cockpit Concepts panel
// shipped in 1.10aj). Two responsibilities here:
//
//   1. Load concepts from the `concepts` table (RLS service-role-only).
//   2. Rank them by relevance to a free-text query (token overlap + theme
//      match) so Workshop fires its limited context budget at the most
//      pertinent ones.
//   3. Summarize "big" concepts (>2k chars) with Claude Haiku so a long
//      pasted document doesn't dominate the prompt budget.
//
// Embedding-based retrieval is deferred — Workshop sessions are sparse
// (handful per day) and the concepts table is tiny (low hundreds at most),
// so token-overlap ranking is good enough until we hit a real ceiling.

import { getSupabaseClient } from './supabase'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const BIG_CONCEPT_CHARS = 2_000
const SUMMARY_TARGET_CHARS = 600

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConceptSourceType = 'paste' | 'upload' | 'voice' | 'past-chat'

export interface Concept {
  id: string
  title: string
  content: string
  source_type: ConceptSourceType
  source_ref: string | null
  theme: string | null
  used_in_phases: string[]
  metadata: Record<string, unknown>
  created_at: string
  created_by: string | null
}

export interface RankedConcept extends Concept {
  /** 0..1 relevance score; higher = more relevant. */
  score: number
  /** Why this concept ranked where it did — useful for Workshop citations. */
  reason: string
}

export interface ConceptSummary {
  conceptId: string
  title: string
  /** Whether the summary is a Claude-generated condensation (true) or the
   *  raw content (false, for short concepts that fit unchanged). */
  summarized: boolean
  body: string
  originalChars: number
  costUsd: number
}

/** Anthropic Messages-API surface used by summarizeBigConcept. */
export interface AnthropicLikeClient {
  messages: {
    create: (args: {
      model: string
      max_tokens: number
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      system?: string
    }) => Promise<{
      content: Array<{ type: string; text?: string }>
      usage: { input_tokens: number; output_tokens: number }
    }>
  }
}

// ─── Loaders ────────────────────────────────────────────────────────────────

/**
 * Load every concept in the table, newest first. Empty array on missing
 * Supabase client or DB error — never throws.
 */
export async function loadAllConcepts(): Promise<Concept[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('concepts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error || !data) return []
  return (data as Array<Record<string, unknown>>).map(rowToConcept)
}

/**
 * Load a specific subset of concepts by id — used when the Workshop UI
 * passes the user's explicitly-selected concept_ids[] from the multi-modal
 * input header.
 */
export async function loadConceptsByIds(ids: readonly string[]): Promise<Concept[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('concepts')
    .select('*')
    .in('id', ids)
  if (error || !data) return []
  return (data as Array<Record<string, unknown>>).map(rowToConcept)
}

function rowToConcept(row: Record<string, unknown>): Concept {
  const usedIn = row.used_in_phases
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    source_type: (row.source_type as ConceptSourceType) ?? 'paste',
    source_ref: (row.source_ref as string | null) ?? null,
    theme: (row.theme as string | null) ?? null,
    used_in_phases: Array.isArray(usedIn) ? (usedIn as string[]) : [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at ?? ''),
    created_by: (row.created_by as string | null) ?? null,
  }
}

// ─── Ranking ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about',
  'have', 'has', 'are', 'was', 'were', 'will', 'would', 'should', 'could',
  'a', 'an', 'is', 'be', 'on', 'in', 'of', 'to', 'or', 'as', 'at', 'by',
  'it', 'its', 'we', 'our', 'you', 'your', 'i', 'me', 'my',
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

/**
 * Rank concepts by relevance to a free-text query. The score blends:
 *   • token overlap between query and concept title/content (max 0.7)
 *   • theme match if query mentions a tag-ish word (max 0.2)
 *   • recency (max 0.1) so a stale concept doesn't crowd out a fresh one
 *
 * If the query is empty, returns concepts in newest-first order with
 * score=0 and a "no query" reason. Workshop callers can still use the
 * order; they just don't have a relevance signal.
 */
export function rankConceptsByRelevance(
  query: string,
  concepts: readonly Concept[],
  opts?: { limit?: number },
): RankedConcept[] {
  const limit = opts?.limit ?? 20
  const queryTokens = new Set(tokenize(query))

  if (queryTokens.size === 0) {
    return concepts
      .slice(0, limit)
      .map(c => ({ ...c, score: 0, reason: 'no query — recency order' }))
  }

  const now = Date.now()
  const ranked: RankedConcept[] = concepts.map(c => {
    const titleTokens = new Set(tokenize(c.title))
    const contentTokens = new Set(tokenize(c.content.slice(0, 5_000)))

    let titleHits = 0
    let contentHits = 0
    for (const q of queryTokens) {
      if (titleTokens.has(q)) titleHits++
      if (contentTokens.has(q)) contentHits++
    }
    const overlapScore = Math.min(
      0.7,
      0.4 * (titleHits / queryTokens.size) + 0.3 * (contentHits / queryTokens.size),
    )

    const themeScore = (c.theme && queryTokens.has(c.theme.toLowerCase())) ? 0.2 : 0

    const ageMs = c.created_at ? Math.max(0, now - new Date(c.created_at).getTime()) : Infinity
    const recencyScore = Number.isFinite(ageMs)
      ? 0.1 * Math.exp(-(ageMs / (30 * 24 * 60 * 60 * 1_000)))  // 30-day half-life
      : 0

    const score = overlapScore + themeScore + recencyScore

    const reasonParts: string[] = []
    if (titleHits > 0) reasonParts.push(`${titleHits}/${queryTokens.size} title hits`)
    if (contentHits > 0) reasonParts.push(`${contentHits}/${queryTokens.size} body hits`)
    if (themeScore > 0) reasonParts.push(`theme match`)
    if (recencyScore > 0.02) reasonParts.push(`recent`)
    const reason = reasonParts.length ? reasonParts.join(', ') : 'no overlap with query'

    return { ...c, score, reason }
  })

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ─── Summarization ──────────────────────────────────────────────────────────

/**
 * Condense a concept's body via Claude Haiku when it exceeds BIG_CONCEPT_CHARS.
 * Returns the raw content unchanged for short concepts (no AI cost). The
 * summarized=true path costs roughly $0.001-0.003 per concept.
 *
 * Caller passes the Anthropic client so we don't construct one per call —
 * Workshop session keeps a single client through the loader.
 */
export async function summarizeBigConcept(
  concept: Concept,
  anthropic: AnthropicLikeClient | null,
): Promise<ConceptSummary> {
  const originalChars = concept.content.length

  // Short concepts pass through verbatim.
  if (originalChars <= BIG_CONCEPT_CHARS) {
    return {
      conceptId: concept.id,
      title: concept.title,
      summarized: false,
      body: concept.content,
      originalChars,
      costUsd: 0,
    }
  }

  if (!anthropic) {
    // No client — fall back to a head/tail truncation so the caller still
    // gets actionable content (better than an empty summary).
    const head = concept.content.slice(0, Math.floor(SUMMARY_TARGET_CHARS / 2))
    const tail = concept.content.slice(-Math.floor(SUMMARY_TARGET_CHARS / 2))
    return {
      conceptId: concept.id,
      title: concept.title,
      summarized: false,
      body: `${head}\n\n[…truncated, ${originalChars - head.length - tail.length} chars omitted; no Anthropic client available…]\n\n${tail}`,
      originalChars,
      costUsd: 0,
    }
  }

  const systemPrompt = `You distill saved planning concepts into tight summaries the Plan Workshop can cite mid-conversation. Goals:
- Preserve every concrete decision, constraint, named entity, file path, person, and number.
- Lose padding, anecdotes, repetitions, and conversational tone.
- Output approximately ${SUMMARY_TARGET_CHARS} characters of plain text — no headings, no bullet markup unless source uses them.
- If the source contains code or pseudocode, keep the smallest excerpt that conveys the pattern.
- Do not speculate beyond the source. Do not editorialize.`

  const userPrompt = `Concept title: ${concept.title}
Source type: ${concept.source_type}${concept.theme ? `\nTheme: ${concept.theme}` : ''}

---

${concept.content}`

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1_024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const text = response.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text!)
      .join('\n')
      .trim()

    // Haiku 4.5 pricing per 1M tokens: $1 input / $5 output (approximate).
    const inputCost = (response.usage.input_tokens / 1_000_000) * 1
    const outputCost = (response.usage.output_tokens / 1_000_000) * 5
    const costUsd = inputCost + outputCost

    if (!text) {
      // Empty model output — fall back to truncation rather than block.
      return {
        conceptId: concept.id,
        title: concept.title,
        summarized: false,
        body: concept.content.slice(0, SUMMARY_TARGET_CHARS) + '\n\n[…model returned empty summary; head truncation shown…]',
        originalChars,
        costUsd,
      }
    }
    return {
      conceptId: concept.id,
      title: concept.title,
      summarized: true,
      body: text,
      originalChars,
      costUsd,
    }
  } catch (err) {
    console.warn('[concept-retrieval] summarizeBigConcept failed:', err instanceof Error ? err.message : err)
    return {
      conceptId: concept.id,
      title: concept.title,
      summarized: false,
      body: concept.content.slice(0, SUMMARY_TARGET_CHARS) + `\n\n[…summarization failed: ${err instanceof Error ? err.message : 'unknown'}; head truncation shown…]`,
      originalChars,
      costUsd: 0,
    }
  }
}

/**
 * Summarize many concepts in parallel, capped at concurrency=3 to respect
 * Anthropic rate limits and keep wall-clock predictable.
 */
export async function summarizeBigConceptsBatch(
  concepts: readonly Concept[],
  anthropic: AnthropicLikeClient | null,
): Promise<ConceptSummary[]> {
  const out: ConceptSummary[] = []
  const concurrency = 3
  for (let i = 0; i < concepts.length; i += concurrency) {
    const slice = concepts.slice(i, i + concurrency)
    const results = await Promise.all(slice.map(c => summarizeBigConcept(c, anthropic)))
    out.push(...results)
  }
  return out
}

export const __test_only__ = { tokenize, BIG_CONCEPT_CHARS, SUMMARY_TARGET_CHARS }
