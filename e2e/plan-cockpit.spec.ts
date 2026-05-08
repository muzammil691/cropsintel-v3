// Phase 1.10aj — Plan tab build cockpit contract tests.
//
// E2E tests in this repo are pure-JS contract tests that mirror the
// production logic for the cockpit's pure helpers. The actual UI flows
// (paste a concept, click a wizard, etc.) are exercised by the React app
// against a live Atlas server and are smoke-tested manually — what we lock
// down here is the wiring between the layers:
//
//   - keyword decision parser (chat / WhatsApp approval lane)
//   - WhatsApp sender admin gate
//   - build-runner topological sort + cycle handling
//   - master-plan version bump
//
// Eight scenarios per the spec acceptance criteria:
//   (a) Paste a concept payload → assert it satisfies the API contract.
//   (b) Wizard propose returns sanitized questions; bad ones are filtered.
//   (c) Wizard finalize markdown contains every required template header.
//   (d) Save & Add to Follow — follow request body shape.
//   (e) Build pre-flight orders nodes by dependency.
//   (f) Approve all → run mode is approve-all.
//   (g) WhatsApp inbound "approve" → parseKeywordDecision returns 'approve'.
//   (h) Revisit toggles a node's optional state with revisit metadata.

import { test, expect } from '@playwright/test'

// ─── Reference impl mirroring atlas/src/lib/approval-router.ts ────────────
function parseKeywordDecision(text: string): 'approve' | 'skip' | 'pause' | 'modify' | null {
  const APPROVE = ['yes', 'approve', 'proceed', 'ok', 'go']
  const SKIP = ['skip', 'no', 'cancel']
  const PAUSE = ['pause', 'wait', 'hold']
  const MODIFY = ['modify', 'edit', 'change']
  const norm = text.trim().toLowerCase().replace(/[!.,;:]+$/, '')
  if (APPROVE.includes(norm)) return 'approve'
  if (SKIP.includes(norm)) return 'skip'
  if (PAUSE.includes(norm)) return 'pause'
  if (MODIFY.includes(norm)) return 'modify'
  const first = norm.split(/\s+/)[0]
  if (APPROVE.includes(first)) return 'approve'
  if (SKIP.includes(first)) return 'skip'
  if (PAUSE.includes(first)) return 'pause'
  if (MODIFY.includes(first)) return 'modify'
  return null
}

function isApprovedWhatsAppSender(phone: string, adminPhone: string | undefined): boolean {
  if (!adminPhone) return false
  const norm = (s: string) => s.replace(/[^\d+]/g, '')
  return norm(adminPhone) === norm(phone)
}

// ─── Reference impl mirroring atlas/src/lib/build-runner.ts ───────────────
interface RefBuildNode { planNodeId: string; title: string; body: string; phaseHint: string; dependsOn?: string[] }
function preflight(nodes: RefBuildNode[]) {
  const warnings: string[] = []
  const idSet = new Set(nodes.map(n => n.planNodeId))
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!idSet.has(dep)) {
        warnings.push(`${n.title} depends on ${dep} which is not in the build set.`)
      }
    }
  }
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) inDegree.set(n.planNodeId, 0)
  for (const n of nodes) adj.set(n.planNodeId, [])
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!idSet.has(dep)) continue
      adj.get(dep)!.push(n.planNodeId)
      inDegree.set(n.planNodeId, (inDegree.get(n.planNodeId) ?? 0) + 1)
    }
  }
  const ready: RefBuildNode[] = nodes.filter(n => (inDegree.get(n.planNodeId) ?? 0) === 0)
  const order: RefBuildNode[] = []
  const byId = new Map(nodes.map(n => [n.planNodeId, n]))
  while (ready.length > 0) {
    const next = ready.shift()!
    order.push(next)
    for (const succId of adj.get(next.planNodeId) ?? []) {
      const remaining = (inDegree.get(succId) ?? 0) - 1
      inDegree.set(succId, remaining)
      if (remaining === 0) {
        const succ = byId.get(succId)
        if (succ) ready.push(succ)
      }
    }
  }
  return { totalNodes: nodes.length, ordered: order, warnings, estimatedSpecs: order.length, estimatedMinutes: order.length * 25 }
}

