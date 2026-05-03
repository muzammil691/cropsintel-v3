import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getSupabaseClient } from './lib/supabase'
import type { Gap } from './types'

export interface ResearchInput {
  task_id: string
  head_before: string
  head_after: string
  gaps: Gap[]
  ai_judgment?: string
  spec_path?: string
  spec_body?: string
  verifier_confidence?: number
}

export interface SimilarFailure {
  task_id: string
  ran_at: string
  gaps: Gap[]
  remediation_task_id?: string | null
  similarity_score: number
}

export interface ResearchOutput {
  root_cause: string
  recommended_fix: string
  related_specs_to_check: string[]
  confidence: number
  similar_failures: SimilarFailure[]
  brains: Array<{ provider: string; verdict: string; reasoning: string }>
  skipped_debate?: boolean
  skipped_reason?: string
}

const ANTHROPIC_MODEL = 'claude-opus-4-7'
const OPENAI_MODEL = 'gpt-4o'
const GEMINI_MODEL = 'gemini-2.5-pro'

// Phase 5 of agent-loop redesign — role-specific lenses for the gap-debate.
// Mirrors atlas/src/lib/multi-brain.ts so post-failure remediation gets the
// same orthogonal critique as the pre-build debate. Each model speaks ONLY
// from its specialty so we get three lenses on one set of gaps instead of
// three overlapping critiques.
const ANALYTICAL_LENS =
  'You are the analytical reviewer in a 3-way diagnosis. Your specialty: ' +
  'architectural soundness, type safety, business logic, foundation-first ' +
  'dependency order, NEVER-list violations, security (no AI keys client-side, ' +
  'RLS on new tables, info walls). Diagnose the gaps from THIS lens — trust ' +
  'your peers (frontend & research) to cover their domains.'

const FRONTEND_LENS =
  'You are the frontend reviewer in a 3-way diagnosis. Your specialty: ' +
  'shadcn-component fit, a11y (aria-label, role, focus-visible:ring, keyboard ' +
  'nav), responsive layout (sm:/md:/lg: prefixes), motion (transition-colors ' +
  'duration-200), design tokens, loading skeletons, ≥44px touch targets. ' +
  'Diagnose the gaps from THIS lens — trust your peers to cover analytics ' +
  'and research.'

const RESEARCH_LENS =
  'You are the research reviewer in a 3-way diagnosis. Your specialty: ' +
  'V1/V2 audit lessons, master plan §11 phase ordering, workflow doc ' +
  'cross-references, prior-art alignment, similar past failures. Diagnose ' +
  'the gaps from THIS lens — trust your peers to cover analytics and frontend.'

const MEMORY_URL = process.env.MEMORY_URL ?? ''
const MEMORY_API_TOKEN = process.env.MEMORY_API_TOKEN ?? ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? ''

// Threshold: only run Multi-Brain debate when verifier confidence in the FAIL
// is high (>= 0.6). Sub-threshold fails are likely surface bugs, not systemic
// issues, and don't justify burning $0.30+ on a 3-way debate.
const DEBATE_MIN_VERIFIER_CONFIDENCE = parseFloat(process.env.DEBATE_MIN_VERIFIER_CONFIDENCE ?? '0.6')

function buildSearchQuery(input: ResearchInput): string {
  const gapDescriptions = input.gaps.slice(0, 3).map(g => `${g.check}: ${g.actual}`).join(' | ')
  return `Verifier failure: ${input.task_id} — ${gapDescriptions}`
}

