// Phase C.1 — Workshop → WhatsApp outbound broadcaster.
//
// Pings the session owner on WhatsApp when a new unanswered question turn
// appears in a workshop. Heartbeat-polled (β trigger, not Postgres realtime)
// from the conductor's 30s sub-tick. Idempotent via the column
// plan_workshop_sessions.last_whatsapp_ping_at — only re-sends when a
// strictly newer turn has been proposed since the last ping.
//
// Architecture:
//   • evaluateSession()           — pure function. Takes a session row,
//                                   returns a send-or-skip decision. No I/O.
//                                   Fully unit-testable.
//   • tickWorkshopBroadcaster()   — I/O wrapper. Queries candidates, calls
//                                   evaluateSession, fires Twilio, stamps
//                                   the idempotency column, writes audit.
//   • getBroadcasterObservability — read-only slot snapshot for /health.
//
// Scope:
//   • Outbound only. Inbound numeric-reply routing is Phase C.2.
//   • One-user mode: the session's created_by → atlas_members.phone is the
//     destination. Missing phone → skip with a debug log, never throw.
//   • Twilio failure → no column update → retried next tick.
//
// Independent revertability: a single git revert on this file + the
// conductor sub-tick wiring + the /health block leaves the cockpit chat,
// workshop engine, approval router, and verifier-dialog untouched.

import { getSupabaseClient } from './supabase'
import { sendWhatsAppReplyAutoSplit } from './twilio'
import type { SessionStateMetadata, WorkshopTurnRecord } from './workshop-engine'

export const WORKSHOP_BROADCASTER_INTERVAL_MS = parseInt(
  process.env.ATLAS_WORKSHOP_BROADCASTER_MS ?? '30000',
  10,
)

// Mirrors the cockpit's READY_THRESHOLD in PlanWorkshop.tsx. Keeping a
// duplicated literal rather than cross-package import — the cockpit constant
// shouldn't change without a coordinated server-side update anyway.
export const READY_THRESHOLD = 0.9

// Sentinel question text that workshop-engine emits when proposeNextTurn
// decides confidence is high enough to skip another question and signal
// "ready to draft." See workshop-engine.ts:684 for the source.
const READY_SENTINEL = '[ready signal — see rationale]'

// ─── Observability slots (read by /health, mirrors conductor_state pattern) ─

let lastTickAt: Date | null = null
let lastPingSentAt: Date | null = null
let sessionsPingedTotal = 0

export interface WorkshopBroadcasterObservability {
  last_tick_at: string | null
  last_ping_sent_at: string | null
  sessions_pinged_total: number
  interval_ms: number
}

export function getBroadcasterObservability(): WorkshopBroadcasterObservability {
  return {
    last_tick_at: lastTickAt ? lastTickAt.toISOString() : null,
    last_ping_sent_at: lastPingSentAt ? lastPingSentAt.toISOString() : null,
    sessions_pinged_total: sessionsPingedTotal,
    interval_ms: WORKSHOP_BROADCASTER_INTERVAL_MS,
  }
}

// Test-only reset. Lets vitest start each case from a known zero state.
export function __resetBroadcasterObservabilityForTests(): void {
  lastTickAt = null
  lastPingSentAt = null
  sessionsPingedTotal = 0
}

// ─── Pure-function decision core ──────────────────────────────────────────

export type BroadcasterDecision =
  | {
      kind: 'send'
      messageBody: string
      turnIndex: number
      turnProposedAt: string
      finalizeCue: boolean
    }
  | { kind: 'skip'; reason: 'no_turns' | 'all_answered' | 'already_pinged' }

export interface EvaluateSessionInput {
  sessionId: string
  workshopState: SessionStateMetadata | null
  lastWhatsappPingAt: string | null
}

/**
 * Pure: given a workshop session's state + last-ping timestamp, decide
 * whether to send a WhatsApp ping and what the message should look like.
 *
 * Send criteria (all must hold):
 *   1. workshop_state.turns has at least one entry
 *   2. The newest turn has answer === null (unanswered)
 *   3. last_whatsapp_ping_at is null OR strictly older than that turn's
 *      proposed_at (so a re-ping after the same question never fires)
 */
