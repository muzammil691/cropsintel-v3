import { TOOLS, ToolName } from './tools'
import { getSupabaseClient } from './supabase'
import { checkBudget } from './cost-gate'
import { checkInvariants } from './invariants'
import { hasVerifier, verifySideEffect } from './verify-side-effects'
import { roleAtLeast, type Role } from './auth'
import { TrustMode, ToolDispatchVerification } from '../types'

export interface DispatchRequest {
  tool: ToolName
  arguments: Record<string, unknown>
  initiatedBy: string // 'cron' | 'chat:<thread_id>' | 'auto'
  trustMode: TrustMode
  overrideToken?: string
  // Phase 1.10ao — role gate. Service callers (Builder cron, conductor)
  // bypass with role 'owner' so existing in-cluster paths keep working.
  // User-initiated dispatches MUST pass the principal's role.
  callerRole?: Role
}

// Minimum role required to invoke each tool. Read tools default to 'viewer';
// queue-mutating ops require 'operator'; agent-restart / WhatsApp / cancel
// require 'admin'; owner-only mutations are gated outside dispatch (in the
// /atlas/team/* routes). Tools missing from this map default to 'admin'.
export const TOOL_ROLE_REQUIREMENTS: Partial<Record<ToolName, Role>> = {
  // Read-only
  'memory.search': 'viewer',
  'builder.list_queue': 'viewer',
  'builder.list_done': 'viewer',
  'builder.queue_order': 'viewer',
  'verifier.recent_runs': 'viewer',
  'designer.review_spec': 'viewer',
  'designer.audit_commit': 'viewer',
  'status.snapshot': 'viewer',
  // Operator: spec authorship + queue mutation
  'memory.ingest': 'operator',
  'builder.queue_spec': 'operator',
  'builder.set_priority': 'operator',
  'builder.set_dependencies': 'operator',
  'verifier.audit': 'operator',
  'council.write_spec': 'operator',
  // Admin: agent restarts, WhatsApp send, cancellation, Atlas spec authorship
  'adela.trigger_scrape': 'admin',
  'whatsapp.send': 'admin',
  'builder.cancel_task': 'admin',
  'atlas.draft_spec': 'admin',
  'atlas.propose_and_queue': 'admin',
}

export interface DispatchResult {
  dispatchId: string
  status: 'success' | 'failed' | 'blocked' | 'partial'
  result?: unknown
  error?: string
  durationMs: number
  verified?: ToolDispatchVerification | null
}

const READ_ONLY_TOOLS = new Set<ToolName>([
  'memory.search', 'builder.list_queue', 'builder.list_done', 'builder.queue_order', 'verifier.recent_runs', 'status.snapshot',
  'designer.review_spec', 'designer.audit_commit',
  // atlas.draft_spec produces markdown only — no filesystem/git side effects.
  'atlas.draft_spec',
  // atlas.propose_and_queue is mode-aware: it queues only when trust_mode === 'auto'
  // (and only after passing invariants). In chat/passive/confirm it returns a draft
  // and stays passive. We allow it in all non-stopped modes; the tool itself enforces
  // the mode-specific queueing decision.
  'atlas.propose_and_queue',
])

