// Spec draft pipeline: Council writes a first draft, multi-brain debate critiques it,
// Claude applies fixes, validator enforces structural rigor. Returns final markdown
// + filename + cost breakdown. Used by atlas.draft_spec and atlas.propose_and_queue.

import { simple, debate } from './multi-brain'
import { memorySearch } from './tools'
import { validate, SPEC_TEMPLATE_SCAFFOLD, type ValidationResult } from './spec-template'
import { injectMissingSections } from './section-injector'
import {
  classifyPrimaryDomain,
  recordBuildAttempt,
  type PrimaryDomain,
} from './build-attempts'
import { preflightCheck, renderPreflightSection } from './preflight-verifier'
import { setFrontmatterField } from './frontmatter'

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
  /**
   * Phase 2: pre-build memory record. Set when the planned row was inserted
   * into atlas_build_attempts. builderQueueSpec uses this to flip the row
   * to status='queued' once the spec lands on disk.
   */
  buildAttemptId?: string
  primaryDomain?: PrimaryDomain
}

interface CouncilResponse {
  spec_markdown?: string
  markdown?: string
  cost_usd?: number
  filename?: string
  spec?: { markdown?: string; filename?: string }
}

interface MemorySearchHit {
  content: string
  source: string
  sourcePath: string | null
  similarity: number
  metadata?: Record<string, unknown>
}

interface MemorySearchResponse {
  chunks: MemorySearchHit[]
}

const PRIOR_INCIDENT_CHAR_BUDGET = 2000
const ADR_CHAR_BUDGET = 1500

// Pull relevant Memory chunks from a single source, capped to the char budget.
// Returns '' if Memory is unreachable, returns no hits, or every hit is empty.
async function fetchMemoryDigest(
  query: string,
  source: 'agent-history' | 'adrs',
  charBudget: number,
  limit: number,
): Promise<string> {
  let raw: unknown
  try {
    raw = await memorySearch(query, { limit, sources: [source] })
  } catch (err) {
    console.warn(
      `[spec-draft] memory.search(${source}) failed — proceeding without ${source} context:`,
      err instanceof Error ? err.message : err,
    )
    return ''
  }
  const hits = (raw as MemorySearchResponse | undefined)?.chunks
  if (!Array.isArray(hits) || hits.length === 0) return ''

  const out: string[] = []
  let used = 0
  for (const h of hits) {
    if (typeof h.content !== 'string' || h.content.trim().length === 0) continue
    const block = `- ${h.content.trim()}`
    if (used + block.length > charBudget) break
    out.push(block)
    used += block.length
  }
  return out.join('\n\n')
}

// Audit C1b: pull recent verifier/designer failures relevant to this phase from
// the agent-history Memory source so Council writes a spec that explicitly avoids
// them. Non-blocking: if Memory is unreachable or has no hits, return '' and let
// the draft proceed exactly as before.
async function fetchPriorIncidents(phase: string, goal: string): Promise<string> {
  const goalSnippet = goal.replace(/\s+/g, ' ').slice(0, 240)
  const query = `phase ${phase} prior failures and remediation gaps. ${goalSnippet}`
  return fetchMemoryDigest(query, 'agent-history', PRIOR_INCIDENT_CHAR_BUDGET, 10)
}

// Closes the Council ADR readback loop: Council records ADRs to
// architecture_decisions during draft, but those decisions never fed back
// into the next draft. Now we surface relevant past decisions so a new spec
// either honors them or explicitly proposes superseding them.
async function fetchRelevantADRs(phase: string, goal: string): Promise<string> {
  const goalSnippet = goal.replace(/\s+/g, ' ').slice(0, 240)
  const query = `phase ${phase} architectural decisions and trade-offs. ${goalSnippet}`
  return fetchMemoryDigest(query, 'adrs', ADR_CHAR_BUDGET, 5)
}