export function evaluateSession(input: EvaluateSessionInput): BroadcasterDecision {
  const turns = input.workshopState?.turns ?? []
  if (turns.length === 0) return { kind: 'skip', reason: 'no_turns' }

  const newest = turns[turns.length - 1]
  if (newest.answer !== null) return { kind: 'skip', reason: 'all_answered' }

  if (input.lastWhatsappPingAt && input.lastWhatsappPingAt >= newest.proposed_at) {
    return { kind: 'skip', reason: 'already_pinged' }
  }

  const lastConfidence = input.workshopState?.last_confidence ?? 0
  const isReadySentinel = newest.question === READY_SENTINEL
  const finalizeCue = isReadySentinel && lastConfidence >= READY_THRESHOLD

  return {
    kind: 'send',
    messageBody: composeMessage({
      sessionId: input.sessionId,
      turn: newest,
      finalizeCue,
      lastConfidence,
    }),
    turnIndex: newest.index,
    turnProposedAt: newest.proposed_at,
    finalizeCue,
  }
}

interface ComposeInput {
  sessionId: string
  turn: WorkshopTurnRecord
  finalizeCue: boolean
  lastConfidence: number
}

function composeMessage(input: ComposeInput): string {
  const header = `📋 Workshop: ${input.sessionId.slice(0, 8)}`
  const lines: string[] = [header, '']

  if (input.finalizeCue) {
    // Skip the awkward sentinel question text; emit the finalize cue as the
    // body. last_confidence is in 0..1 — render as "Confidence at 0.92".
    lines.push(`⚡ Confidence at ${input.lastConfidence.toFixed(2)}. Ready to draft the diff.`)
  } else {
    lines.push(input.turn.question)
    const options = input.turn.options ?? []
    if (options.length > 0) {
      lines.push('')
      options.forEach((opt, i) => lines.push(`${i + 1}. ${opt}`))
    }
  }

  lines.push('')
  lines.push('Reply in cockpit, or wait for C.2 to enable phone replies.')
  return lines.join('\n')
}

// ─── I/O wrapper ──────────────────────────────────────────────────────────

export interface TickResult {
  candidates: number
  sent: number
  skipped: number
  failed: number
}

interface CandidateRow {
  id: string
  created_by: string | null
  status: string
  metadata: { workshop_state?: SessionStateMetadata } | null
  last_whatsapp_ping_at: string | null
}

interface MemberPhoneRow {
  id: string
  phone: string | null
}

function redactPhone(phone: string): string {
  if (phone.length <= 4) return '+****'
  return '+****' + phone.slice(-4)
}

/**
 * Single tick of the broadcaster loop. Called every WORKSHOP_BROADCASTER_INTERVAL_MS
 * from the conductor sub-tick. Returns aggregate counts for log/observability.
 *
 * Re-entrancy: callers are responsible for guarding (the conductor uses a
 * `tickInProgress` flag so overlapping ticks skip). This function does its
 * own DB queries each call — no shared state between ticks.
 */
