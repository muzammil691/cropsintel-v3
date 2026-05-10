// Phase 1.10bb-b — Multi-source context loader for Plan Workshop.
//
// Per CLAUDE-CODE-BUILD-PROMPT-plan-workshop.md + the Cowork advisor's
// Session-2 clarification, every Workshop turn is grounded in eight
// canonical sources:
//
//   1. master_plan       — `.agent/master-plan.md`
//   2. idea              — `.agent/idea.md`
//   3. concepts          — user-saved Concept rows, ranked by query relevance
//   4. v3_repo_files     — V3 codebase via github-client (1.10ak)
//   5. v1_repo_files     — V1 codebase via gitlab-client (graceful no-op w/o PAT)
//   6. prior_decisions   — decision-log + open-questions from prior sessions
//   7. runtime_state     — `.agent/runtime-state.md` (deployment truth)
//   8. v3_conventions    — `V3-CODING-INSTRUCTIONS.md` (the five immutable rules)
//
// `uploads` is also returned (caller-provided pass-through for files dragged
// into the multi-modal input header at session start) but isn't one of the
// eight grounding sources — it's session input, not standing context.
//
// Q3's anti-drift requirement bakes prior_decisions into every context load.
// Workshop's first turn cites these explicitly; later turns reference them
// when asking related questions.
//
// All sources are best-effort: empty/null paths degrade silently, the
// returned shape carries `unavailable_reasons` so the LLM prompt can be
// honest about what it does NOT have access to ("V1 not loaded — GITLAB_PAT
// missing on Atlas Railway service").

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { REPO_ROOT } from './plan-server'
import {
  loadAllConcepts,
  loadConceptsByIds,
  rankConceptsByRelevance,
  summarizeBigConceptsBatch,
  type Concept,
  type ConceptSummary,
  type RankedConcept,
  type AnthropicLikeClient,
} from './concept-retrieval'
import {
  getFileTree as getV3Tree,
  getFileContent as getV3FileContent,
  type RepoFileEntry,
} from './github-client'
import {
  getFileTree as getV1Tree,
  getFileContent as getV1FileContent,
  searchCode as v1SearchCode,
  isReachable as v1IsReachable,
  type GitlabFileEntry,
} from './gitlab-client'
import {
  summarizeForNewSession,
  type PriorDecisionsSummary,
} from './decision-log'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Caller-provided uploads: files attached to a Workshop session at start
 * via the multi-modal input header (paste, drop, picker). The frontend
 * pre-processes binary uploads into text where applicable (PDFs → text,
 * images → vision-ready descriptors) and passes the result here.
 */
export interface WorkshopUpload {
  filename: string
  mime: string
  body: string
  bytes: number
}

/**
 * GitHub/GitLab snippet returned alongside file paths so the LLM can read
 * the actual code, not just see the path. Workshop callers pass a list of
 * "interesting paths" — the loader fetches each and returns the body.
 */
export interface RepoSnippet {
  source: 'v3' | 'v1'
  path: string
  body: string
  bytes: number
}

/**
 * Input for loadFullContext. All fields optional; sensible defaults apply.
 */
export interface LoadFullContextInput {
  /** Workshop session id — used to skip the *current* session when
   *  loading prior_decisions (anti-drift: a session shouldn't re-cite
   *  itself as a "prior" decision). Optional for first-run case. */
  sessionId?: string
  /** Free-text query to drive concept relevance ranking. Falls back to
   *  the user's pasted prompt or the phase title if absent. */
  query?: string
  /** Concept ids the user explicitly selected in the multi-modal input
   *  header. These bypass relevance ranking and always load. */
  conceptIds?: readonly string[]
  /** Files the user attached via paste/upload at session start. */
  uploads?: readonly WorkshopUpload[]
  /** V3 file paths Workshop wants to read (e.g., from a wizard concept
   *  that mentions specific components). */
  v3Paths?: readonly string[]
  /** V1 file paths to read. Skipped silently if GITLAB_PAT is unset. */
  v1Paths?: readonly string[]
  /** V1 search queries to fire (e.g., "useGuestSession", "verify_jwt").
   *  Returns up to 20 hits per query. Skipped silently w/o PAT. */
  v1SearchQueries?: readonly string[]
  /** Whether to include the V3 file tree (~1k entries on a mature repo).
   *  Default true. Disable when you only need the master plan. */
  includeV3Tree?: boolean
  /** Concept ranking limit. Default 10. */
  conceptLimit?: number
  /** Prior-decisions cite limit. Default 5 per Q3. */
  priorDecisionsLimit?: number
  /** Anthropic client for big-concept summarization. If null, big concepts
   *  fall back to head/tail truncation. */
  anthropic?: AnthropicLikeClient | null
}

/**
 * Output: the eight grounding sources + meta.
 */
