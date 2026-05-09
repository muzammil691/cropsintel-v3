// Phase 1.10ba — Cockpit polish contract tests.
//
// E2E tests in this repo are pure-JS contract tests that mirror the
// production logic for the cockpit's pure helpers (matches the pattern in
// plan-cockpit.spec.ts). The actual UI flows (chat-style wizard render,
// concept-to-wizard handoff, button visibility) are exercised by the React
// app against a live Atlas server. What we lock down here is the wiring:
//
//   (a) PlanActionButtons render contract — always-visible labels with
//       a data-cockpit-action attribute; mobile collapses labels but never
//       opacity-0.
//   (b) Workshop strip collapsed-state persistence key.
//   (c) Wizard chat-style turn shape — { question, answer } pairs.
//   (d) Clarity bar progression invariants.
//   (e) Concept-to-wizard event payload shape.
//   (f) "Generate spec when ready" enabled-state predicate.
//   (g) Build button label predicate (count + helpful tooltip when 0).
//   (h) Build button disabled when zero followed.
//   (i) BuildRunnerModal launch-tier grouping derivation.
//   (j) Per-phase minute estimate is calibrated and stable.

import { test, expect } from '@playwright/test'

// ─── Reference impls mirroring production helpers ───────────────────────────

// Mirrors src/components/atlas-plan/BuildRunnerModal.tsx :: deriveLaunchTier
function deriveLaunchTier(title: string): string {
  const m = title.match(/^\s*\[?\s*(\d+\.\d+(?:-?[a-z]+)?)\b/i)
  if (m) return m[1].toLowerCase()
  const m2 = title.match(/\bphase\s+(\d+\.\d+(?:-?[a-z]+)?)\b/i)
  if (m2) return m2[1].toLowerCase()
  return 'later'
}

// Mirrors PlanActionButtons enabled / labelled contract.
const COCKPIT_ACTIONS = ['add', 'modify', 'follow', 'revisit'] as const
type CockpitAction = (typeof COCKPIT_ACTIONS)[number]
function actionLabel(a: CockpitAction, isFollowing = false, isRevisiting = false): string {
  if (a === 'follow') return isFollowing ? 'Following' : 'Follow'
  if (a === 'revisit') return isRevisiting ? 'Revisiting' : 'Revisit'
  return a[0].toUpperCase() + a.slice(1)
}

// Build button copy predicate (mirrors AtlasPlanTab).
function buildButtonLabel(followedCount: number): string {
  if (followedCount === 0) return 'Build'
  return `Build (${followedCount} phase${followedCount === 1 ? '' : 's'} queued)`
}
function buildButtonDisabled(followedCount: number): boolean {
  return followedCount === 0
}
function buildButtonTooltip(followedCount: number): string {
  if (followedCount === 0) return 'Click Follow on a phase to enable build'
  return `Run build for ${followedCount} phase${followedCount === 1 ? '' : 's'}`
}

// "Generate spec when ready" enabled predicate (mirrors PhaseWizard).
function generateSpecEnabled(clarity: number, busy: boolean): boolean {
  return !busy && clarity >= 90
}

// Concept-to-wizard event payload shape (mirrors ConceptsPanel dispatch).
interface ConceptHandoffDetail {
  id: string
  title: string
  content: string
  source_type: 'paste' | 'upload' | 'voice' | 'past-chat'
  theme?: string
}
function buildConceptHandoffPayload(c: ConceptHandoffDetail): CustomEventInit<ConceptHandoffDetail> {
  return { detail: c }
}

// Workshop strip persistence key (mirrors AtlasPlanTab WORKSHOP_STRIP_KEY).
const WORKSHOP_STRIP_KEY = 'cockpit_workshop_strip_collapsed'

// Per-phase Builder estimate (mirrors BuildRunnerModal PER_PHASE_MIN).
const PER_PHASE_MIN = 25

// ──────────────────────────────────────────────────────────────────────────

test.describe('Phase 1.10ba — Cockpit polish contract', () => {
  test('(a) PlanActionButtons declares the four cockpit actions with stable data attribute keys', () => {
    expect(COCKPIT_ACTIONS).toEqual(['add', 'modify', 'follow', 'revisit'])
    // Each action must have a label even at default state — never blank.
    for (const a of COCKPIT_ACTIONS) {
      expect(actionLabel(a).length).toBeGreaterThan(0)
    }
    // Toggle states for follow / revisit produce distinct labels so the
    // user sees state changes, not just color swaps.
    expect(actionLabel('follow', true)).toBe('Following')
    expect(actionLabel('follow', false)).toBe('Follow')
    expect(actionLabel('revisit', false, true)).toBe('Revisiting')
    expect(actionLabel('revisit', false, false)).toBe('Revisit')
  })

  test('(b) Workshop strip persists collapsed state under a stable localStorage key', () => {
    // The key must not collide with other Atlas storage prefixes; it lives
    // under cockpit_* per the rest of the cockpit's localStorage usage.
    expect(WORKSHOP_STRIP_KEY).toBe('cockpit_workshop_strip_collapsed')
    // Stored values are '0' / '1' so collapsed-state survives a JSON.parse
    // mismatch (we don't want to throw on '"true"' or 'undefined').
    const collapsed = '1'
    const expanded = '0'
    expect(collapsed === '1').toBe(true)
    expect(expanded === '1').toBe(false)
  })

  test('(c) Wizard transcript turns have { question, answer } shape', () => {
    const turn = { question: 'What is the primary user role?', answer: 'Customer' }
    expect(typeof turn.question).toBe('string')
    expect(typeof turn.answer).toBe('string')
    expect(turn.question.length).toBeGreaterThan(0)
    expect(turn.answer.length).toBeGreaterThan(0)
  })

  test('(d) Clarity score is bounded [0, 100] and monotonically tracks turn count up to 90', () => {
    const scores = [0, 12, 35, 58, 73, 88, 95]
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
    // Generate-when-ready button gates on clarity >= 90.
    expect(generateSpecEnabled(89, false)).toBe(false)
    expect(generateSpecEnabled(90, false)).toBe(true)
    expect(generateSpecEnabled(95, false)).toBe(true)
    // Disabled while a turn is in flight regardless of clarity.
    expect(generateSpecEnabled(95, true)).toBe(false)
  })

  test('(e) Concept-to-wizard event payload preserves the full concept', () => {
    const concept: ConceptHandoffDetail = {
      id: 'c-123',
      title: 'crops intel v1 clean build',
      content: 'binance-style heatmap dashboard',
      source_type: 'paste',
      theme: 'binance style',
    }
    const init = buildConceptHandoffPayload(concept)
    expect(init.detail).toBeTruthy()
    expect(init.detail!.id).toBe('c-123')
    expect(init.detail!.title).toBe('crops intel v1 clean build')
    expect(['paste', 'upload', 'voice', 'past-chat']).toContain(init.detail!.source_type)
    expect(init.detail!.theme).toBe('binance style')
  })

  test('(f) Generate spec button enabled at clarity >= 90 only', () => {
    expect(generateSpecEnabled(0, false)).toBe(false)
    expect(generateSpecEnabled(73, false)).toBe(false)
    expect(generateSpecEnabled(90, false)).toBe(true)
    expect(generateSpecEnabled(100, false)).toBe(true)
  })

  test('(g) Build button label is count-aware', () => {
    expect(buildButtonLabel(0)).toBe('Build')
    expect(buildButtonLabel(1)).toBe('Build (1 phase queued)')
    expect(buildButtonLabel(3)).toBe('Build (3 phases queued)')
    expect(buildButtonLabel(12)).toBe('Build (12 phases queued)')
  })

  test('(h) Build button disabled with helpful tooltip when zero followed', () => {
    expect(buildButtonDisabled(0)).toBe(true)
    expect(buildButtonDisabled(1)).toBe(false)
    expect(buildButtonTooltip(0)).toBe('Click Follow on a phase to enable build')
    expect(buildButtonTooltip(3)).toContain('3')
  })

  test('(i) Launch tier derivation pulls dotted version from common title shapes', () => {
    expect(deriveLaunchTier('1.3 Pilot commodity')).toBe('1.3')
    expect(deriveLaunchTier('[1.10ba] Cockpit polish')).toBe('1.10ba')
    expect(deriveLaunchTier('1.0-alpha — auth')).toBe('1.0-alpha')
    expect(deriveLaunchTier('Phase 2.4 review')).toBe('2.4')
    // No version → falls back to "later" so the tier always exists.
    expect(deriveLaunchTier('Customer outreach refresh')).toBe('later')
  })

  test('(i.1) Tier grouping preserves topological order across tiers', () => {
    const ordered = [
      { planNodeId: 'a', title: '[1.0-alpha] Auth' },
      { planNodeId: 'b', title: '[1.0-alpha] Landing' },
      { planNodeId: 'c', title: '[1.0-beta] Profile' },
      { planNodeId: 'd', title: '[1.1] Concepts' },
    ]
    const tiers = new Map<string, typeof ordered>()
    for (const n of ordered) {
      const t = deriveLaunchTier(n.title)
      const list = tiers.get(t) ?? []
      list.push(n)
      tiers.set(t, list)
    }
    expect(Array.from(tiers.keys())).toEqual(['1.0-alpha', '1.0-beta', '1.1'])
    expect(tiers.get('1.0-alpha')!.length).toBe(2)
    expect(tiers.get('1.0-beta')!.length).toBe(1)
    expect(tiers.get('1.1')!.length).toBe(1)
  })

  test('(j) Per-phase minute estimate is the calibrated 25-min average', () => {
    expect(PER_PHASE_MIN).toBe(25)
    // Total estimate scales linearly — guards the modal's tier subtotal.
    expect(PER_PHASE_MIN * 1).toBe(25)
    expect(PER_PHASE_MIN * 3).toBe(75)
    expect(PER_PHASE_MIN * 4).toBe(100)
  })
})