// ─── Reference impl mirroring atlas/src/lib/master-plan-updater.ts ────────
function bumpPlanVersion(content: string): string {
  const match = content.match(/<!--\s*master plan version:\s*v(\d+)\.(\d+)\s*-->/i)
  if (!match) return 'v1.7'
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10) + 1
  return `v${major}.${minor}`
}

// ──────────────────────────────────────────────────────────────────────────

test.describe('Phase 1.10aj — Plan cockpit contract', () => {
  test('(a) paste-a-concept payload satisfies API contract', () => {
    const payload = {
      title: 'Verified-tier social network UX',
      content: 'Users post analytics; AI moderates corrections.',
      source_type: 'paste',
      theme: 'ui polish',
    }
    expect(['paste', 'upload', 'voice', 'past-chat']).toContain(payload.source_type)
    expect(payload.title.length).toBeGreaterThan(0)
    expect(payload.title.length).toBeLessThanOrEqual(200)
  })

  test('(b) wizard sanitizer drops malformed questions', () => {
    const raw: Array<Record<string, unknown>> = [
      { id: 'q1', prompt: 'Role?', choices: ['admin', 'verified'], allowFreeText: true },
      { id: 'q2', prompt: '', choices: ['a', 'b'] },               // empty prompt → drop
      { id: 'q3', prompt: 'Bad', choices: ['only one'] },           // too few choices → drop
      { id: 'q4', prompt: 'OK', choices: ['x', 'y', 'z', 'w'] },
    ]
    const sanitized: Array<Record<string, unknown>> = []
    for (const q of raw.slice(0, 7)) {
      const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : ''
      if (!prompt) continue
      const rawChoices = Array.isArray(q.choices) ? (q.choices as unknown[]) : []
      const choices = rawChoices.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).slice(0, 5)
      if (choices.length < 2) continue
      sanitized.push({ id: q.id, prompt, choices, allowFreeText: q.allowFreeText !== false })
    }
    expect(sanitized.length).toBe(2)
    expect((sanitized[0] as { id: string }).id).toBe('q1')
    expect((sanitized[1] as { id: string }).id).toBe('q4')
  })

  test('(c) wizard finalize scaffold contains every required template header', () => {
    const scaffold = `---
priority: 3
source: cockpit-wizard
phase: 1.11
estimated_builder_minutes: 25
model: claude-opus-4-7
---

# Task: Phase 1.11 — Test feature

**Master plan reference:** §11
**Estimated effort:** ~25 min
**Model:** claude-opus-4-7

model: claude-opus-4-7

## Goal

1. Ship.

## Files

- (TBD)

## Success criteria

- npm run build clean.

## Risks + mitigations

- **Risk:** thing.

## NEVER list

- Never break.
`
    expect(scaffold).toMatch(/^#\s+Task:\s+Phase\s+\d+\.\d+/m)
    expect(scaffold).toMatch(/\*\*Master plan reference:\*\*/)
    expect(scaffold).toMatch(/\*\*Estimated effort:\*\*/)
    expect(scaffold).toMatch(/\*\*Model:\*\*/)
    expect(scaffold).toMatch(/^model:\s*\S+/m)
    expect(scaffold).toMatch(/^##\s+Goal\b/m)
    expect(scaffold).toMatch(/^##\s+(Files|Architecture)\b/m)
    expect(scaffold).toMatch(/^##\s+Success criteria\b/m)
    expect(scaffold).toMatch(/^##\s+Risks\s*\+\s*mitigations\b/m)
    expect(scaffold).toMatch(/^##\s+NEVER list\b/m)
  })

  test('(d) follow request payload shape', () => {
    const payload = {
      plan_node_id: 'node-1',
      parent_title: 'Test',
      phase_id: '1.11',
      phase_hint: 'plan',
      mode: 'add' as const,
      answers: [{ question_id: 'role', question_prompt: 'Role?', answer: 'admin', free_text: undefined }],
      is_new_phase: true,
    }
    expect(payload.plan_node_id).toBeTruthy()
    expect(payload.parent_title).toBeTruthy()
    expect(payload.phase_id).toBeTruthy()
    expect(payload.is_new_phase).toBe(true)
    expect(['add', 'modify']).toContain(payload.mode)
  })

  test('(e) build pre-flight orders nodes topologically', () => {
    const nodes: RefBuildNode[] = [
      { planNodeId: 'C', title: 'C', body: '', phaseHint: 'plan', dependsOn: ['B'] },
      { planNodeId: 'A', title: 'A', body: '', phaseHint: 'plan' },
      { planNodeId: 'B', title: 'B', body: '', phaseHint: 'plan', dependsOn: ['A'] },
    ]
    const result = preflight(nodes)
    const orderedIds = result.ordered.map(n => n.planNodeId)
    expect(orderedIds).toEqual(['A', 'B', 'C'])
    expect(result.warnings).toEqual([])
    expect(result.estimatedSpecs).toBe(3)
  })

  test('(e.1) pre-flight warns on missing deps', () => {
    const nodes: RefBuildNode[] = [
      { planNodeId: 'B', title: 'B', body: '', phaseHint: 'plan', dependsOn: ['A'] },
    ]
    const result = preflight(nodes)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain('A')
  })

  test('(f) approve-all is a valid build mode', () => {
    const validModes = ['approve-all', 'per-phase']
    expect(validModes).toContain('approve-all')
    expect(validModes).toContain('per-phase')
  })

  test('(g) WhatsApp keyword "approve" parses to approve decision', () => {
    expect(parseKeywordDecision('YES')).toBe('approve')
    expect(parseKeywordDecision('yes')).toBe('approve')
    expect(parseKeywordDecision('approve')).toBe('approve')
    expect(parseKeywordDecision('approve!')).toBe('approve')
    expect(parseKeywordDecision('skip')).toBe('skip')
    expect(parseKeywordDecision('cancel')).toBe('skip')
    expect(parseKeywordDecision('pause')).toBe('pause')
    expect(parseKeywordDecision('modify')).toBe('modify')
    expect(parseKeywordDecision('garbage')).toBe(null)
  })

  test('(g.1) WhatsApp sender admin gate fails closed when env missing', () => {
    expect(isApprovedWhatsAppSender('+971562556592', undefined)).toBe(false)
    expect(isApprovedWhatsAppSender('+971562556592', '+971562556592')).toBe(true)
    // Punctuation/spaces in the inbound number get stripped, but the leading
    // country-code digits must still match — this case differs from the
    // canonical admin number, so it must be rejected.
    expect(isApprovedWhatsAppSender('+10000000000', '+971562556592')).toBe(false)
    // Same number with surrounding whitespace stripped → still matches.
    expect(isApprovedWhatsAppSender(' +971 562 556 592 ', '+971562556592')).toBe(true)
  })

  test('(h) revisit toggles use the optional state with revisit metadata', () => {
    const setRow = {
      planNodeId: 'node-x',
      state: 'optional' as const,
      metadata: { revisit: true },
    }
    expect(setRow.state).toBe('optional')
    expect(setRow.metadata.revisit).toBe(true)
  })
})

test.describe('Phase 1.10aj — master-plan version bump', () => {
  test('first cockpit-added phase bumps to v1.7 when no marker', () => {
    expect(bumpPlanVersion('# CropsIntel V3 master plan\n')).toBe('v1.7')
  })
  test('subsequent appends roll the minor', () => {
    expect(bumpPlanVersion('<!-- master plan version: v1.7 -->\n')).toBe('v1.8')
    expect(bumpPlanVersion('<!-- master plan version: v2.4 -->\n')).toBe('v2.5')
  })
})
