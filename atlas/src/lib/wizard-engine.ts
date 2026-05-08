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

export const __test_only__ = { extractJson, sanitizeQuestions, DEFAULT_QUESTIONS, extractKeywords, formatRepoContextForPrompt }