// Sentinel marker on the thrown Error so callers can distinguish "Council
// endpoint is missing/disabled" (404) from generic 5xx / network errors. The
// caller routes 404 through the deterministic fallback + section-injector
// without crashing, since 404 has been a recurring cause of queue failures.
export const COUNCIL_404_MARKER = '[council-404]'

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
    if (res.status === 404) {
      console.warn(
        `[spec-draft] council /write-spec returned 404 — endpoint unavailable. Falling back to deterministic draft + section-injector. URL=${COUNCIL_URL}/write-spec`,
      )
      throw new Error(`${COUNCIL_404_MARKER} council /write-spec returned 404 (endpoint unavailable)`)
    }
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

  // ─── Step 0: Memory readback — prior incidents + relevant ADRs ──────────────
  // Closes the audit C1 + ADR-readback loops:
  //   * agent-history: failed verifier/designer runs → "don't repeat these gaps"
  //   * adrs:          past architectural decisions  → "honor or explicitly supersede"
  // Run in parallel; both are non-blocking (Memory unreachable → empty).
  const [priorIncidents, relevantAdrs] = await Promise.all([
    fetchPriorIncidents(phase, goal),
    fetchRelevantADRs(phase, goal),
  ])
  const sections: string[] = [goal]
  if (priorIncidents) {
    sections.push(
      '',
      '## Prior incidents on this scope',
      priorIncidents,
      '',
      'Apply the lessons learned. Do NOT reintroduce the gaps listed above; address them explicitly in Success criteria or Risks + mitigations.',
    )
  }
  if (relevantAdrs) {
    sections.push(
      '',
      '## Relevant prior architectural decisions',
      relevantAdrs,
      '',
      'These decisions were ratified by Council. Honor them in the new spec, OR — if you propose superseding one — name the ADR explicitly and justify the change in Risks + mitigations.',
    )
  }
  const augmentedGoal = sections.join('\n')

  // ─── Step 1: Council writes first draft ──────────────────────────────────────
  const councilStart = Date.now()
  try {
    const c = await callCouncilWriteSpec(phase, augmentedGoal)
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
      `Goal (from user): ${augmentedGoal}`,
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

    // Run the deterministic section-injector immediately after the fallback
    // draft. Council normally guarantees the four mandatory sections (Task
    // heading, Success criteria, Risks + mitigations, NEVER list); the Claude
    // fallback frequently drops at least one. The injector is a no-op when
    // sections are already present, so it cannot duplicate anything Council
    // produced — but Council didn't run on this branch, so we always need it.
    const injectStart = Date.now()
    const injection = injectMissingSections(markdown, phase)
    if (injection.injected.length > 0) {
      markdown = injection.markdown
      steps.push({
        name: 'fallback.section_injector',
        durationMs: Date.now() - injectStart,
        costUsd: 0,
        ok: true,
        note: `injected: ${injection.injected.join(', ')}`,
      })
    } else {
      steps.push({
        name: 'fallback.section_injector',
        durationMs: Date.now() - injectStart,
        costUsd: 0,
        ok: true,
        note: 'no missing sections — fallback draft was complete',
      })
    }
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

  // ─── Step 3b: Final safety net — deterministic section injector ─────────────
  // The fix passes occasionally fail to add a missing section even when asked.
  // Before letting the spec fall over the validation gate, run the injector one
  // more time. It's a no-op when the spec is already complete (because every
  // rule short-circuits on `present: true`), so this is safe on the happy path
  // too. Only triggers when validation is still red after fix passes.
  if (!validation.ok) {
    const safetyStart = Date.now()
    const injection = injectMissingSections(markdown, phase)
    if (injection.injected.length > 0) {
      markdown = injection.markdown
      validation = validate(markdown)
      steps.push({
        name: 'safety-net.section_injector',
        durationMs: Date.now() - safetyStart,
        costUsd: 0,
        ok: validation.ok,
        note: `injected: ${injection.injected.join(', ')}; validation_ok=${validation.ok}`,
      })
    }
  }

  // ─── Step 4: Derive filename ─────────────────────────────────────────────────
  const filename = deriveFilename(markdown, phase)
  const taskId = filename.replace(/\.md$/, '')

  // ─── Step 4b: Pre-build verifier preflight (Phase 3) ────────────────────────
  // Look up prior fails on this task + identical-spec recent fails. Append a
  // "## Prior-attempt warnings" section to the spec when there's history, so
  // Builder reads explicit don't-repeat-this guidance. Best-effort.
  let preflightWarningsForRecord: unknown[] = []
  try {
    const preflight = await preflightCheck(taskId, markdown)
    if (preflight.warnings.length > 0) {
      const section = renderPreflightSection(preflight)
      if (section) markdown = `${markdown.replace(/\s+$/, '')}\n${section}\n`
      preflightWarningsForRecord = preflight.warnings.map((w) => ({
        kind: w.kind,
        message: w.message,
      }))
    }
    steps.push({
      name: 'preflight.verifier_check',
      durationMs: 0,
      costUsd: 0,
      ok: true,
      note: `prior_attempts=${preflight.priorAttempts} identical_recent_fails=${preflight.identicalRecentFailures} recommendation=${preflight.recommendation}`,
    })
  } catch (err) {
    steps.push({
      name: 'preflight.verifier_check',
      durationMs: 0,
      costUsd: 0,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    })
  }

  // ─── Step 4c: primary-domain frontmatter tag (Phase 4) ─────────────────────
  // Classify and inject into the YAML frontmatter so Builder + future per-domain
  // routing can read it without re-parsing the body. Routing itself is Phase 4b
  // (deferred); today Builder logs the value but still uses Claude Code.
  const primaryDomain = classifyPrimaryDomain(markdown)
  try {
    markdown = setFrontmatterField(markdown, 'primaryDomain', primaryDomain)
    steps.push({
      name: 'frontmatter.primary_domain',
      durationMs: 0,
      costUsd: 0,
      ok: true,
      note: `tagged primary-domain=${primaryDomain}`,
    })
  } catch (err) {
    steps.push({
      name: 'frontmatter.primary_domain',
      durationMs: 0,
      costUsd: 0,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    })
  }

  // ─── Step 5: Pre-build memory record (Phase 2 of agent-loop redesign) ──────
  // Insert a 'planned' row into atlas_build_attempts so the build is bookended
  // in memory before Builder picks it up. Best-effort: any failure here does
  // not block queueing — the spec still ships, we just lose the trace.
  let buildAttemptId: string | undefined
  try {
    const recorded = await recordBuildAttempt({
      taskId,
      specFilename: filename,
      specMarkdown: markdown,
      primaryDomain,
      costUsd: totalCost,
      priorWarnings: preflightWarningsForRecord,
    })
    if (recorded) {
      buildAttemptId = recorded.id
      steps.push({
        name: 'build-attempt.planned',
        durationMs: 0,
        costUsd: 0,
        ok: true,
        note: `attempt_number=${recorded.attemptNumber} domain=${primaryDomain} sha=${recorded.specSha.slice(0, 12)}`,
      })
    }
  } catch (err) {
    steps.push({
      name: 'build-attempt.planned',
      durationMs: 0,
      costUsd: 0,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    })
  }

  return {
    filename,
    markdown,
    validation,
    costUsd: totalCost,
    steps,
    reviewVerdict,
    reviewRationale,
    council,
    buildAttemptId,
    primaryDomain,
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
