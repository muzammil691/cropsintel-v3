// Phase 1.10aj — convert wizard answers to a Builder-parseable spec markdown.
//
// The wizard collects {questionId → answerLabel} pairs. We assemble those
// into a spec that satisfies the spec-template validator (REQUIRED_SECTIONS).
// Claude Sonnet ghost-writes the body when an API key is present; we always
// fall back to a deterministic template so the cockpit never blocks on a
// flaky LLM.

import { askClaude } from '../providers/claude'
import { recordCost } from './cost-log'
import { validate } from './spec-template'

export interface WizardAnswer {
  questionId: string
  questionPrompt: string
  answer: string
  freeText?: string
}

export interface SpecFromWizardInput {
  parentTitle: string
  phaseId: string                  // e.g. "1.11" — used for Phase X.Y heading
  phaseHint: string                // slug for filename
  mode: 'add' | 'modify'
  answers: WizardAnswer[]
  conceptSummaries?: string[]
  existingSpec?: string            // when mode='modify'
}

export interface SpecFromWizardResult {
  filename: string
  markdown: string
  validationOk: boolean
  validationErrors: string[]
  source: 'claude' | 'fallback'
  costUsd: number
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function buildScaffold(input: SpecFromWizardInput): string {
  const phase = input.phaseId.trim() || 'X.Y'
  const title = input.parentTitle.trim() || 'wizard-generated phase'
  const answersBlock = input.answers
    .map(a => `- **${a.questionPrompt}** ${a.freeText ? `→ ${a.freeText}` : `→ ${a.answer}`}`)
    .join('\n')
  const conceptBlock = (input.conceptSummaries ?? []).length > 0
    ? input.conceptSummaries!.slice(0, 6).map(c => `- ${c}`).join('\n')
    : '- (no relevant concepts linked)'

  return `---
priority: 3
source: cockpit-wizard
phase: ${phase}
estimated_builder_minutes: 25
model: claude-opus-4-7
---

# Task: Phase ${phase} — ${title}

**Master plan reference:** §11 sequence — phase added via Plan tab cockpit wizard
**Context:** Generated from cockpit selection wizard on ${new Date().toISOString().slice(0, 10)}. Resolves vague phase placeholder into concrete spec via human-curated answers.
**Estimated effort:** ~25 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. Ship the feature described by the wizard answers below.
2. Honor the master plan's foundation-first dependency graph.
3. Preserve information walls (registered / verified / admin tiers).

## Architecture

The cockpit-driven feature touches the existing Atlas + React cockpit surface.
Wizard answers map to:

${answersBlock}

## Files

- (TBD by Builder — wizard answers narrow scope; Builder selects exact paths)

## Schema additions

\`\`\`sql
-- (none required by default — add if wizard answers imply new tables)
\`\`\`

## Linked concepts

${conceptBlock}

## Success criteria

- \`npm run build\` clean.
- All wizard-answer behaviors observable in the UI.
- Acceptance criteria from the parent phase's master plan section satisfied.

## Risks + mitigations

- **Risk:** Wizard answers under-specify the scope. **Mitigation:** Builder must write a question file under \`.agent/questions/\` and stop if a critical detail is missing — never silently improvise.
- **Risk:** Information-wall breach in customer-facing UI. **Mitigation:** RLS at DB layer + role gate at component layer.

## NEVER list

- Never put AI provider keys in \`VITE_*\` env vars.
- Never add a feature whose dependencies aren't in \`supabase/migrations/\`.
- Never break information walls.
- Never commit a broken build.
`
}

/**
 * Generate a spec markdown from the wizard answers. Tries Claude first, falls
 * back to the deterministic scaffold if Claude returns invalid markdown.
 * Always returns a payload — caller can decide whether to surface
 * validationErrors before saving.
 */
export async function specFromWizard(input: SpecFromWizardInput): Promise<SpecFromWizardResult> {
  const slug = slugFromTitle(input.parentTitle) || 'cockpit-wizard'
  const phaseSlug = slugFromTitle(input.phaseHint || input.phaseId) || 'plan'
  const filename = `phase-${phaseSlug}-${slug}.md`

  const scaffold = buildScaffold(input)

  // Try Claude — request a richer body that still parses through validate().
  const userPrompt = `Wizard answers for a CropsIntel V3 cockpit-generated spec:

Phase: ${input.phaseId}
Parent title: ${input.parentTitle}
Mode: ${input.mode}

${input.answers.map(a => `- ${a.questionPrompt} → ${a.freeText ?? a.answer}`).join('\n')}

${input.conceptSummaries && input.conceptSummaries.length ? `Linked concepts:\n${input.conceptSummaries.map(c => `- ${c}`).join('\n')}` : ''}

${input.mode === 'modify' && input.existingSpec ? `Current spec to modify:\n${input.existingSpec.slice(0, 2400)}` : ''}

Return ONLY a Builder-ready spec markdown. It MUST contain literal headers:
"# Task: Phase ${input.phaseId} — <name>", "## Goal", "## Files" (or "## Architecture"), "## Success criteria", "## Risks + mitigations", "## NEVER list", and lines "**Master plan reference:**", "**Estimated effort:**", "**Model:**", and a frontmatter line "model: <model-id>". No prose outside the markdown.`

  const systemPrompt =
    'You are Atlas writing a spec for the CropsIntel V3 Builder. Strict template adherence. No prose outside the markdown spec.'

  try {
    const result = await askClaude({
      prompt: userPrompt,
      model: 'claude-sonnet-4-6',
      systemPrompt,
    })
    await recordCost('anthropic', 'atlas', 'claude-sonnet-4-6', result.inputTokens, result.outputTokens, result.costUsd)
    const candidate = stripFences(result.content)
    const validation = validate(candidate)
    if (validation.ok) {
      return {
        filename,
        markdown: candidate,
        validationOk: true,
        validationErrors: [],
        source: 'claude',
        costUsd: result.costUsd,
      }
    }
    // Claude output failed validation — fall back to scaffold but keep cost record.
    console.warn('[spec-from-wizard] Claude output failed validation; using scaffold', {
      missing: validation.missing,
    })
    const scaffValid = validate(scaffold)
    return {
      filename,
      markdown: scaffold,
      validationOk: scaffValid.ok,
      validationErrors: scaffValid.errors,
      source: 'fallback',
      costUsd: result.costUsd,
    }
  } catch (err) {
    console.warn('[spec-from-wizard] askClaude failed; using scaffold:', err instanceof Error ? err.message : err)
    const scaffValid = validate(scaffold)
    return {
      filename,
      markdown: scaffold,
      validationOk: scaffValid.ok,
      validationErrors: scaffValid.errors,
      source: 'fallback',
      costUsd: 0,
    }
  }
}

function stripFences(text: string): string {
  if (!text) return ''
  const fenceMatch = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
  return (fenceMatch ? fenceMatch[1] : text).trim()
}

export const __test_only__ = { buildScaffold, slugFromTitle, stripFences }
