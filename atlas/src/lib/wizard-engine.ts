// Phase 1.10aj — Selection wizard engine.
//
// When the user clicks Add or Modify in the cockpit, Atlas proposes 3-7
// multi-choice questions that resolve a vague phase into a concrete spec.
// Claude Sonnet generates the questions; the human picks answers; we then
// generate spec markdown from the answers in spec-from-wizard.ts.
//
// Defensive on every external call: a missing API key or LLM hiccup falls
// back to a static question set so the UI never blocks.

import { askClaude } from '../providers/claude'
import { recordCost } from './cost-log'
import { getFileContent, getFileTree } from './github-client'
import { getRepoIndex, type RepoIndex } from './repo-index'

export interface WizardQuestion {
  id: string
  prompt: string
  choices: string[]              // 2-5 short option labels
  allowFreeText: boolean         // true → user can type instead of picking
  rationale?: string             // optional hint shown next to the question
}

export interface RepoContext {
  index: RepoIndex
  relevantFiles: string[]        // file paths matched by phase keywords
  relevantContents: { path: string; content: string }[]  // up to 5 sampled bodies
}

export interface WizardProposeInput {
  parentTitle: string
  parentBody: string
  phaseHint: string
  conceptSummaries?: string[]    // titles + 1-line excerpts of relevant concepts
  recentDoneSpecs?: string[]     // filenames of recently shipped specs (context)
  mode: 'add' | 'modify'
  existingSpec?: string          // when mode='modify', the current spec body
}

export interface WizardProposeResult {
  questions: WizardQuestion[]
  costUsd: number
  source: 'claude' | 'fallback'
}

const DEFAULT_QUESTIONS: WizardQuestion[] = [
  {
    id: 'role',
    prompt: 'Primary user role for this feature?',
    choices: ['registered', 'verified', 'admin', 'any'],
    allowFreeText: true,
  },
  {
    id: 'whatsapp',
    prompt: 'Should this integrate with WhatsApp?',
    choices: ['yes — outbound', 'yes — inbound', 'no'],
    allowFreeText: false,
  },
  {
    id: 'data_shape',
    prompt: 'Data shape:',
    choices: ['read-only', 'read+write', 'event-based'],
    allowFreeText: false,
  },
  {
    id: 'auto_confirm',
    prompt: 'Approve auto-confirmation on small offers?',
    choices: ['yes', 'no — always Maxons review'],
    allowFreeText: false,
  },
  {
    id: 'finalize',
    prompt: 'Looks good — generate spec?',
    choices: ['yes', 'no — let me edit'],
    allowFreeText: false,
  },
]

/**
 * Ask Claude Sonnet for 3-7 multi-choice questions that resolve `parentTitle`
 * into a concrete spec. Returns a structured WizardQuestion[]. On any failure
 * (no API key, parse error, timeout) returns DEFAULT_QUESTIONS so the UI
 * keeps moving.
 */