export async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
  const start = Date.now()

  // Role gating (Phase 1.10ao). Service callers (cron, in-cluster Builder)
  // are passed `callerRole: 'owner'` from server.ts; user dispatches carry
  // the principal's role from the session row. If a tool isn't in the map,
  // default to 'admin' — fail closed.
  if (req.callerRole) {
    const required = TOOL_ROLE_REQUIREMENTS[req.tool] ?? 'admin'
    if (!roleAtLeast(req.callerRole, required)) {
      return {
        dispatchId: '',
        status: 'blocked',
        error: `role '${req.callerRole}' insufficient; '${req.tool}' requires '${required}'`,
        durationMs: Date.now() - start,
      }
    }
  }

  // Trust mode gating (no DB needed for blocks)
  if (req.trustMode === 'stopped') {
    return { dispatchId: '', status: 'blocked', error: 'Atlas is in stopped mode; no dispatches allowed.', durationMs: 0 }
  }
  if (req.trustMode === 'passive' && !READ_ONLY_TOOLS.has(req.tool)) {
    return { dispatchId: '', status: 'blocked', error: `Atlas is in passive mode; tool '${req.tool}' is write-capable and not allowed.`, durationMs: 0 }
  }
  if (req.trustMode === 'chat' && !READ_ONLY_TOOLS.has(req.tool)) {
    return { dispatchId: '', status: 'blocked', error: `Atlas is in chat mode; tool '${req.tool}' is write-capable. Switch to confirm/auto.`, durationMs: 0 }
  }
  // 'confirm' mode: caller is expected to have already obtained user consent before calling dispatch()
  // 'auto' mode: cost gatekeeper applies
  const AI_COST_ESTIMATES: Partial<Record<ToolName, number>> = {
    'council.write_spec':    0.10,
    'memory.search':         0.001,
    'memory.ingest':         0.001,
    'adela.trigger_scrape':  0.001,
    'designer.audit_commit': 0.05,
    'designer.review_spec':  0.05,
    // atlas.draft_spec = Council ($0.10) + multi-brain debate ($0.20) ≈ $0.30
    'atlas.draft_spec':       0.35,
    // atlas.propose_and_queue = draft pipeline + invariant check + (auto) queue
    'atlas.propose_and_queue': 0.40,
  }
  const estimatedCost = AI_COST_ESTIMATES[req.tool] ?? 0
  if (estimatedCost > 0) {
    const overrideToken = req.overrideToken
    const budgetCheck = await checkBudget(estimatedCost, { overrideToken })
    if (!budgetCheck.allow) {
      return {
        dispatchId: '', status: 'blocked',
        error: `Budget gate: ${budgetCheck.reason ?? budgetCheck.status}`,
        durationMs: Date.now() - start,
      }
    }
  }

  const sb = getSupabaseClient()
  if (!sb) {
    return { dispatchId: '', status: 'failed', error: 'Supabase client not configured', durationMs: Date.now() - start }
  }

  // Insert pending row
  const { data: pendingRow, error: insertErr } = await sb.from('atlas_dispatches').insert({
    trust_mode: req.trustMode,
    initiated_by: req.initiatedBy,
    tool: req.tool,
    arguments: req.arguments,
    status: 'pending',
  }).select('id').single()

  if (insertErr || !pendingRow) {
    return { dispatchId: '', status: 'failed', error: `dispatch log insert failed: ${insertErr?.message ?? 'unknown'}`, durationMs: 0 }
  }

  const dispatchId = pendingRow.id as string

  // Master plan invariants check — runs before any write-tool execution
  const invariantCheck = await checkInvariants(req)
  if (!invariantCheck.allow) {
    const violationSummary = invariantCheck.violations.map(v => `[${v.rule_id}] ${v.description}`).join('; ')
    await Promise.all([
      sb.from('atlas_dispatches').update({ status: 'blocked', error_message: `Invariant violation: ${violationSummary}`, duration_ms: Date.now() - start }).eq('id', dispatchId),
      sb.from('atlas_decisions').insert({
        fork_question: `Invariant check on ${req.tool}`,
        options_considered: { proposed: req.arguments },
        chosen_option: 'BLOCKED',
        rationale: violationSummary,
        decided_by: 'atlas-auto',
      }),
    ]).catch(() => { /* non-fatal: log best-effort */ })
    return {
      dispatchId,
      status: 'blocked',
      error: `Master plan invariants violated: ${invariantCheck.violations.map(v => v.description).join('; ')}`,
      durationMs: Date.now() - start,
    }
  }

  // Execute the tool
  const toolEntry = (TOOLS as Record<string, { fn: (...a: unknown[]) => Promise<unknown>; description: string } | undefined>)[req.tool]
  if (!toolEntry) {
    await sb.from('atlas_dispatches').update({ status: 'failed', error_message: `unknown tool: ${req.tool}`, duration_ms: Date.now() - start }).eq('id', dispatchId)
    return { dispatchId, status: 'failed', error: `unknown tool: ${req.tool}`, durationMs: Date.now() - start }
  }

  const initiatedAt = new Date(start)
  try {
    const args = Object.values(req.arguments)
    const result = await toolEntry.fn(...args)
    const duration = Date.now() - start

    // Post-condition verification — for write tools, confirm the side effect actually landed.
    let verified: ToolDispatchVerification | null = null
    if (hasVerifier(req.tool)) {
      verified = await verifySideEffect({
        tool: req.tool,
        arguments: req.arguments,
        result,
        initiatedAt,
      })
    }

    const verificationFailed = verified !== null && verified.verified === false
    const finalStatus: 'success' | 'partial' = verificationFailed ? 'partial' : 'success'

    await sb.from('atlas_dispatches').update({
      status: finalStatus,
      result,
      duration_ms: duration,
      verified_at: verified ? new Date().toISOString() : null,
      verified_evidence: verified ? { verified: verified.verified, evidence: verified.evidence, error: verified.error ?? null } : null,
    }).eq('id', dispatchId)

    // If verification failed, surface that into the result so the LLM is forced to disclose it (honesty rule 5).
    const llmFacingResult = verificationFailed
      ? { ...(result as object | null), verification_failed: true, evidence_collected: verified?.evidence ?? {}, verification_error: verified?.error ?? null }
      : result

    return {
      dispatchId,
      status: finalStatus,
      result: llmFacingResult,
      durationMs: duration,
      verified,
    }
  } catch (err) {
    const duration = Date.now() - start
    const errorMsg = err instanceof Error ? err.message : String(err)
    await sb.from('atlas_dispatches').update({ status: 'failed', error_message: errorMsg, duration_ms: duration }).eq('id', dispatchId)
    return { dispatchId, status: 'failed', error: errorMsg, durationMs: duration }
  }
}