async function searchSimilarFailures(input: ResearchInput): Promise<SimilarFailure[]> {
  const queryText = buildSearchQuery(input)

  // Path 1: live memory service via HTTP
  if (MEMORY_URL) {
    try {
      const res = await fetch(`${MEMORY_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(MEMORY_API_TOKEN ? { 'Authorization': `Bearer ${MEMORY_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ query: queryText, source_filter: ['verifier-runs', 'github-history'], match_count: 5 }),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const data = await res.json() as { chunks?: Array<{ content?: string; metadata?: Record<string, unknown>; similarity?: number }> }
        return (data.chunks ?? []).map(c => {
          const meta = c.metadata ?? {}
          return {
            task_id: (meta.task_id as string) ?? 'unknown',
            ran_at: (meta.ran_at as string) ?? '',
            gaps: (meta.gaps as Gap[]) ?? [],
            remediation_task_id: (meta.remediation_task_id as string | undefined) ?? null,
            similarity_score: c.similarity ?? 0,
          }
        })
      }
    } catch (err) {
      console.warn('[research] memory service search failed:', err instanceof Error ? err.message : String(err))
    }
  }

  // Path 2: fallback — query verifier_runs directly for past failures with overlapping checks
  const sb = getSupabaseClient()
  if (!sb) return []
  try {
    const checks = input.gaps.map(g => g.check).filter(Boolean)
    if (checks.length === 0) return []
    const { data } = await sb
      .from('verifier_runs')
      .select('task_id, ran_at, gaps, remediation_task_id')
      .eq('passed', false)
      .neq('task_id', input.task_id)
      .order('ran_at', { ascending: false })
      .limit(50)
    if (!data) return []
    const matches: SimilarFailure[] = []
    for (const row of data) {
      const rowGaps = (row.gaps as Gap[]) ?? []
      const rowChecks = new Set(rowGaps.map(g => g.check))
      const overlap = checks.filter(c => rowChecks.has(c)).length
      if (overlap === 0) continue
      const similarity = overlap / Math.max(checks.length, 1)
      matches.push({
        task_id: row.task_id as string,
        ran_at: row.ran_at as string,
        gaps: rowGaps,
        remediation_task_id: row.remediation_task_id as string | null,
        similarity_score: similarity,
      })
    }
    matches.sort((a, b) => b.similarity_score - a.similarity_score)
    return matches.slice(0, 5)
  } catch (err) {
    console.warn('[research] fallback similar-failure search failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

function buildDebatePrompt(input: ResearchInput, similar: SimilarFailure[]): string {
  const gapList = input.gaps.map((g, i) =>
    `${i + 1}. [${g.severity}] ${g.check}: expected="${g.expected}" actual="${g.actual}" remediation="${g.remediation}"`,
  ).join('\n')

  const similarBlock = similar.length === 0
    ? 'No similar past failures found in memory.'
    : similar.map(s => `- ${s.task_id} (${s.ran_at}, similarity ${s.similarity_score.toFixed(2)}): ${s.gaps[0]?.check ?? 'no check'} — ${s.gaps[0]?.actual ?? ''}${s.remediation_task_id ? ` (resolved via ${s.remediation_task_id})` : ' (no resolution recorded)'}`).join('\n')

  return `You are a senior code-reviewer assistant on CropsIntel V3. The Verifier just BLOCKED a Builder push. Diagnose the ROOT CAUSE so the next Builder attempt can fix it cleanly instead of guessing.

TASK ID: ${input.task_id}
COMMIT RANGE: ${input.head_before}..${input.head_after}

GAPS THE VERIFIER FOUND:
${gapList}

VERIFIER AI JUDGMENT NOTES:
${(input.ai_judgment ?? 'none').slice(0, 2000)}

SPEC EXCERPT:
${(input.spec_body ?? 'no spec body provided').slice(0, 4000)}

SIMILAR PAST FAILURES (from memory):
${similarBlock}

Respond with ONLY valid JSON in this exact shape:
{
  "root_cause": "1-2 sentence diagnosis of the underlying cause (e.g. 'missing migration', 'misunderstood RLS rule', 'parallel restart', 'dependency not yet shipped')",
  "recommended_fix": "concrete steps the next Builder attempt should take",
  "related_specs_to_check": ["phase-X.Y-foo", "phase-X.Y-bar"],
  "confidence": 0.0 to 1.0
}

confidence semantics:
- >= 0.7 = root cause is clear, Builder should retry with this guidance
- 0.4 - 0.7 = plausible diagnosis but unsure, Builder retries with low expectations
- < 0.4 = we can't tell what's wrong from current evidence, escalate to human

End with: VERDICT: <root_cause-as-one-line-summary>`
}

interface BrainVote {
  provider: string
  model: string
  ok: boolean
  raw: string
  parsed?: { root_cause?: string; recommended_fix?: string; related_specs_to_check?: string[]; confidence?: number }
  error?: string
}

async function askClaude(prompt: string, system?: string): Promise<BrainVote> {
  if (!ANTHROPIC_API_KEY) return { provider: 'claude', model: ANTHROPIC_MODEL, ok: false, raw: '', error: 'ANTHROPIC_API_KEY not set' }
  try {
    const body: Record<string, unknown> = {
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }
    if (system) body.system = system
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      return { provider: 'claude', model: ANTHROPIC_MODEL, ok: false, raw: '', error: `HTTP ${res.status}` }
    }
    const json = await res.json() as { content?: Array<{ text?: string }> }
    const text = json.content?.[0]?.text ?? ''
    return { provider: 'claude', model: ANTHROPIC_MODEL, ok: true, raw: text, parsed: parseStructured(text) }
  } catch (err) {
    return { provider: 'claude', model: ANTHROPIC_MODEL, ok: false, raw: '', error: err instanceof Error ? err.message : String(err) }
  }
}

async function askOpenAI(prompt: string, system?: string): Promise<BrainVote> {
  if (!OPENAI_API_KEY) return { provider: 'openai', model: OPENAI_MODEL, ok: false, raw: '', error: 'OPENAI_API_KEY not set' }
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY })
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (system) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: prompt })
    const res = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    })
    const text = res.choices[0]?.message?.content ?? ''
    return { provider: 'openai', model: OPENAI_MODEL, ok: true, raw: text, parsed: parseStructured(text) }
  } catch (err) {
    return { provider: 'openai', model: OPENAI_MODEL, ok: false, raw: '', error: err instanceof Error ? err.message : String(err) }
  }
}