export interface WorkshopContext {
  /** Ranked + (optionally) summarized concepts. */
  concepts: {
    ranked: RankedConcept[]
    summaries: ConceptSummary[]
    totalAvailable: number
  }
  /** Caller-provided uploads, unmodified. */
  uploads: WorkshopUpload[]
  /** V3 codebase view: tree + the snippets the caller asked for. */
  v3: {
    treeAvailable: boolean
    tree: RepoFileEntry[]
    snippets: RepoSnippet[]
  }
  /** V1 codebase view (graceful no-op without PAT). */
  v1: {
    reachable: boolean
    tree: GitlabFileEntry[]
    snippets: RepoSnippet[]
    searchHits: Array<{ query: string; hits: Array<{ path: string; startline: number; data: string }> }>
  }
  /** Master plan markdown verbatim. Empty string on read failure. */
  masterPlan: string
  /** Idea file markdown verbatim. Empty string on read failure. */
  idea: string
  /** Runtime-state markdown verbatim — `.agent/runtime-state.md`. Atlas
   *  reads this on every spec per the operating-model handoff so Workshop
   *  questions are grounded in current deployment truth. */
  runtimeState: string
  /** V3-CODING-INSTRUCTIONS.md verbatim — the five immutable rules
   *  Workshop must respect when proposing plan diffs. Loaded so the LLM
   *  prompt can cite the rules by number when refusing scope drift. */
  v3Conventions: string
  /** Decision log + open questions from PRIOR sessions (excluding the
   *  current session if sessionId provided). */
  priorDecisions: PriorDecisionsSummary
  /** Per-source unavailability reasons for honest prompting. Keys are
   *  source names; values are why the source is empty. */
  unavailableReasons: Record<string, string>
  /** Cost of the load (Haiku summarization is the only AI cost here). */
  costUsd: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readRepoFile(relPath: string): Promise<string> {
  try {
    return await readFile(resolve(REPO_ROOT, relPath), 'utf-8')
  } catch (err) {
    console.warn(`[workshop-context] readRepoFile(${relPath}) failed:`, err instanceof Error ? err.message : err)
    return ''
  }
}

async function loadV3Snippets(paths: readonly string[]): Promise<{ snippets: RepoSnippet[]; missing: string[] }> {
  if (!paths.length) return { snippets: [], missing: [] }
  const snippets: RepoSnippet[] = []
  const missing: string[] = []
  for (let i = 0; i < paths.length; i += 5) {
    const slice = paths.slice(i, i + 5)
    const results = await Promise.all(slice.map(async p => {
      const body = await getV3FileContent(p)
      return { p, body }
    }))
    for (const { p, body } of results) {
      if (body === null) missing.push(p)
      else snippets.push({ source: 'v3', path: p, body, bytes: body.length })
    }
  }
  return { snippets, missing }
}

async function loadV1Snippets(paths: readonly string[]): Promise<{ snippets: RepoSnippet[]; missing: string[] }> {
  if (!paths.length) return { snippets: [], missing: [] }
  const snippets: RepoSnippet[] = []
  const missing: string[] = []
  for (let i = 0; i < paths.length; i += 5) {
    const slice = paths.slice(i, i + 5)
    const results = await Promise.all(slice.map(async p => {
      const body = await getV1FileContent(p)
      return { p, body }
    }))
    for (const { p, body } of results) {
      if (body === null) missing.push(p)
      else snippets.push({ source: 'v1', path: p, body, bytes: body.length })
    }
  }
  return { snippets, missing }
}

async function loadConceptsForContext(
  conceptIds: readonly string[] | undefined,
  query: string | undefined,
  limit: number,
): Promise<{ ranked: RankedConcept[]; raw: Concept[]; totalAvailable: number }> {
  // Explicit selections always load. Without explicit selections, rank ALL
  // concepts by query relevance and take the top `limit`.
  let pool: Concept[]
  let totalAvailable: number
  if (conceptIds && conceptIds.length > 0) {
    pool = await loadConceptsByIds(conceptIds)
    totalAvailable = pool.length
  } else {
    pool = await loadAllConcepts()
    totalAvailable = pool.length
  }
  const ranked = rankConceptsByRelevance(query ?? '', pool, { limit })
  // Pull the raw Concept rows for the ranked items so the summarizer has
  // the full content (the ranked rows ARE Concept rows + score/reason).
  const raw: Concept[] = ranked.map(r => {
    const { score: _s, reason: _r, ...rest } = r
    return rest as Concept
  })
  return { ranked, raw, totalAvailable }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load all eight grounding sources for a Workshop turn. Best-effort
 * throughout: missing PAT / missing file / DB error → empty source +
 * entry in `unavailableReasons`.
 *
 * The Anthropic client is required for big-concept summarization; without
 * it, big concepts fall back to head/tail truncation (still usable).
 */
export async function loadFullContext(input: LoadFullContextInput = {}): Promise<WorkshopContext> {
  const conceptLimit = input.conceptLimit ?? 10
  const priorDecisionsLimit = input.priorDecisionsLimit ?? 5
  const includeV3Tree = input.includeV3Tree !== false

  const unavailableReasons: Record<string, string> = {}
  let costUsd = 0

  // Run independent loaders in parallel — each is defensive internally.
  const [
    masterPlan,
    idea,
    runtimeState,
    v3Conventions,
    conceptsBundle,
    priorDecisions,
    v1Reachable,
  ] = await Promise.all([
    readRepoFile('.agent/master-plan.md'),
    readRepoFile('.agent/idea.md'),
    readRepoFile('.agent/runtime-state.md'),
    readRepoFile('V3-CODING-INSTRUCTIONS.md'),
    loadConceptsForContext(input.conceptIds, input.query, conceptLimit),
    summarizeForNewSession(priorDecisionsLimit),
    v1IsReachable(),
  ])

  if (!masterPlan) unavailableReasons.master_plan = '.agent/master-plan.md not readable'
  if (!idea) unavailableReasons.idea = '.agent/idea.md not readable'
  if (!runtimeState) unavailableReasons.runtime_state = '.agent/runtime-state.md not readable'
  if (!v3Conventions) unavailableReasons.v3_conventions = 'V3-CODING-INSTRUCTIONS.md not readable'
  if (conceptsBundle.totalAvailable === 0) unavailableReasons.concepts = 'no concepts in DB'

  // Concept summarization (Haiku for big ones).
  const summaries: ConceptSummary[] = await summarizeBigConceptsBatch(
    conceptsBundle.raw,
    input.anthropic ?? null,
  )
  for (const s of summaries) costUsd += s.costUsd

  // V3 + V1 trees + snippets.
  const v3TreePromise: Promise<RepoFileEntry[]> = includeV3Tree ? getV3Tree() : Promise.resolve([])
  const v3SnippetsPromise = loadV3Snippets(input.v3Paths ?? [])
  const v1TreePromise: Promise<GitlabFileEntry[]> = v1Reachable ? getV1Tree() : Promise.resolve([])
  const v1SnippetsPromise = v1Reachable ? loadV1Snippets(input.v1Paths ?? []) : Promise.resolve({ snippets: [] as RepoSnippet[], missing: [] as string[] })
  const v1SearchPromise: Promise<Array<{ query: string; hits: Array<{ path: string; startline: number; data: string }> }>> = v1Reachable
    ? Promise.all((input.v1SearchQueries ?? []).map(async q => ({ query: q, hits: await v1SearchCode(q) })))
    : Promise.resolve([])

  const [v3Tree, v3SnippetsBundle, v1Tree, v1SnippetsBundle, v1Searches] = await Promise.all([
    v3TreePromise,
    v3SnippetsPromise,
    v1TreePromise,
    v1SnippetsPromise,
    v1SearchPromise,
  ])

  if (!v1Reachable) {
    unavailableReasons.v1_codebase = 'GITLAB_PAT not set OR GitLab API unreachable; V1 reading skipped'
  }
  if (includeV3Tree && v3Tree.length === 0) {
    unavailableReasons.v3_tree = 'GITHUB_PAT not set OR repo unreachable; V3 tree empty'
  }
  if (v3SnippetsBundle.missing.length > 0) {
    unavailableReasons.v3_snippets_missing = `paths not found: ${v3SnippetsBundle.missing.slice(0, 5).join(', ')}${v3SnippetsBundle.missing.length > 5 ? ', …' : ''}`
  }
  if (v1Reachable && v1SnippetsBundle.missing.length > 0) {
    unavailableReasons.v1_snippets_missing = `paths not found: ${v1SnippetsBundle.missing.slice(0, 5).join(', ')}${v1SnippetsBundle.missing.length > 5 ? ', …' : ''}`
  }

  return {
    concepts: {
      ranked: conceptsBundle.ranked,
      summaries,
      totalAvailable: conceptsBundle.totalAvailable,
    },
    uploads: [...(input.uploads ?? [])],
    v3: {
      treeAvailable: v3Tree.length > 0,
      tree: v3Tree,
      snippets: v3SnippetsBundle.snippets,
    },
    v1: {
      reachable: v1Reachable,
      tree: v1Tree,
      snippets: v1SnippetsBundle.snippets,
      searchHits: v1Searches,
    },
    masterPlan,
    idea,
    runtimeState,
    v3Conventions,
    priorDecisions,
    unavailableReasons,
    costUsd,
  }
}

/**
 * Quick stat helper for the cockpit's "context indicator" UI:
 *   📚 Atlas read: 8 concepts, master plan §11.4, 3 V1 files, 12 V3 files
 *
 * Returns the inputs that line is built from. Pure formatting — no I/O.
 */
export function summarizeContextStats(ctx: WorkshopContext): {
  conceptCount: number
  v3FileCount: number
  v1FileCount: number
  uploadCount: number
  masterPlanLoaded: boolean
  ideaLoaded: boolean
  runtimeStateLoaded: boolean
  v3ConventionsLoaded: boolean
  priorDecisionsCount: number
} {
  return {
    conceptCount: ctx.concepts.ranked.length,
    v3FileCount: ctx.v3.snippets.length,
    v1FileCount: ctx.v1.snippets.length,
    uploadCount: ctx.uploads.length,
    masterPlanLoaded: ctx.masterPlan.length > 0,
    ideaLoaded: ctx.idea.length > 0,
    runtimeStateLoaded: ctx.runtimeState.length > 0,
    v3ConventionsLoaded: ctx.v3Conventions.length > 0,
    priorDecisionsCount: ctx.priorDecisions.total,
  }
}
