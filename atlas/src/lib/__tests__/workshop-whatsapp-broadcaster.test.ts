// Phase C.1 — Workshop→WhatsApp broadcaster tests.
//
// Pure-function tests for evaluateSession() — no DB or Twilio mocks needed.
// I/O wrapper (tickWorkshopBroadcaster) is left for the integration smoke in
// production; here we lock the decision logic + message composition, which
// is where the regressions actually live.

import { describe, it, expect } from 'vitest'
import { evaluateSession, READY_THRESHOLD } from '../workshop-whatsapp-broadcaster'
import type { SessionStateMetadata, WorkshopTurnRecord } from '../workshop-engine'

const FIXED_SESSION_ID = '1234abcd-5678-90ef-1234-567890abcdef'

function turn(overrides: Partial<WorkshopTurnRecord> = {}): WorkshopTurnRecord {
  return {
    index: 1,
    question: 'What launch tier are you targeting?',
    options: ['v1.0-alpha', 'v1.0-beta', 'v1.0-stable'],
    answer: null,
    cited_sources: [],
    model_cost_usd: 0.01,
    confidence_at_propose: 0.4,
    proposed_at: '2026-05-22T13:00:00.000Z',
    answered_at: null,
    ...overrides,
  }
}

function state(turns: WorkshopTurnRecord[], confidence = 0.4, readySignaled = false): SessionStateMetadata {
  return {
    turns,
    prompt: 'test prompt',
    last_confidence: confidence,
    ready_signaled: readySignaled,
  }
}

describe('evaluateSession (pure)', () => {
  it('skips when workshop_state is null (fresh row, no metadata yet)', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: null,
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('no_turns')
  })

  it('skips when turns array is empty', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([]),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('no_turns')
  })

  it('skips when the newest turn already has an answer (all_answered)', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([turn({ answer: 'v1.0-alpha', answered_at: '2026-05-22T13:05:00.000Z' })]),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('all_answered')
  })

  it('SENDS when an unanswered turn exists and no ping has fired yet', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([turn()]),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('send')
    if (d.kind === 'send') {
      expect(d.turnIndex).toBe(1)
      expect(d.turnProposedAt).toBe('2026-05-22T13:00:00.000Z')
      expect(d.finalizeCue).toBe(false)
      expect(d.messageBody).toContain('📋 Workshop:')
      expect(d.messageBody).toContain('What launch tier are you targeting?')
      expect(d.messageBody).toContain('1. v1.0-alpha')
      expect(d.messageBody).toContain('2. v1.0-beta')
      expect(d.messageBody).toContain('3. v1.0-stable')
      expect(d.messageBody).toContain('Reply in cockpit, or wait for C.2')
    }
  })

  it('skips when last_whatsapp_ping_at is newer than the turn (already_pinged)', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([turn({ proposed_at: '2026-05-22T13:00:00.000Z' })]),
      lastWhatsappPingAt: '2026-05-22T13:00:01.000Z',
    })
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('already_pinged')
  })

  it('skips when last_whatsapp_ping_at equals the turn timestamp (boundary; same ping)', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([turn({ proposed_at: '2026-05-22T13:00:00.000Z' })]),
      lastWhatsappPingAt: '2026-05-22T13:00:00.000Z',
    })
    expect(d.kind).toBe('skip')
    if (d.kind === 'skip') expect(d.reason).toBe('already_pinged')
  })

  it('SENDS again when a NEW turn arrives after a previous ping', () => {
    // Turn 1 was pinged. Turn 2 just arrived with a later proposed_at.
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([
        turn({ index: 1, answer: 'v1.0-alpha', answered_at: '2026-05-22T13:02:00.000Z', proposed_at: '2026-05-22T13:00:00.000Z' }),
        turn({ index: 2, question: 'Which workflow style?', options: ['CLI', 'GUI'], proposed_at: '2026-05-22T13:05:00.000Z' }),
      ]),
      lastWhatsappPingAt: '2026-05-22T13:00:30.000Z', // earlier than turn 2
    })
    expect(d.kind).toBe('send')
    if (d.kind === 'send') {
      expect(d.turnIndex).toBe(2)
      expect(d.messageBody).toContain('Which workflow style?')
      expect(d.messageBody).toContain('1. CLI')
      expect(d.messageBody).toContain('2. GUI')
    }
  })

  it('emits finalize cue when newest turn is the ready sentinel AND confidence >= threshold', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state(
        [turn({
          index: 5,
          question: '[ready signal — see rationale]',
          options: undefined,
          confidence_at_propose: 0.92,
          proposed_at: '2026-05-22T13:20:00.000Z',
        })],
        0.92,
        true,
      ),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('send')
    if (d.kind === 'send') {
      expect(d.finalizeCue).toBe(true)
      expect(d.messageBody).toContain('⚡ Confidence at 0.92')
      expect(d.messageBody).toContain('Ready to draft the diff.')
      // The awkward sentinel question text should NOT appear in the user-visible body.
      expect(d.messageBody).not.toContain('[ready signal — see rationale]')
      expect(d.messageBody).toContain('Reply in cockpit, or wait for C.2')
    }
  })

  it('does NOT emit finalize cue when sentinel matches but confidence is below threshold', () => {
    // Edge: ready_signaled could flip true even with confidence below the
    // cockpit threshold in some race orderings. The cue should still gate on
    // last_confidence >= READY_THRESHOLD per the locked spec.
    const justBelow = READY_THRESHOLD - 0.01
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state(
        [turn({
          question: '[ready signal — see rationale]',
          options: undefined,
          confidence_at_propose: justBelow,
        })],
        justBelow,
        true,
      ),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('send')
    if (d.kind === 'send') {
      expect(d.finalizeCue).toBe(false)
      // Falls through to the normal-question branch — sentinel text shows.
      // This is intentional fallout; in practice if you see this, workshop-
      // engine emitted a ready signal with sub-threshold confidence, which
      // is a workshop-engine bug, not a broadcaster bug.
      expect(d.messageBody).toContain('[ready signal — see rationale]')
    }
  })

  it('handles question turns with no options gracefully (no empty numbered list)', () => {
    const d = evaluateSession({
      sessionId: FIXED_SESSION_ID,
      workshopState: state([turn({ options: undefined, question: 'Free-text follow-up?' })]),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('send')
    if (d.kind === 'send') {
      expect(d.messageBody).toContain('Free-text follow-up?')
      expect(d.messageBody).not.toMatch(/^\d+\. /m)
      // Still includes the C.2 footer.
      expect(d.messageBody).toContain('Reply in cockpit, or wait for C.2')
    }
  })

  it('header uses 8-char session id prefix', () => {
    const d = evaluateSession({
      sessionId: 'abc12345-deadbeef-0000-0000-000000000000',
      workshopState: state([turn()]),
      lastWhatsappPingAt: null,
    })
    expect(d.kind).toBe('send')
    if (d.kind === 'send') {
      expect(d.messageBody).toContain('📋 Workshop: abc12345')
    }
  })
})