export async function proposeWizardQuestions(
  input: WizardProposeInput,
): Promise<WizardProposeResult> {
  const parts: string[] = []
  parts.push(`Parent phase: ${input.parentTitle}`)
  if (input.phaseHint) parts.push(`Phase hint: ${input.phaseHint}`)
  if (input.parentBody) {
    const excerpt = input.parentBody.slice(0, 1200)
    parts.push(`Parent body excerpt:\n${excerpt}`)
  }
  if (input.mode === 'modify' && input.existingSpec) {
    parts.push(`Current spec body:\n${input.existingSpec.slice(0, 2000)}`)
  }
  if (input.conceptSummaries && input.conceptSummaries.length > 0) {
    parts.push(`Relevant concepts:\n- ${input.conceptSummaries.slice(0, 8).join('\n- ')}`)
  }
  if (input.recentDoneSpecs && input.recentDoneSpecs.length > 0) {
    parts.push(`Recently shipped specs (context for what's already done):\n- ${input.recentDoneSpecs.slice(0, 8).join('\n- ')}`)
  }

  // Phase 1.10al: read the canonical product vision (`.agent/idea.md`) and
  // inject it ahead of master-plan/repo context. Every wizard question should
  // reflect the vision (audience, non-goals, voice). Defensive: if the file is
  // missing or GitHub fails, the wizard runs without it.
  try {
    const ideaContent = await loadIdeaFileContent()
    if (ideaContent) {
      parts.push(`Product vision (canonical, Muzammil-edited — read FIRST, every question must align):\n${ideaContent.slice(0, 6000)}`)
    }
  } catch (err) {
    console.warn('[wizard-engine] idea file load failed:', err instanceof Error ? err.message : err)
  }

  // Phase 1.10ak: ground the wizard in real repo state when GITHUB_PAT is set.
  // Wrap in try/catch so a GitHub blip never blocks question generation.
  let repoContext: RepoContext | null = null
  try {
    repoContext = await loadRepoContext(input.phaseHint, input.parentBody)
  } catch (err) {
    console.warn('[wizard-engine] repo context load failed:', err instanceof Error ? err.message : err)
  }
  if (repoContext) {
    parts.push(formatRepoContextForPrompt(repoContext, input.phaseHint))
  }

  const userPrompt = `${parts.join('\n\n')}

Propose 3-7 multi-choice questions that, when answered, resolve this vague phase into a concrete spec ready for Builder.

Respond ONLY with JSON in this exact shape:
{
  "questions": [
    {
      "id": "<short-snake-case-id>",
      "prompt": "<question text>",
      "choices": ["<option 1>", "<option 2>", "..."],
      "allowFreeText": <true|false>,
      "rationale": "<one-line hint, optional>"
    }
  ]
}

Rules:
- Each question must have 2-5 choices.
- Last question should always be "Looks good — generate spec?" with choices ["yes","no — let me edit"], allowFreeText:false.
- Keep questions short and decisive — they're shown as button rows.
- Cover scope, user role, integration surfaces, and data shape.
- No prose outside the JSON.`

  const systemPrompt =
    'You are Atlas, generating multi-choice questions for the CropsIntel V3 cockpit wizard. Keep output strictly JSON. Never invent UI behavior; let the human curate.'

  try {
    const t0 = Date.now()
    const result = await askClaude({
      prompt: userPrompt,
      model: 'claude-sonnet-4-6',
      systemPrompt,
    })
    await recordCost('anthropic', 'atlas', 'claude-sonnet-4-6', result.inputTokens, result.outputTokens, result.costUsd)
    const parsed = extractJson(result.content)
    if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      console.warn('[wizard-engine] Claude returned unparseable questions; using fallback', {
        ms: Date.now() - t0,
      })
      return { questions: DEFAULT_QUESTIONS, costUsd: result.costUsd, source: 'fallback' }
    }
    const sanitized = sanitizeQuestions(parsed.questions as Array<Record<string, unknown>>)
    if (sanitized.length === 0) {
      return { questions: DEFAULT_QUESTIONS, costUsd: result.costUsd, source: 'fallback' }
    }
    return { questions: sanitized, costUsd: result.costUsd, source: 'claude' }
  } catch (err) {
    console.warn('[wizard-engine] proposeWizardQuestions failed:', err instanceof Error ? err.message : err)
    return { questions: DEFAULT_QUESTIONS, costUsd: 0, source: 'fallback' }
  }
}

function extractJson(text: string): { questions?: unknown } | null {
  if (!text) return null
  // Strip code fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as { questions?: unknown }
  } catch {
    return null
  }
}

