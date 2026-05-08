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

export interface WizardQuestion {
  id: string
  prompt: string
  choices: string[]              // 2-5 short option labels
  allowFreeText: boolean         // true → user can type instead of picking
  rationale?: string             // optional hint shown next to the question
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

export const __test_only__ = { extractJson, sanitizeQuestions, DEFAULT_QUESTIONS }
