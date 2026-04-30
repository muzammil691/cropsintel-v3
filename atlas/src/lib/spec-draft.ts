// Spec draft pipeline: Council writes a first draft, multi-brain debate critiques it,
// Claude applies fixes, validator enforces structural rigor. Returns final markdown
// + filename + cost breakdown. Used by atlas.draft_spec and atlas.propose_and_queue.

import { simple, debate } from './multi-brain'
import { validate, SPEC_TEMPLATE_SCAFFOLD, type ValidationResult } from './spec-template'

const COUNCIL_URL = process.env.COUNCIL_URL ?? 'https://just-reflection-production.up.railway.app'
const COUNCIL_TOKEN = process.env.COUNCIL_API_TOKEN
const COUNCIL_TIMEOUT_MS = 60_000

export interface DraftStep {
  name: string
  durationMs: number
  costUsd: number
  ok: boolean
  note?: string
}

export interface DraftResult {
  filename: string
  markdown: string
  validation: ValidationResult
  costUsd: number
  steps: DraftStep[]
  reviewVerdict: 'agreement' | 'majority' | 'escalate-to-user' | 'skipped'
  reviewRationale?: string
  council: {
    used: boolean
    error?: string
  }
}

interface CouncilResponse {
  spec_markdown?: string
  markdown?: string
  cost_usd?: number
  filename?: string
  spec?: { markdown?: string; filename?: string }
}

async function callCouncilWriteSpec(phase: string, context?: string): Promise<CouncilResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), COUNCIL_TIMEOUT_MS)
  try {
    const res = await fetch(`${COUNCIL_URL}/write-spec`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${COUNCIL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phase, context }),
    })
    if (!res.ok) {
      throw new Error(`council /write-spec returned ${res.status}`)
    }
    return await res.json() as CouncilResponse
  } finally {
    clearTimeout(timeout)
  }
}

