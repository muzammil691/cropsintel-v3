// 1.10bb-c Railway-fix — atlas-owned copy of the plan-diff audit.
//
// Originally lived in verifier/src/checks/plan-diff-audit.ts and was loaded
// by workshop-engine.ts via a dynamic import. That cross-package dynamic
// import broke on Railway: the atlas service is deployed standalone, so
// neither `verifier/dist/` nor a `cropsintel-v3-verifier` npm package is
// resolvable there. Static TS analysis on both branches of the fallback
// failed with TS2307, and even when the static check passed locally, the
// runtime import would have thrown — falling through to the catch and
// blocking every Workshop plan-diff approval with "verifier_unreachable".
//
// Inlining the audit into atlas removes the cross-package dependency
// entirely. The verifier package keeps its own copy for its own service;
// the two are short, identical pure-function bodies and won't drift much
// in practice.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getSupabaseClient } from './supabase'

/** Per-op shape emitted by workshop-engine.finalizePlanDiff. */
export type PlanDiffOp =
  | { op: 'add'; phase_id: string; parent_id?: string | null; title?: string; body?: string; launch_tier?: string }
  | { op: 'edit'; phase_id: string; title?: string; body?: string; launch_tier?: string }
  | { op: 'remove'; phase_id: string; reason?: string }
  | { op: 'reorder'; parent_id: string; ordered_phase_ids: string[] }

export interface PlanDiffPayload {
  summary?: string
  ops: PlanDiffOp[]
  risks?: string[]
}

export interface PlanDiffAuditInput {
  /** Session row id (used to look up the most-recently generated diff). */
  sessionId: string
  /** Optional: bypass the DB lookup and audit a payload directly (tests + dry-runs). */
  diffOverride?: PlanDiffPayload
  /** Optional: bypass the baseline lookup. */
  baselineMarkdownOverride?: string
}

export interface PlanDiffAuditResult {
  /** True only when no breaking flags fired. */
  pass: boolean
  /** Human-readable flags. Empty when pass=true. */
  flags: string[]
  /** One-paragraph summary for the UI / decision log. */
  summary: string
}

/**
 * Heuristics applied (all flagged as failures):
 *   1. `remove` ops on a phase that exists in the baseline → deleted phase.
 *   2. `reorder` ops that change the relative order of phases that exist in
 *      the baseline → changed phase order.
 *   3. `edit` ops on a phase whose baseline body contains a markdown
 *      `## Milestones` block AND whose new body removes any milestone line →
 *      removed milestone.
 */
export async function auditPlanDiff(input: PlanDiffAuditInput): Promise<PlanDiffAuditResult> {
  const flags: string[] = []

  const diff = input.diffOverride ?? await loadProposedDiff(input.sessionId)
  if (!diff) {
    return {
      pass: false,
      flags: ['no_diff_found'],
      summary: `No plan diff found for session ${input.sessionId} — finalizePlanDiff must run before audit.`,
    }
  }

  const baseline = input.baselineMarkdownOverride ?? await loadBaselinePlanMarkdown()
  const baselinePhaseIds = extractPhaseIds(baseline)
  const baselineOrder = extractPhaseOrder(baseline)
  const baselineMilestones = extractMilestonesByPhase(baseline)

  for (const op of diff.ops) {
    if (op.op === 'remove') {
      if (baselinePhaseIds.has(op.phase_id)) {
        flags.push(`removed_phase:${op.phase_id}${op.reason ? ` (${op.reason})` : ''}`)
      }
    }

    if (op.op === 'reorder') {
      const newOrder = op.ordered_phase_ids
      const baselineSiblings = baselineOrder.filter((id) => newOrder.includes(id))
      if (baselineSiblings.length >= 2) {
        const newRelative = newOrder.filter((id) => baselineSiblings.includes(id))
        if (!arraysEqual(baselineSiblings, newRelative)) {
          flags.push(`reordered_under:${op.parent_id} (${baselineSiblings.join(',')} → ${newRelative.join(',')})`)
        }
      }
    }

    if (op.op === 'edit' && op.body) {
      const priorMilestones = baselineMilestones.get(op.phase_id) ?? []
      const dropped = priorMilestones.filter((m) => !op.body!.includes(m))
      if (dropped.length > 0) {
        flags.push(`removed_milestones:${op.phase_id} [${dropped.slice(0, 3).map(s => `"${s.slice(0, 60)}"`).join(', ')}${dropped.length > 3 ? ', …' : ''}]`)
      }
    }
  }

  const pass = flags.length === 0
  const summary = pass
    ? `Diff audit passed: ${diff.ops.length} ops, no breaking changes detected against current baseline.`
    : `Diff audit flagged ${flags.length} breaking change${flags.length === 1 ? '' : 's'}: ${flags.slice(0, 2).join('; ')}${flags.length > 2 ? '; …' : ''}.`

  return { pass, flags, summary }
}

