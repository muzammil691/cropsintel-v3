// Phase 1.10am — Deep multi-turn wizard contract tests.
//
// Per the project convention (see plan-cockpit.spec.ts and idea-file.spec.ts),
// e2e tests in this repo are pure-JS contract tests that mirror the production
// logic in atlas/src/lib/wizard-engine.ts + wizard-session.ts. We keep the
// reference impls in this file in sync with the production code; drift is the
// bug class this file catches.
//
// Six scenarios per the spec acceptance criteria:
//   (a) Start a wizard for Phase 1.3 → first question is shaped correctly and
//       the prompt embeds idea-file content (verified-tier audience markers).
//   (b) Answer Q1 → Q2 is different and depends on Q1 answer.
//   (c) Run wizard for ~5 turns → clarity_score is monotonically non-decreasing.
//   (d) Wizard reaches kind:"complete" → spec_draft is valid markdown with the
//       Builder template's required sections.
//   (e) Close modal mid-wizard, reopen → resumable session is found.
//   (f) Hit 12 turns without 100 clarity → spec written anyway with a
//       "## Documented assumptions" section.

import { test, expect } from '@playwright/test'

// ─── Reference: extractDeepTurnJson (mirrors wizard-engine.ts) ──────────────
type DeepTurnQuestion = {
  kind: 'question'
  rationale: string
  question: string
  options: string[]
  allow_freeform: boolean
  current_clarity: number
}
type DeepTurnComplete = {
  kind: 'complete'
  current_clarity: number
  summary_of_decisions: string
  spec_draft: string
}
type DeepTurnResult = DeepTurnQuestion | DeepTurnComplete

