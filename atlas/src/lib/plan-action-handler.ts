// Phase 1.10aj — handlers for the four cockpit action buttons:
// Add / Modify / Follow / Revisit.
//
// 1.10bb-c (Plan Workshop migration, Session 3): the per-phase wizard was
// deleted entirely per Q1 of the architecture. `startAddWizard`,
// `startModifyWizard`, and `followPhase` no longer have a backing engine;
// they're kept as named exports so server.ts compiles, but they THROW with
// a clear pointer to the new flow.
//
// `toggleRevisit` is independent of the wizard and remains fully working —
// the cockpit's Revisit button keeps functioning during the Workshop
// migration window between Session 3 and Session 4.
//
// Session 4 replaces the cockpit Add/Modify buttons with a "Workshop" tab
// that points at workshop-engine.ts. Session 6 finalizes the
// /atlas/workshop/* server routes. After Session 6 ships, this file's
// stub functions can be deleted entirely.

import { setPlanNodeState, clearPlanNodeState } from './plan-state'

export type PlanAction = 'add' | 'modify' | 'follow' | 'revisit'

// ─── Stub types kept for source-stable shape ───────────────────────────────
//
// These mirror the old WizardQuestion / WizardAnswer / SpecFromWizardResult
// shapes so server.ts type-imports don't break. Stub functions never produce
// real values of these shapes — they throw before returning.

export interface WizardQuestion {
  id: string
  prompt: string
  options?: Array<{ id: string; label: string }>
}

export interface WizardAnswer {
  questionId: string
  questionPrompt: string
  answer: string
  freeText?: string
}

export interface AddOrModifyResult {
  questions: WizardQuestion[]
  source: 'claude' | 'fallback'
  costUsd: number
}

export interface SpecFromWizardResult {
  filename: string
  markdown: string
  validationOk: boolean
  validationErrors: string[]
  source: 'claude' | 'fallback'
  costUsd: number
}

export interface FollowPhaseInput {
  planNodeId: string
  parentTitle: string
  phaseId: string
  phaseHint: string
  mode: 'add' | 'modify'
  answers: WizardAnswer[]
  conceptSummaries?: string[]
  existingSpec?: string
  isNewPhase: boolean
  actorPhone?: string
  overrideSpecMarkdown?: string
}

export interface FollowPhaseResult {
  ok: boolean
  filename: string
  spec: SpecFromWizardResult
  pushed: boolean
  sha?: string
  masterPlanUpdated: boolean
  reason?: string
}

const WORKSHOP_REPLACEMENT_NOTICE =
  'The per-phase wizard was deleted in 1.10bb-c (Session 3). ' +
  'Plan Workshop replaces it: see atlas/src/lib/workshop-engine.ts. ' +
  'Server-side workshop endpoints land in 1.10bb-c Session 6; the cockpit Workshop tab lands in Session 4. ' +
  'Until then, cockpit Add/Modify/Follow buttons return 410 Gone.'

// ─── Stubbed wizard exports ─────────────────────────────────────────────────

/** STUB — wizard removed in 1.10bb-c. Throws with replacement guidance. */
export async function startAddWizard(_input: {
  parentTitle: string
  parentBody: string
  phaseHint: string
  conceptSummaries?: string[]
  recentDoneSpecs?: string[]
}): Promise<AddOrModifyResult> {
  throw new Error(`startAddWizard: ${WORKSHOP_REPLACEMENT_NOTICE}`)
}

/** STUB — wizard removed in 1.10bb-c. Throws with replacement guidance. */
export async function startModifyWizard(_input: {
  parentTitle: string
  parentBody: string
  phaseHint: string
  existingSpec: string
  conceptSummaries?: string[]
  recentDoneSpecs?: string[]
}): Promise<AddOrModifyResult> {
  throw new Error(`startModifyWizard: ${WORKSHOP_REPLACEMENT_NOTICE}`)
}

/** STUB — followPhase relied on spec-from-wizard which was deleted in
 *  1.10bb-c. The replacement (autonomous-queue-generator.ts) lands in
 *  Session 6 and queues specs from approved plan diffs, not from
 *  per-phase wizard answers. */
export async function followPhase(_input: FollowPhaseInput): Promise<FollowPhaseResult> {
  throw new Error(`followPhase: ${WORKSHOP_REPLACEMENT_NOTICE}`)
}

// ─── toggleRevisit — independent of wizard, still works ────────────────────

/**
 * Toggle revisit state on a plan node. If currently revisit, clear it; else
 * set it. The build runner skips any node carrying state='optional'
 * (which is what revisit maps to in atlas_plan_node_state — reuses the
 * existing CHECK enum so we don't need a schema migration).
 */
export async function toggleRevisit(planNodeId: string): Promise<{ ok: boolean; revisiting: boolean; reason?: string }> {
  const { getPlanNodeState } = await import('./plan-state.js')
  const rows = await getPlanNodeState(planNodeId)
  const isRevisit = rows.some((r: { state: string; metadata: Record<string, unknown> | null }) =>
    r.state === 'optional' && r.metadata && (r.metadata as Record<string, unknown>).revisit === true)
  if (isRevisit) {
    const r = await clearPlanNodeState(planNodeId, 'optional')
    return { ok: r.ok, revisiting: false, reason: r.reason }
  } else {
    const r = await setPlanNodeState({
      planNodeId,
      state: 'optional',
      setBy: 'user',
      metadata: { revisit: true },
      reason: 'cockpit revisit',
    })
    return { ok: r.ok, revisiting: true, reason: r.reason }
  }
}