async function loadProposedDiff(sessionId: string): Promise<PlanDiffPayload | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data, error } = await sb
    .from('plan_diffs')
    .select('diff_jsonb')
    .eq('session_id', sessionId)
    .is('rejected_at', null)
    .is('applied_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const jsonb = (data as { diff_jsonb?: unknown }).diff_jsonb
  if (!jsonb || typeof jsonb !== 'object') return null
  const payload = jsonb as PlanDiffPayload
  if (!Array.isArray(payload.ops)) return null
  return payload
}

async function loadBaselinePlanMarkdown(): Promise<string> {
  // Preference order:
  //   1. Latest applied plan_diffs row (rebuild markdown from snapshot if present)
  //   2. Master plan file on disk
  const sb = getSupabaseClient()
  if (sb) {
    const { data } = await sb
      .from('plan_diffs')
      .select('diff_jsonb')
      .not('applied_at', 'is', null)
      .order('applied_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const jsonb = (data as { diff_jsonb?: { applied_markdown_snapshot?: string } } | null)?.diff_jsonb
    if (jsonb?.applied_markdown_snapshot) return jsonb.applied_markdown_snapshot
  }
  // Disk fallback. REPO_ROOT honoured for monorepo-aware deploys; otherwise
  // walk up two levels from atlas/dist/lib/ to the repo root.
  const root = process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
  const masterPlan = join(root, '.agent', 'master-plan.md')
  if (existsSync(masterPlan)) {
    try { return readFileSync(masterPlan, 'utf-8') } catch { return '' }
  }
  return ''
}

// ─── Markdown parsing helpers ──────────────────────────────────────────────

function extractPhaseIds(markdown: string): Set<string> {
  const out = new Set<string>()
  const lines = markdown.split(/\r?\n/)
  const headerRe = /^#{2,6}\s+(?:Phase\s+)?([0-9]+(?:\.[0-9a-z-]+)*)\b/i
  for (const line of lines) {
    const m = line.match(headerRe)
    if (m) out.add(m[1])
  }
  return out
}

function extractPhaseOrder(markdown: string): string[] {
  const out: string[] = []
  const lines = markdown.split(/\r?\n/)
  const headerRe = /^#{2,6}\s+(?:Phase\s+)?([0-9]+(?:\.[0-9a-z-]+)*)\b/i
  for (const line of lines) {
    const m = line.match(headerRe)
    if (m) out.push(m[1])
  }
  return out
}

function extractMilestonesByPhase(markdown: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const lines = markdown.split(/\r?\n/)
  const phaseHeaderRe = /^(#{2,6})\s+(?:Phase\s+)?([0-9]+(?:\.[0-9a-z-]+)*)\b/i

  let currentPhase: string | null = null
  let currentPhaseDepth = 0
  let inMilestones = false
  let currentMilestones: string[] = []

  function flush() {
    if (currentPhase && currentMilestones.length > 0) {
      result.set(currentPhase, currentMilestones)
    }
    currentMilestones = []
    inMilestones = false
  }

  for (const raw of lines) {
    const headerMatch = raw.match(phaseHeaderRe)
    if (headerMatch) {
      flush()
      currentPhase = headerMatch[2]
      currentPhaseDepth = headerMatch[1].length
      continue
    }
    if (!currentPhase) continue

    const subHeaderMatch = raw.match(/^(#{2,6})\s+(.+?)\s*$/)
    if (subHeaderMatch) {
      const depth = subHeaderMatch[1].length
      // A new same-or-shallower-depth header ends the current phase scope.
      if (depth <= currentPhaseDepth) {
        flush()
        currentPhase = null
        continue
      }
      inMilestones = /^milestones\b/i.test(subHeaderMatch[2])
      continue
    }

    if (inMilestones) {
      const bullet = raw.match(/^\s*[-*]\s+(.+?)\s*$/)
      if (bullet) currentMilestones.push(bullet[1])
    }
  }
  flush()
  return result
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