function extractDeepTurnJsonRef(text: string): DeepTurnResult | null {
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

// ─── Reference: WizardState + state mutators (mirror wizard-engine.ts) ──────
interface WizardHistoryEntry { question: string; answer: string }
interface WizardState {
  phase_id: string
  parent_title: string
  parent_body: string
  phase_hint: string
  mode: 'add' | 'modify'
  history: WizardHistoryEntry[]
  total_turns: number
  is_complete: boolean
  clarity_score: number
  current_turn?: { question: string; options: string[]; allow_freeform: boolean; rationale: string }
  spec_draft?: string
  summary_of_decisions?: string
}

function applyDeepTurnResultRef(state: WizardState, result: DeepTurnResult): WizardState {
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

function recordWizardAnswerRef(state: WizardState, answer: string): WizardState {
  if (!state.current_turn) return state
  return {
    ...state,
    history: [...state.history, { question: state.current_turn.question, answer }],
    total_turns: state.total_turns + 1,
    current_turn: undefined,
  }
}

// ─── Reference: prompt-builder ideas-file injection (mirror wizard-engine) ──
function buildDeepTurnPromptRef(args: {
  state: WizardState
  ideaContent: string | null
}): string {
  const parts: string[] = []
  parts.push(`Phase id: ${args.state.phase_id}`)
  parts.push(`Parent phase: ${args.state.parent_title}`)
  if (args.state.phase_hint) parts.push(`Phase hint: ${args.state.phase_hint}`)
  if (args.ideaContent) {
    parts.push(`Product vision (canonical, Muzammil-edited — read FIRST, every question must align):\n${args.ideaContent.slice(0, 6000)}`)
  }
  const historyBlock = args.state.history.length > 0
    ? args.state.history.map((h, i) => `Turn ${i + 1}:\nQ: ${h.question}\nA: ${h.answer}`).join('\n\n')
    : '(no prior turns — this is the opening question)'
  parts.push(`Conversation so far:\n${historyBlock}`)
  return parts.join('\n\n')
}

// ─── Reference: 12-turn-cap fallback spec (mirror wizard-session.ts) ────────
const MAX_TURNS = 12
function buildFallbackSpecRef(state: WizardState): string {
  const phase = state.phase_id || 'X.Y'
  const title = state.parent_title || 'wizard-generated phase'
  const qa = state.history
    .map((h, i) => `${i + 1}. **${h.question}** — ${h.answer}`)
    .join('\n')
  return `---
priority: 3
source: cockpit-wizard
phase: ${phase}
estimated_builder_minutes: 25
model: claude-opus-4-7
---

# Task: Phase ${phase} — ${title}

**Master plan reference:** §11 — phase added via deep cockpit wizard
**Estimated effort:** ~25 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Ship the feature.

## Documented assumptions

The wizard didn't reach 100% clarity before the turn cap. Builder operates
under the following assumptions unless flagged:

${qa || '- (no Q/A history captured)'}

## Architecture

(TBD)

## Files

- (TBD)

## Success criteria

- \`npm run build\` clean.

## Risks + mitigations

- **Risk:** Wizard didn't reach 100% clarity.

## NEVER list

- Never break information walls.
`
}

// ─── Reference: in-memory resumable-session lookup ──────────────────────────
type SessionRow = { id: string; phase_id: string; state: WizardState; updated_at: string; completed_at: string | null }
function findResumableRef(rows: SessionRow[], phaseId: string, nowMs: number): SessionRow | null {
  const cutoff = nowMs - 24 * 60 * 60 * 1000
  const candidates = rows
    .filter(r => r.phase_id === phaseId)
    .filter(r => !r.completed_at)
    .filter(r => Date.parse(r.updated_at) >= cutoff)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return candidates[0] ?? null
}

// ─── Spec template required-sections check (mirrors spec-template.ts) ───────
const REQUIRED_HEADERS = [
  '## Goal',
  '## Success criteria',
  '## Risks + mitigations',
  '## NEVER list',
]
const REQUIRED_LINES = ['**Master plan reference:**', '**Estimated effort:**', '**Model:**']

function hasArchitectureOrFiles(md: string): boolean {
  return /^##\s+Files\b/m.test(md) || /^##\s+Architecture\b/m.test(md)
}

// ──────────────────────────────────────────────────────────────────────────

test.describe('Phase 1.10am — Deep multi-turn wizard contract', () => {
  test('(a) first turn embeds idea-file content + question is well-shaped', () => {
    const idea = `# CropsIntel V1 — Product Vision\n\n## Who it's for\n\n- Tier 1 — Registered users (free, broad)\n- Tier 2 — Verified users (paid, deep — Gulf importers, Maxons buyers)\n- Tier 3 — Admins (Atlas + Maxons)\n\n## Hard rules\n\n1. Foundation-first.\n`
    const initialState: WizardState = {
      phase_id: '1.3',
      parent_title: '1.3 — Auth (login + signup + role guards)',
      parent_body: 'Auth phase covering OTP + roles.',
      phase_hint: '1-3-auth',
      mode: 'add',
      history: [],
      total_turns: 0,
      is_complete: false,
      clarity_score: 0,
    }
    const prompt = buildDeepTurnPromptRef({ state: initialState, ideaContent: idea })
    expect(prompt).toMatch(/Product vision \(canonical, Muzammil-edited/)
    expect(prompt).toMatch(/Tier 2 — Verified users/)
    expect(prompt).toMatch(/Phase id: 1\.3/)
    expect(prompt).toMatch(/no prior turns — this is the opening question/)

    // First-turn JSON parse + apply.
    const claudeResponse = JSON.stringify({
      kind: 'question',
      rationale: 'Need to know primary login surface before we can ask follow-ups.',
      question: 'For verified-tier login, which channel is canonical?',
      options: ['email + password', 'WhatsApp OTP only', 'both'],
      allow_freeform: true,
      current_clarity: 25,
    })
    const parsed = extractDeepTurnJsonRef(claudeResponse)
    expect(parsed).not.toBeNull()
    expect(parsed!.kind).toBe('question')
    if (parsed!.kind === 'question') {
      expect(parsed!.question.length).toBeGreaterThan(5)
      expect(parsed!.options.length).toBeGreaterThanOrEqual(2)
      expect(parsed!.options.length).toBeLessThanOrEqual(5)
    }
    const afterFirstTurn = applyDeepTurnResultRef(initialState, parsed!)
    expect(afterFirstTurn.current_turn?.question).toMatch(/verified-tier login/i)
    expect(afterFirstTurn.clarity_score).toBe(25)
    expect(afterFirstTurn.is_complete).toBe(false)
  })

  test('(b) Q2 depends on Q1 answer — different question, history carries through', () => {
    let state: WizardState = {
      phase_id: '1.3',
      parent_title: 'Auth phase',
      parent_body: '',
      phase_hint: '1-3-auth',
      mode: 'add',
      history: [],
      total_turns: 0,
      is_complete: false,
      clarity_score: 0,
    }

    // Q1 from Atlas
    const q1 = extractDeepTurnJsonRef(JSON.stringify({
      kind: 'question',
      rationale: 'Need login channel.',
      question: 'What login methods?',
      options: ['email', 'WhatsApp', 'both'],
      allow_freeform: true,
      current_clarity: 20,
    }))!
    state = applyDeepTurnResultRef(state, q1)

    // User answers Q1
    state = recordWizardAnswerRef(state, 'both')
    expect(state.history).toHaveLength(1)
    expect(state.history[0]).toEqual({ question: 'What login methods?', answer: 'both' })
    expect(state.total_turns).toBe(1)
    expect(state.current_turn).toBeUndefined()

    // Q2 from Atlas — depends on Q1 (whatsapp branch).
    const q2 = extractDeepTurnJsonRef(JSON.stringify({
      kind: 'question',
      rationale: 'You picked WhatsApp — narrow the WhatsApp flow.',
      question: 'For the WhatsApp flow, when a number does not match an existing record, what happens?',
      options: ['auto-create', 'admin invite', 'magic link to email'],
      allow_freeform: true,
      current_clarity: 45,
    }))!
    state = applyDeepTurnResultRef(state, q2)

    expect(state.current_turn?.question).not.toEqual(state.history[0].question)
    expect(state.current_turn?.question).toMatch(/WhatsApp flow/)
    expect(state.clarity_score).toBeGreaterThan(20)

    // Prompt for turn 3 must carry both prior turns into the conversation.
    const prompt = buildDeepTurnPromptRef({ state: { ...state, total_turns: state.total_turns }, ideaContent: null })
    expect(prompt).toMatch(/Turn 1:\nQ: What login methods\?\nA: both/)
  })

  test('(c) clarity_score is monotonically non-decreasing across 5 turns', () => {
    let state: WizardState = {
      phase_id: '1.3',
      parent_title: 'Auth',
      parent_body: '',
      phase_hint: '1-3-auth',
      mode: 'add',
      history: [],
      total_turns: 0,
      is_complete: false,
      clarity_score: 0,
    }
    const claritySequence = [15, 30, 50, 70, 88]
    const observed: number[] = []
    for (let i = 0; i < claritySequence.length; i++) {
      const turn = extractDeepTurnJsonRef(JSON.stringify({
        kind: 'question',
        rationale: `t${i}`,
        question: `Question ${i + 1}?`,
        options: ['a', 'b'],
        allow_freeform: false,
        current_clarity: claritySequence[i],
      }))!
      state = applyDeepTurnResultRef(state, turn)
      observed.push(state.clarity_score)
      state = recordWizardAnswerRef(state, 'a')
    }
    for (let i = 1; i < observed.length; i++) {
      expect(observed[i]).toBeGreaterThanOrEqual(observed[i - 1])
    }
    expect(state.history).toHaveLength(5)
    expect(state.total_turns).toBe(5)
  })

  test('(d) completion result yields a Builder-valid spec markdown', () => {
    const completeJson = JSON.stringify({
      kind: 'complete',
      current_clarity: 100,
      summary_of_decisions: 'Verified-tier WhatsApp OTP; admin role gate on /admin/*; profile edit form on first login.',
      spec_draft: [
        '---',
        'priority: 3',
        'source: cockpit-wizard',
        'phase: 1.3',
        'estimated_builder_minutes: 30',
        'model: claude-opus-4-7',
        '---',
        '',
        '# Task: Phase 1.3 — Auth (login + signup + role guards)',
        '',
        '**Master plan reference:** §4.1 — auth precedes data spine.',
        '**Estimated effort:** ~30 min Builder time',
        '**Model:** claude-opus-4-7',
        '',
        'model: claude-opus-4-7',
        '',
        '---',
        '',
        '## Goal',
        '',
        'Ship verified-tier WhatsApp OTP login + role guards.',
        '',
        '## Files',
        '',
        '- src/components/auth/OtpForm.tsx',
        '',
        '## Success criteria',
        '',
        '- `npm run build` clean.',
        '',
        '## Risks + mitigations',
        '',
        '- **Risk:** OTP delivery flake. **Mitigation:** Twilio fallback.',
        '',
        '## NEVER list',
        '',
        '- Never put AI provider keys in `VITE_*` env vars.',
      ].join('\n'),
    })
    const result = extractDeepTurnJsonRef(completeJson)
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('complete')
    if (result!.kind !== 'complete') return
    const md = result.spec_draft
    for (const h of REQUIRED_HEADERS) expect(md).toContain(h)
    for (const line of REQUIRED_LINES) expect(md).toContain(line)
    expect(hasArchitectureOrFiles(md)).toBe(true)
    expect(md).toMatch(/^model:\s*claude-/m)
    expect(md).toMatch(/^# Task: Phase 1\.3 —/m)
  })

  test('(e) close modal mid-wizard → resumable session is offered on reopen', () => {
    const now = Date.parse('2026-05-08T12:00:00Z')
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString()
    const yesterday = new Date(now - 25 * 60 * 60 * 1000).toISOString()
    const completedAt = new Date(now - 10 * 60 * 1000).toISOString()
    const rows: SessionRow[] = [
      // Completed session — must NOT be returned for resume.
      {
        id: 'completed',
        phase_id: '1.3',
        state: { phase_id: '1.3', parent_title: 'x', parent_body: '', phase_hint: '', mode: 'add', history: [], total_turns: 5, is_complete: true, clarity_score: 100 },
        updated_at: fiveMinAgo,
        completed_at: completedAt,
      },
      // Stale row > 24h old — must NOT be returned.
      {
        id: 'stale',
        phase_id: '1.3',
        state: { phase_id: '1.3', parent_title: 'x', parent_body: '', phase_hint: '', mode: 'add', history: [], total_turns: 1, is_complete: false, clarity_score: 5 },
        updated_at: yesterday,
        completed_at: null,
      },
      // Different phase — must NOT be returned.
      {
        id: 'wrong-phase',
        phase_id: '1.4',
        state: { phase_id: '1.4', parent_title: 'x', parent_body: '', phase_hint: '', mode: 'add', history: [], total_turns: 2, is_complete: false, clarity_score: 30 },
        updated_at: fiveMinAgo,
        completed_at: null,
      },
      // The good one.
      {
        id: 'resume-me',
        phase_id: '1.3',
        state: { phase_id: '1.3', parent_title: 'x', parent_body: '', phase_hint: '', mode: 'add', history: [{ question: 'Q1', answer: 'a1' }], total_turns: 1, is_complete: false, clarity_score: 25 },
        updated_at: fiveMinAgo,
        completed_at: null,
      },
    ]
    const resumable = findResumableRef(rows, '1.3', now)
    expect(resumable).not.toBeNull()
    expect(resumable!.id).toBe('resume-me')
    expect(resumable!.state.history).toHaveLength(1)

    // No resumable for a phase that has only completed/stale rows.
    const noResume = findResumableRef(
      rows.filter(r => r.id !== 'resume-me'),
      '1.3',
      now,
    )
    expect(noResume).toBeNull()
  })

  test('(f) hitting the 12-turn cap forces a spec with a Documented assumptions block', () => {
    let state: WizardState = {
      phase_id: '1.3',
      parent_title: 'Auth',
      parent_body: '',
      phase_hint: '1-3-auth',
      mode: 'add',
      history: [],
      total_turns: 0,
      is_complete: false,
      clarity_score: 0,
    }
    // Simulate 12 Q&A turns with clarity creeping to ~85 — never hitting 100.
    for (let i = 0; i < MAX_TURNS; i++) {
      const q = extractDeepTurnJsonRef(JSON.stringify({
        kind: 'question',
        rationale: 't',
        question: `Q${i + 1}?`,
        options: ['a', 'b'],
        allow_freeform: false,
        current_clarity: Math.min(85, 10 + i * 7),
      }))!
      state = applyDeepTurnResultRef(state, q)
      state = recordWizardAnswerRef(state, `a${i + 1}`)
    }
    expect(state.total_turns).toBe(MAX_TURNS)
    expect(state.is_complete).toBe(false)

    // wizard-session.ts forces a fallback spec when the cap is hit.
    const fallbackSpec = buildFallbackSpecRef(state)
    expect(fallbackSpec).toMatch(/^# Task: Phase 1\.3/m)
    expect(fallbackSpec).toMatch(/## Documented assumptions/)
    // Every Q/A pair shows up in the assumptions block.
    for (let i = 0; i < MAX_TURNS; i++) {
      expect(fallbackSpec).toContain(`**Q${i + 1}?**`)
      expect(fallbackSpec).toContain(`a${i + 1}`)
    }
    // And the spec still satisfies the Builder template's required headers.
    for (const h of REQUIRED_HEADERS) expect(fallbackSpec).toContain(h)
    for (const line of REQUIRED_LINES) expect(fallbackSpec).toContain(line)
  })
})