export async function draftSpec(phase: string, goal: string): Promise<DraftResult> {
  const steps: DraftStep[] = []
  let totalCost = 0
  let markdown = ''
  const council = { used: false, error: undefined as string | undefined }

  // ─── Step 1: Council writes first draft ──────────────────────────────────────
  const councilStart = Date.now()
  try {
    const c = await callCouncilWriteSpec(phase, goal)
    const draft = c.spec_markdown ?? c.markdown ?? c.spec?.markdown ?? ''
    if (draft && draft.length > 200) {
      markdown = draft
      council.used = true
      const cCost = c.cost_usd ?? 0
      totalCost += cCost
      steps.push({ name: 'council.write_spec', durationMs: Date.now() - councilStart, costUsd: cCost, ok: true })
    } else {
      throw new Error('council returned empty/short draft')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    council.error = msg
    steps.push({ name: 'council.write_spec', durationMs: Date.now() - councilStart, costUsd: 0, ok: false, note: msg })
  }

  // ─── Step 1b: Fallback — if Council failed, draft directly via Claude simple()
  if (!council.used) {
    const fbStart = Date.now()
    const fbPrompt = [
      `Draft a CropsIntel V3 task spec for Phase ${phase}.`,
      ``,
      `Goal (from user): ${goal}`,
      ``,
      `The spec must follow this exact scaffold (replace placeholders, do not omit any section):`,
      ``,
      SPEC_TEMPLATE_SCAFFOLD,
      ``,
      `Return ONLY the markdown spec — no preamble, no explanation.`,
    ].join('\n')
    const fb = await simple(fbPrompt)
    markdown = fb.content
    totalCost += fb.costUsd
    steps.push({
      name: 'fallback.simple_draft',
      durationMs: Date.now() - fbStart,
      costUsd: fb.costUsd,
      ok: !!markdown && markdown.length > 200,
      note: 'used because Council unavailable',
    })
  }

  // ─── Step 2: Multi-brain debate review ───────────────────────────────────────
  const reviewStart = Date.now()
  const reviewPrompt = [
    `You are reviewing a CropsIntel V3 task spec draft for foundation-first correctness, structural rigor, and scope safety. Critique strictly.`,
    ``,
    `Checklist:`,
    `1. Are all required sections present? (Master plan reference, Estimated effort, Model, model: frontmatter, Goal, Files or Architecture, Success criteria, Risks + mitigations, NEVER list)`,
    `2. Is the foundation-first dependency graph respected? (e.g. no offers before companies+contacts+canonical_products+relationships)`,
    `3. Any ambiguity Builder could misinterpret?`,
    `4. Does it violate master plan §11.6 NEVER list? (Sale Contracts to BC, Purchase Contracts to BC, multi-tenant SaaS, LC posting workflows, etc.)`,
    `5. Does it leak AI keys to client (VITE_*_API_KEY)?`,
    `6. Are risks + mitigations concrete?`,
    ``,
    `DRAFT:`,
    `\`\`\`markdown`,
    markdown,
    `\`\`\``,
    ``,
    `Return your full critique. End with VERDICT: PASS or VERDICT: FAIL.`,
  ].join('\n')

  let reviewVerdict: DraftResult['reviewVerdict'] = 'skipped'
  let reviewRationale: string | undefined
  let reviewCritiques = ''
  try {
    const review = await debate(reviewPrompt, { quorum: 2 })
    const reviewCost = review.votes.reduce((s, v) => s + v.costUsd, 0)
    totalCost += reviewCost
    reviewVerdict = review.verdict
    reviewRationale = review.rationale
    reviewCritiques = review.votes
      .map(v => `--- ${v.provider} (${v.model}) ---\n${v.content.slice(0, 1500)}`)
      .join('\n\n')
    steps.push({
      name: 'multi-brain.debate',
      durationMs: Date.now() - reviewStart,
      costUsd: reviewCost,
      ok: review.verdict !== 'escalate-to-user',
      note: `verdict=${review.verdict} rationale=${review.rationale ?? 'n/a'}`,
    })
  } catch (err) {
    steps.push({
      name: 'multi-brain.debate',
      durationMs: Date.now() - reviewStart,
      costUsd: 0,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    })
  }

  // ─── Step 3: Apply review fixes + retry up to 2x on validation failures ─────
  let validation = validate(markdown)
  let attempt = 0
  while ((!validation.ok || reviewVerdict === 'escalate-to-user') && attempt < 2) {
    attempt++
    const fixStart = Date.now()
    const fixPrompt = [
      `The following CropsIntel V3 task spec needs corrections.`,
      `Missing required sections: ${validation.missing.length ? validation.missing.join(', ') : '(none)'}`,
      reviewCritiques ? `\nReviewer critiques:\n${reviewCritiques}` : '',
      ``,
      `CURRENT DRAFT:`,
      `\`\`\`markdown`,
      markdown,
      `\`\`\``,
      ``,
      `Produce a corrected full markdown spec that includes ALL missing sections and addresses the critiques. Keep all good content; add or refine only what's needed. The result MUST contain (case-insensitive):`,
      `- "# Task: Phase <X.Y> — <name>" heading`,
      `- "**Master plan reference:**" line`,
      `- "**Estimated effort:**" line`,
      `- "**Model:**" line`,
      `- "model:" frontmatter line`,
      `- "## Goal" section`,
      `- "## Files" or "## Architecture" section`,
      `- "## Success criteria" section`,
      `- "## Risks + mitigations" section`,
      `- "## NEVER list" section`,
      ``,
      `Return ONLY the corrected markdown — no preamble.`,
    ].join('\n')

    const fix = await simple(fixPrompt)
    if (fix.content && fix.content.length > 200) {
      markdown = fix.content
    }
    totalCost += fix.costUsd
    validation = validate(markdown)
    steps.push({
      name: `fix-pass-${attempt}`,
      durationMs: Date.now() - fixStart,
      costUsd: fix.costUsd,
      ok: validation.ok,
      note: validation.ok ? 'all required sections present' : `still missing: ${validation.missing.join(', ')}`,
    })
  }

  // ─── Step 4: Derive filename ─────────────────────────────────────────────────
  const filename = deriveFilename(markdown, phase)

  return {
    filename,
    markdown,
    validation,
    costUsd: totalCost,
    steps,
    reviewVerdict,
    reviewRationale,
    council,
  }
}

function deriveFilename(markdown: string, fallbackPhase: string): string {
  const headingMatch = markdown.match(/^#\s+Task:\s+Phase\s+(\S+)\s+[—\-]\s+(.+?)$/im)
  let phase = fallbackPhase.replace(/[^a-z0-9.]+/gi, '').toLowerCase() || 'unknown'
  let name = 'unnamed'
  if (headingMatch) {
    phase = headingMatch[1].trim().toLowerCase()
    name = headingMatch[2].trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'unnamed'
  }
  return `phase-${phase}-${name}.md`
}
