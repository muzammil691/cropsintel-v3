// Phase 1.10aj — unified approval router for cockpit phase approvals.
//
// Three input channels, one canonical persisted record:
//   - dashboard panel button → POST /atlas/plan/approve {via:'panel'}
//   - chat keyword match    → handler calls routeApproval({via:'chat', ...})
//   - WhatsApp inbound     → twilio webhook calls routeApproval({via:'whatsapp', ...})
//
// All routes converge on cockpit_phase_approvals + agent_audit_log. The
// build-runner's advancePerPhaseQueue() reads the latest approval row to
// decide whether to queue the next phase.

import { getSupabaseClient } from './supabase'
import { advancePerPhaseQueue } from './build-runner'

export type ApprovalVia = 'panel' | 'chat' | 'whatsapp'
export type ApprovalDecision = 'approve' | 'skip' | 'pause' | 'modify'

export interface RouteApprovalInput {
  phaseId: string
  via: ApprovalVia
  approvedBy?: string                            // phone or member id
  decision?: ApprovalDecision                    // defaults to 'approve'
  rawMessage?: string                            // chat / WhatsApp text — for audit
}

export interface RouteApprovalResult {
  ok: boolean
  recorded: boolean
  advanced: boolean
  advancedTo?: string                            // filename of next queued spec
  reason?: string
}

const APPROVE_KEYWORDS = ['yes', 'approve', 'proceed', 'ok', 'go']
const SKIP_KEYWORDS = ['skip', 'no', 'cancel']
const PAUSE_KEYWORDS = ['pause', 'wait', 'hold']
const MODIFY_KEYWORDS = ['modify', 'edit', 'change']

/**
 * Parse a chat/WhatsApp keyword into a decision. Case-insensitive, trims
 * surrounding whitespace and punctuation. Returns null if no keyword
 * matches — caller can decide whether to ignore or escalate.
 */
export function parseKeywordDecision(text: string): ApprovalDecision | null {
  const norm = text.trim().toLowerCase().replace(/[!.,;:]+$/, '')
  if (APPROVE_KEYWORDS.includes(norm)) return 'approve'
  if (SKIP_KEYWORDS.includes(norm)) return 'skip'
  if (PAUSE_KEYWORDS.includes(norm)) return 'pause'
  if (MODIFY_KEYWORDS.includes(norm)) return 'modify'
  // Multi-word — accept first matching token only when message starts with it.
  const first = norm.split(/\s+/)[0]
  if (APPROVE_KEYWORDS.includes(first)) return 'approve'
  if (SKIP_KEYWORDS.includes(first)) return 'skip'
  if (PAUSE_KEYWORDS.includes(first)) return 'pause'
  if (MODIFY_KEYWORDS.includes(first)) return 'modify'
  return null
}

/**
 * Validate that a WhatsApp sender's phone is the configured admin. Returns
 * true when MUZAMMIL_WHATSAPP env var matches (or when the env var isn't
 * set, returns false to fail closed).
 */
export function isApprovedWhatsAppSender(phone: string): boolean {
  const admin = process.env.MUZAMMIL_WHATSAPP
  if (!admin) return false
  const norm = (s: string) => s.replace(/[^\d+]/g, '')
  return norm(admin) === norm(phone)
}

/**
 * Persist the approval and (when decision='approve') advance the per-phase
 * queue. Returns recorded=false if the Supabase client isn't configured —
 * caller can decide whether to surface a 503.
 */
export async function routeApproval(input: RouteApprovalInput): Promise<RouteApprovalResult> {
  const decision: ApprovalDecision = input.decision ?? 'approve'
  const sb = getSupabaseClient()
  let recorded = false
  if (sb) {
    try {
      await sb.from('cockpit_phase_approvals').insert({
        phase_id: input.phaseId,
        approved_via: input.via,
        approved_by: input.approvedBy ?? null,
        decision,
        metadata: {
          raw_message: input.rawMessage ?? null,
        },
      })
      recorded = true
    } catch (err) {
      console.warn('[approval-router] cockpit_phase_approvals insert failed:', err instanceof Error ? err.message : err)
    }
    try {
      await sb.from('agent_audit_log').insert({
        agent_name: 'cockpit',
        action_type: 'phase_approval',
        payload: {
          phase_id: input.phaseId,
          approved_via: input.via,
          decision,
          approved_by: input.approvedBy ?? null,
          raw_message: input.rawMessage ?? null,
        },
        status: 'success',
      })
    } catch (err) {
      console.warn('[approval-router] agent_audit_log insert failed:', err instanceof Error ? err.message : err)
    }
  }

  if (decision !== 'approve') {
    return { ok: true, recorded, advanced: false }
  }

  let advancedFilename: string | undefined
  let advanced = false
  try {
    const adv = await advancePerPhaseQueue()
    advanced = adv.advanced
    advancedFilename = adv.filename
  } catch (err) {
    console.warn('[approval-router] advancePerPhaseQueue failed:', err instanceof Error ? err.message : err)
  }

  return { ok: true, recorded, advanced, advancedTo: advancedFilename }
}

export const __test_only__ = { APPROVE_KEYWORDS, SKIP_KEYWORDS, PAUSE_KEYWORDS, MODIFY_KEYWORDS }