async function askGemini(prompt: string, system?: string): Promise<BrainVote> {
  if (!GOOGLE_API_KEY) return { provider: 'gemini', model: GEMINI_MODEL, ok: false, raw: '', error: 'GOOGLE_API_KEY not set' }
  try {
    const ai = new GoogleGenerativeAI(GOOGLE_API_KEY)
    const model = ai.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: 'application/json' } })
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt
    const res = await model.generateContent(fullPrompt)
    const text = res.response.text()
    return { provider: 'gemini', model: GEMINI_MODEL, ok: true, raw: text, parsed: parseStructured(text) }
  } catch (err) {
    return { provider: 'gemini', model: GEMINI_MODEL, ok: false, raw: '', error: err instanceof Error ? err.message : String(err) }
  }
}

function parseStructured(text: string): BrainVote['parsed'] {
  // Strip code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  // Find first { ... last } block
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return undefined
  const slice = cleaned.slice(start, end + 1)
  try {
    return JSON.parse(slice) as BrainVote['parsed']
  } catch {
    return undefined
  }
}

function consolidate(votes: BrainVote[]): { root_cause: string; recommended_fix: string; related_specs_to_check: string[]; confidence: number } {
  const goodVotes = votes.filter(v => v.ok && v.parsed)
  if (goodVotes.length === 0) {
    return {
      root_cause: 'Multi-Brain debate produced no usable verdicts (all providers failed or returned malformed JSON).',
      recommended_fix: 'Builder should re-attempt with the original gap list and treat this as a low-confidence retry.',
      related_specs_to_check: [],
      confidence: 0,
    }
  }
  // Average confidence across votes; concatenate root_cause from highest-confidence vote
  const avgConfidence = goodVotes.reduce((sum, v) => sum + (v.parsed?.confidence ?? 0), 0) / goodVotes.length
  const sorted = [...goodVotes].sort((a, b) => (b.parsed?.confidence ?? 0) - (a.parsed?.confidence ?? 0))
  const top = sorted[0].parsed!
  // Union of related specs across all votes
  const specSet = new Set<string>()
  for (const v of goodVotes) {
    for (const s of v.parsed?.related_specs_to_check ?? []) specSet.add(s)
  }
  return {
    root_cause: top.root_cause ?? 'No root cause provided by top vote.',
    recommended_fix: top.recommended_fix ?? 'No fix recommended.',
    related_specs_to_check: [...specSet].slice(0, 10),
    confidence: Math.max(0, Math.min(1, avgConfidence)),
  }
}

export async function runResearch(input: ResearchInput): Promise<ResearchOutput> {
  const similar = await searchSimilarFailures(input)

  const verifierConfidence = input.verifier_confidence ?? 1.0
  if (verifierConfidence < DEBATE_MIN_VERIFIER_CONFIDENCE) {
    // Sub-threshold: skip Multi-Brain to save budget
    return {
      root_cause: 'Verifier confidence in this fail is below the debate threshold — likely a surface bug, not a systemic issue. Builder should retry with the original gap list.',
      recommended_fix: 'Address each gap one-by-one as listed; do not invent broader scope.',
      related_specs_to_check: [],
      confidence: 0.5,
      similar_failures: similar,
      brains: [],
      skipped_debate: true,
      skipped_reason: `verifier_confidence=${verifierConfidence} < threshold=${DEBATE_MIN_VERIFIER_CONFIDENCE}`,
    }
  }

  const debatePrompt = buildDebatePrompt(input, similar)
  // Each brain diagnoses from its specialty (Phase 5 of agent-loop redesign).
  // Same prompt, different lenses → three orthogonal critiques rather than
  // three overlapping ones.
  let [claudeVote, openaiVote, geminiVote] = await Promise.all([
    askClaude(debatePrompt, ANALYTICAL_LENS),
    askOpenAI(debatePrompt, FRONTEND_LENS),
    askGemini(debatePrompt, RESEARCH_LENS),
  ])

  // Step 2 of agent-loop stabilization: when Gemini fails transiently
  // (503 / overloaded / timeout — the recurring pattern this week), fall
  // back to a second GPT-4o call carrying the RESEARCH_LENS so the
  // consolidator gets 3 votes instead of 2 + a hole.
  if (!geminiVote.ok) {
    const transient = /503|429|overloaded|service unavailable|high demand|timeout|etimedout/i.test(geminiVote.error ?? '')
    if (transient) {
      console.warn(`[research] Gemini transient failure — falling back to GPT-4o with RESEARCH_LENS`)
      try {
        const fallback = await askOpenAI(debatePrompt, RESEARCH_LENS)
        if (fallback.ok) {
          geminiVote = { ...fallback, provider: 'gemini-fallback-via-gpt4o' }
        }
      } catch (fbErr) {
        console.error('[research] GPT-4o research fallback also failed:', fbErr instanceof Error ? fbErr.message : fbErr)
      }
    }
  }

  const consolidated = consolidate([claudeVote, openaiVote, geminiVote])

  return {
    ...consolidated,
    similar_failures: similar,
    brains: [claudeVote, openaiVote, geminiVote].map(v => ({
      provider: v.provider,
      verdict: v.parsed?.root_cause ?? (v.error ? `error: ${v.error}` : 'no parse'),
      reasoning: v.raw.slice(0, 500),
    })),
  }
}