function sanitizeQuestions(raw: Array<Record<string, unknown>>): WizardQuestion[] {
  const out: WizardQuestion[] = []
  for (const q of raw.slice(0, 7)) {
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${out.length + 1}`
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : ''
    if (!prompt) continue
    const rawChoices = Array.isArray(q.choices) ? (q.choices as unknown[]) : []
    const choices = rawChoices
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .slice(0, 5)
    if (choices.length < 2) continue
    out.push({
      id,
      prompt,
      choices,
      allowFreeText: q.allowFreeText === false ? false : true,
      rationale: typeof q.rationale === 'string' ? q.rationale : undefined,
    })
  }
  return out
}

/**
 * Pull the cached repo index and a small set of relevant file contents to feed
 * into the question-generation prompt. Returns null if no PAT/cache is
 * available, in which case the wizard runs without repo context.
 */
export async function loadRepoContext(
  phaseHint: string,
  parentBody: string,
): Promise<RepoContext | null> {
  const index = await getRepoIndex()
  if (!index) return null
  const relevantFiles = await findRelevantFiles(phaseHint, parentBody, index)
  // Sample up to 5 file bodies; cap total prompt text by truncating each below.
  const sampled = relevantFiles.slice(0, 5)
  const fetched = await Promise.all(
    sampled.map(async (path) => {
      const content = await getFileContent(path)
      return { path, content: content ?? '' }
    }),
  )
  return {
    index,
    relevantFiles,
    relevantContents: fetched.filter((f) => f.content.length > 0),
  }
}

export function extractKeywords(phaseHint: string, parentBody: string): string[] {
  const haystack = `${phaseHint} ${parentBody}`.toLowerCase()
  const candidates = new Set<string>()
  // Phase ID itself (e.g. "1.3" or "phase-1-3") is a strong signal.
  if (phaseHint) candidates.add(phaseHint.toLowerCase())
  // Common domain words we expect to see in CropsIntel V3 specs.
  const domainWords = [
    'auth', 'login', 'signup', 'otp', 'rbac', 'role', 'profile',
    'whatsapp', 'twilio', 'voice', 'tts', 'stt', 'whisper', 'elevenlabs',
    'supabase', 'migration', 'rls', 'edge', 'function',
    'broker', 'supplier', 'customer', 'offer', 'enquiry', 'quote',
    'company', 'contact', 'commodity', 'product', 'relationship',
    'zyra', 'atlas', 'adela', 'cockpit', 'plan', 'wizard',
    'dashboard', 'admin', 'team', 'invite', 'session',
    'cron', 'webhook', 'health', 'heartbeat', 'cost', 'budget',
  ]
  for (const w of domainWords) {
    if (haystack.includes(w)) candidates.add(w)
  }
  // Pull standalone alphanumeric tokens 4+ chars long from the title text only,
  // not the whole body — keeps the keyword set focused.
  for (const tok of phaseHint.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 4) candidates.add(tok)
  }
  return Array.from(candidates)
}

async function findRelevantFiles(
  phaseHint: string,
  parentBody: string,
  index: RepoIndex,
): Promise<string[]> {
  // Use the directory histogram to pre-screen — but we still need actual paths
  // to filter, so call getFileTree once. Cached at the API layer if needed.
  const tree = await getFileTree()
  const keywords = extractKeywords(phaseHint, parentBody)
  if (keywords.length === 0) return []
  return tree
    .filter((t) => t.type === 'file')
    .filter((t) => {
      const lc = t.path.toLowerCase()
      return keywords.some((k) => lc.includes(k))
    })
    .map((t) => t.path)
    .sort((a, b) => a.length - b.length)
    .slice(0, 30)
    // Reference index so the parameter isn't unused; future-proofs us when we
    // start scoring relevance against the directory histogram.
    .filter(() => index.total_files > 0)
}

function formatRepoContextForPrompt(ctx: RepoContext, phaseHint: string): string {
  const ix = ctx.index
  const lines: string[] = []
  lines.push('Repo facts (from real codebase, not assumptions):')
  lines.push(`- Framework: ${ix.package_json_summary.framework}`)
  lines.push(`- Has shadcn/ui: ${ix.conventions.has_shadcn}`)
  lines.push(`- Has Tailwind: ${ix.conventions.has_tailwind}`)
  lines.push(`- Auth libraries: ${ix.conventions.auth_libs.join(', ') || 'none yet'}`)
  lines.push(`- Test framework: ${ix.conventions.test_framework}`)
  const matchingCommits = ix.recent_commits.filter((c) => c.message.toLowerCase().includes(phaseHint.toLowerCase())).slice(0, 5)
  lines.push(`- Recent commits matching "${phaseHint}": ${matchingCommits.map((c) => c.message).join(', ') || 'none'}`)
  if (ctx.relevantFiles.length > 0) {
    lines.push('')
    lines.push('Relevant existing files in this area:')
    for (const p of ctx.relevantFiles.slice(0, 10)) lines.push(`- ${p}`)
  }
  if (ctx.relevantContents.length > 0) {
    lines.push('')
    lines.push('Sample contents (first 1500 chars each):')
    for (const f of ctx.relevantContents) {
      lines.push(`--- ${f.path} ---\n${f.content.slice(0, 1500)}`)
    }
  }
  lines.push('')
  lines.push('Now propose 3-7 multi-choice questions that ground this phase in REAL repo state. Don\'t ask things the repo already answers. If auth files exist, ask about extending vs replacing them. If shadcn/ui is present, ask about which components to use, not whether to use it.')
  return lines.join('\n')
}

/**
 * Phase 1.10al — load `.agent/idea.md` (canonical product vision). Tries the
 * GitHub reader first so the cockpit-server and Builder agree on a single
 * source. Falls back to the local clone when GITHUB_PAT is unset (dev mode).
 * Returns null if the file is missing in both places — the wizard should still
 * run, it just won't anchor questions in the vision document.
 */
export async function loadIdeaFileContent(): Promise<string | null> {
  const remote = await getFileContent('.agent/idea.md')
  if (remote && remote.trim().length > 0) return remote
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const repoRoot = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
    const localPath = path.resolve(repoRoot, '.agent/idea.md')
    const local = await fs.readFile(localPath, 'utf-8')
    return local.trim().length > 0 ? local : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1.10am — Deep multi-turn wizard.
//
// The single-pass `proposeWizardQuestions` above stays for backwards-compat,
// but the cockpit now drives a multi-turn loop: Atlas asks one question, the
// human answers, the answer is fed back into the next prompt, and the loop
// terminates when Atlas signals 100% clarity (or hits the 12-turn cap).
// Persistence lives in `wizard_sessions` (Supabase) so users can close the
// modal mid-interview and resume later.
// ─────────────────────────────────────────────────────────────────────────────
export interface WizardTurn {
  question: string
  options: string[]
  allow_freeform: boolean
  rationale: string
}

export interface WizardHistoryEntry {
  question: string
  answer: string
}

export interface WizardState {
  phase_id: string
  parent_title: string
  parent_body: string
  phase_hint: string
  mode: 'add' | 'modify'
  existing_spec?: string
  concept_summaries?: string[]
  history: WizardHistoryEntry[]
  total_turns: number
  is_complete: boolean
  clarity_score: number
  current_turn?: WizardTurn
  spec_draft?: string
  summary_of_decisions?: string
}

export type DeepTurnQuestion = {
  kind: 'question'
  rationale: string
  question: string
  options: string[]
  allow_freeform: boolean
  current_clarity: number
}

export type DeepTurnComplete = {
  kind: 'complete'
  current_clarity: number
  summary_of_decisions: string
  spec_draft: string
}

export type DeepTurnResult = DeepTurnQuestion | DeepTurnComplete

export const MAX_WIZARD_TURNS = 12
export const CLARITY_DONE_THRESHOLD = 90

/**
 * Build the prompt the deep wizard sends to Claude on each turn. Pulls the
 * idea file + repo facts the same way `proposeWizardQuestions` does, but
 * frames the task as an interview rather than a single-shot question batch.
 */
export async function buildDeepTurnPrompt(state: WizardState): Promise<string> {
  const parts: string[] = []
  parts.push(`Phase id: ${state.phase_id}`)
  parts.push(`Parent phase: ${state.parent_title}`)
  if (state.phase_hint) parts.push(`Phase hint: ${state.phase_hint}`)
  if (state.parent_body) parts.push(`Parent body excerpt:\n${state.parent_body.slice(0, 1200)}`)
  if (state.mode === 'modify' && state.existing_spec) {
    parts.push(`Current spec body:\n${state.existing_spec.slice(0, 2000)}`)
  }
  if (state.concept_summaries && state.concept_summaries.length > 0) {
    parts.push(`Relevant concepts:\n- ${state.concept_summaries.slice(0, 8).join('\n- ')}`)
  }

  try {
    const ideaContent = await loadIdeaFileContent()
    if (ideaContent) {
      parts.push(`Product vision (canonical, Muzammil-edited — read FIRST, every question must align):\n${ideaContent.slice(0, 6000)}`)
    }
  } catch (err) {
    console.warn('[wizard-engine] idea file load failed in deep turn:', err instanceof Error ? err.message : err)
  }

  let repoContext: RepoContext | null = null
  try {
    repoContext = await loadRepoContext(state.phase_hint, state.parent_body)
  } catch (err) {
    console.warn('[wizard-engine] repo context load failed in deep turn:', err instanceof Error ? err.message : err)
  }
  if (repoContext) {
    parts.push(formatRepoContextForPrompt(repoContext, state.phase_hint))
  }

  const historyBlock = state.history.length > 0
    ? state.history.map((h, i) => `Turn ${i + 1}:\nQ: ${h.question}\nA: ${h.answer}`).join('\n\n')
    : '(no prior turns — this is the opening question)'
  parts.push(`Conversation so far:\n${historyBlock}`)

  parts.push(`This is turn ${state.total_turns + 1} of at most ${MAX_WIZARD_TURNS}.`)

  parts.push(`Your job: decide whether you have 100% clarity to write a complete Builder spec for this phase, OR if you need exactly one more question to fill a remaining gap.

Output ONLY JSON in ONE of two shapes.

If you need more info:
{
  "kind": "question",
  "rationale": "<one short sentence on why this answer is needed>",
  "question": "<question text>",
  "options": ["<option 1>", "<option 2>", ...],
  "allow_freeform": true,
  "current_clarity": <0-100, your honest estimate of clarity if you wrote the spec WITHOUT this answer>
}

If you have enough to write a complete spec:
{
  "kind": "complete",
  "current_clarity": 100,
  "summary_of_decisions": "<2-3 sentences recapping decisions across turns>",
  "spec_draft": "<full Builder-ready spec markdown — must include headings: ## Goal, ## Files (or ## Architecture), ## Success criteria, ## Risks + mitigations, ## NEVER list, plus '**Master plan reference:**', '**Estimated effort:**', '**Model:**' lines, plus a frontmatter line 'model: <model-id>'>"
}

Rules:
- Stop asking questions once your honest current_clarity ≥ ${CLARITY_DONE_THRESHOLD} AND you can write the spec without ambiguity. At that point return kind:"complete".
- Don't ask anything the idea file or repo already answers.
- Each question MUST be unique — never re-ask anything in the conversation history.
- Each question MUST depend on previous answers — multi-turn means follow-ups, not parallel options. If the user said "WhatsApp + email" earlier, your next question should narrow one of those branches, not jump to an unrelated topic.
- Keep questions short and decisive — they render as button rows.
- Provide 2-5 options. Set allow_freeform:true so the user can type a custom answer.
- If this is turn ${MAX_WIZARD_TURNS} and you still don't have 100% clarity, return kind:"complete" anyway and prepend a "## Documented assumptions" section to spec_draft listing every assumption you had to make.
- No prose outside the JSON.`)

  return parts.join('\n\n')
}

/**
 * Ask Claude for the next turn (question or completion). Returns a structured
 * result; on parse failure returns a deterministic fallback question so the
 * wizard never deadlocks.
 */
export async function nextDeepTurn(state: WizardState): Promise<{ result: DeepTurnResult; costUsd: number; source: 'claude' | 'fallback' }> {
  const userPrompt = await buildDeepTurnPrompt(state)
  const systemPrompt =
    'You are Atlas, conducting a deep planning interview for the CropsIntel V3 cockpit. Output strict JSON. Each question must DEPEND on previous answers — do not parallelise unrelated topics. Stop asking when the spec can be written unambiguously.'

  try {
    const result = await askClaude({
      prompt: userPrompt,
      model: 'claude-sonnet-4-6',
      systemPrompt,
    })
    await recordCost('anthropic', 'atlas', 'claude-sonnet-4-6', result.inputTokens, result.outputTokens, result.costUsd)
    const parsed = extractDeepTurnJson(result.content)
    if (parsed) {
      return { result: parsed, costUsd: result.costUsd, source: 'claude' }
    }
    console.warn('[wizard-engine] deep turn returned unparseable JSON; using fallback')
    return { result: fallbackQuestion(state), costUsd: result.costUsd, source: 'fallback' }
  } catch (err) {
    console.warn('[wizard-engine] nextDeepTurn failed:', err instanceof Error ? err.message : err)
    return { result: fallbackQuestion(state), costUsd: 0, source: 'fallback' }
  }
}

function extractDeepTurnJson(text: string): DeepTurnResult | null {
  if (!text) return null
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const kind = obj.kind
  if (kind === 'question') {
    const question = typeof obj.question === 'string' ? obj.question.trim() : ''
    if (!question) return null
    const options = Array.isArray(obj.options)
      ? (obj.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 5)
      : []
    if (options.length < 2) return null
    const clarity = Math.min(100, Math.max(0, Number(obj.current_clarity ?? 0)))
    return {
      kind: 'question',
      rationale: typeof obj.rationale === 'string' ? obj.rationale.trim() : '',
      question,
      options,
      allow_freeform: obj.allow_freeform === false ? false : true,
      current_clarity: Number.isFinite(clarity) ? clarity : 0,
    }
  }
  if (kind === 'complete') {
    const spec = typeof obj.spec_draft === 'string' ? obj.spec_draft : ''
    if (!spec || spec.trim().length === 0) return null
    return {
      kind: 'complete',
      current_clarity: 100,
      summary_of_decisions: typeof obj.summary_of_decisions === 'string' ? obj.summary_of_decisions : '',
      spec_draft: spec,
    }
  }
  return null
}

/**
 * Deterministic question used when Claude is unreachable / unparseable. Picks
 * the first slot in DEFAULT_QUESTIONS the human hasn't already answered so the
 * fallback doesn't infinite-loop on the same prompt.
 */
function fallbackQuestion(state: WizardState): DeepTurnQuestion {
  const asked = new Set(state.history.map(h => h.question))
  const remaining = DEFAULT_QUESTIONS.find(q => !asked.has(q.prompt)) ?? DEFAULT_QUESTIONS[0]
  return {
    kind: 'question',
    rationale: 'fallback question — Claude unavailable, keeping the wizard moving with a generic prompt',
    question: remaining.prompt,
    options: remaining.choices,
    allow_freeform: remaining.allowFreeText,
    current_clarity: Math.min(80, state.history.length * 15),
  }
}

/**
 * Apply a parsed turn result to the wizard state. Increments `total_turns`,
 * appends to history when the user answered, and flips `is_complete` when
 * Claude signals completion.
 */
export function applyDeepTurnResult(state: WizardState, result: DeepTurnResult): WizardState {
  const next: WizardState = { ...state, history: [...state.history] }
  if (result.kind === 'question') {
    next.current_turn = {
      question: result.question,
      options: result.options,
      allow_freeform: result.allow_freeform,
      rationale: result.rationale,
    }
    next.clarity_score = result.current_clarity
    next.is_complete = false
    next.spec_draft = undefined
    next.summary_of_decisions = undefined
  } else {
    next.current_turn = undefined
    next.clarity_score = 100
    next.is_complete = true
    next.spec_draft = result.spec_draft
    next.summary_of_decisions = result.summary_of_decisions
  }
  return next
}

/**
 * Record the user's answer to the current turn. Bumps `total_turns` so the
 * 12-turn cap is enforced.
 */
export function recordWizardAnswer(state: WizardState, answer: string): WizardState {
  if (!state.current_turn) return state
  return {
    ...state,
    history: [...state.history, { question: state.current_turn.question, answer }],
    total_turns: state.total_turns + 1,
    current_turn: undefined,
  }
}

export const __test_only__ = {
  extractJson,
  sanitizeQuestions,
  DEFAULT_QUESTIONS,
  extractKeywords,
  formatRepoContextForPrompt,
  loadIdeaFileContent,
  extractDeepTurnJson,
  fallbackQuestion,
}