export async function tickWorkshopBroadcaster(): Promise<TickResult> {
  lastTickAt = new Date()
  const sb = getSupabaseClient()
  const empty: TickResult = { candidates: 0, sent: 0, skipped: 0, failed: 0 }
  if (!sb) return empty

  // Candidates: active (still asking questions) or awaiting_approval (the
  // ready-sentinel turn lives here when ready_signaled triggers before the
  // user finalizes). Exclude archived. status='completed'/'abandoned' don't
  // produce new turns, so no point scanning them.
  const { data: sessions, error: sessionsErr } = await sb
    .from('plan_workshop_sessions')
    .select('id, created_by, status, metadata, last_whatsapp_ping_at, archived_at')
    .in('status', ['active', 'awaiting_approval'])
    .is('archived_at', null)
    .order('started_at', { ascending: false })
    .limit(50)
  if (sessionsErr || !sessions) return empty
  const candidates = sessions as unknown as CandidateRow[]

  // Batch-fetch the phones for all created_by member ids in one query.
  const memberIds = Array.from(
    new Set(
      candidates
        .map((s) => s.created_by)
        .filter((x): x is string => typeof x === 'string' && x.length > 0),
    ),
  )
  const phoneByMember = new Map<string, string | null>()
  if (memberIds.length > 0) {
    const { data: members } = await sb
      .from('atlas_members')
      .select('id, phone')
      .in('id', memberIds)
    for (const m of (members ?? []) as MemberPhoneRow[]) {
      phoneByMember.set(m.id, m.phone ?? null)
    }
  }

  const result: TickResult = { candidates: candidates.length, sent: 0, skipped: 0, failed: 0 }
  for (const session of candidates) {
    const decision = evaluateSession({
      sessionId: session.id,
      workshopState: session.metadata?.workshop_state ?? null,
      lastWhatsappPingAt: session.last_whatsapp_ping_at,
    })

    if (decision.kind === 'skip') {
      result.skipped++
      console.debug(
        `[workshop-broadcaster] skip session=${session.id.slice(0, 8)} reason=${decision.reason}`,
      )
      continue
    }

    // Resolve phone. Missing phone is a soft skip (warn, never throw).
    const phone = session.created_by ? (phoneByMember.get(session.created_by) ?? null) : null
    if (!phone) {
      result.skipped++
      console.warn(
        `[workshop-broadcaster] skip session=${session.id.slice(0, 8)} reason=no_phone created_by=${session.created_by ?? 'null'}`,
      )
      continue
    }

    // Fire Twilio. Auto-split because workshop questions can exceed the
    // 1600-char single-message cap when options are verbose.
    let sendErrors: string[] = []
    try {
      const sendResult = await sendWhatsAppReplyAutoSplit(phone, decision.messageBody)
      sendErrors = sendResult.errors
      if (sendResult.sids.length === 0 && sendErrors.length > 0) {
        throw new Error(sendErrors.join('; '))
      }
    } catch (err) {
      result.failed++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[workshop-broadcaster] twilio failed session=${session.id.slice(0, 8)} err=${msg}`,
      )
      try {
        await sb.from('agent_audit_log').insert({
          agent_name: 'atlas',
          action_type: 'workshop_whatsapp_broadcast_failed',
          payload: {
            session_id: session.id,
            turn_index: decision.turnIndex,
            phone_redacted: redactPhone(phone),
            error: msg,
          },
          status: 'error',
        })
      } catch { /* observability only */ }
      // No column update → retried next tick.
      continue
    }

    // Send succeeded. Stamp the idempotency column.
    const stampIso = new Date().toISOString()
    const { error: updateErr } = await sb
      .from('plan_workshop_sessions')
      .update({ last_whatsapp_ping_at: stampIso })
      .eq('id', session.id)
    if (updateErr) {
      // The send already left Twilio; the user got the message. We can't
      // reverse that. Without the stamp the next tick will re-send (annoying
      // but not destructive). Surface in audit so the operator can reconcile.
      console.error(
        `[workshop-broadcaster] sent but stamp failed session=${session.id.slice(0, 8)} err=${updateErr.message}`,
      )
      try {
        await sb.from('agent_audit_log').insert({
          agent_name: 'atlas',
          action_type: 'workshop_whatsapp_broadcast_stamp_failed',
          payload: {
            session_id: session.id,
            turn_index: decision.turnIndex,
            phone_redacted: redactPhone(phone),
            error: updateErr.message,
          },
          status: 'error',
        })
      } catch { /* observability only */ }
      // Count as sent — message went out — but flag the failure separately.
      result.sent++
      result.failed++
      continue
    }

    // Full success path. Bump observability + audit.
    result.sent++
    lastPingSentAt = new Date()
    sessionsPingedTotal++
    try {
      await sb.from('agent_audit_log').insert({
        agent_name: 'atlas',
        action_type: 'workshop_whatsapp_broadcast',
        payload: {
          session_id: session.id,
          turn_index: decision.turnIndex,
          turn_proposed_at: decision.turnProposedAt,
          finalize_cue: decision.finalizeCue,
          phone_redacted: redactPhone(phone),
        },
        status: 'success',
      })
    } catch { /* observability only */ }
  }
  return result
}
