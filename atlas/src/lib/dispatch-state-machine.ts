// 1.10bb-c Session 6 — atlas_dispatches status state machine.
//
// Enforces the legal lifecycle for build-style dispatches:
//
//   queued  → building → done
//   queued  → building → paused   → building → done
//   queued  → building → aborted
//
// Any other transition is a no-op + warning. The state machine sits in front
// of every `UPDATE atlas_dispatches SET status = ?` so legacy code paths can
// migrate piecemeal — call `transitionDispatchStatus` instead of writing
// `status` directly and the validator becomes the single source of truth.
//
// Note on coexistence with legacy statuses: the existing dispatch.ts flow
// uses status='pending' for in-flight chat tool calls and 'success' / 'failed'
// / 'blocked' / 'partial' as terminal states. Those are LEGACY-CHAT statuses
// and are intentionally not part of the build state machine — the validator
// only constrains transitions between {queued, building, paused, done,
// aborted}. Pre-existing rows in legacy statuses pass through untouched.

import { getSupabaseClient } from './supabase'

export type BuildDispatchStatus =
  | 'queued'
  | 'building'
  | 'paused'
  | 'done'
  | 'aborted'

/** All status strings we tolerate seeing in atlas_dispatches.status. */
export type DispatchStatus = BuildDispatchStatus | 'pending' | 'success' | 'failed' | 'blocked' | 'partial' | string

const ALLOWED: Record<BuildDispatchStatus, BuildDispatchStatus[]> = {
  queued: ['building'],
  building: ['paused', 'done', 'aborted'],
  paused: ['building'],
  done: [], // terminal
  aborted: [], // terminal
}

const BUILD_STATUSES: ReadonlySet<BuildDispatchStatus> = new Set<BuildDispatchStatus>([
  'queued', 'building', 'paused', 'done', 'aborted',
])

export function isBuildStatus(status: string): status is BuildDispatchStatus {
  return BUILD_STATUSES.has(status as BuildDispatchStatus)
}

export function isTransitionAllowed(
  from: BuildDispatchStatus,
  to: BuildDispatchStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

export interface TransitionResult {
  ok: boolean
  /** Final status the row ended up in. May differ from `to` when the transition was rejected. */
  finalStatus: BuildDispatchStatus | null
  /** Set when the transition was rejected. */
  warning?: string
  /** Set when the DB write itself failed. */
  error?: string
}

/**
 * Atomic status transition. Reads the current row, validates against the
 * legal-transitions table, and only writes if the transition is allowed.
 *
 * Rejected transitions log a warning to console AND return `ok: false` —
 * the caller decides whether that's a hard error or a no-op. The DB write
 * itself never throws.
 */
export async function transitionDispatchStatus(
  dispatchId: string,
  to: BuildDispatchStatus,
  opts: { extraUpdate?: Record<string, unknown>; reason?: string } = {},
): Promise<TransitionResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, finalStatus: null, error: 'supabase client unavailable' }

  const { data: row, error: readErr } = await sb
    .from('atlas_dispatches')
    .select('id, status')
    .eq('id', dispatchId)
    .maybeSingle()
  if (readErr || !row) {
    return { ok: false, finalStatus: null, error: readErr?.message ?? `dispatch ${dispatchId} not found` }
  }

  const currentStatus = String((row as { status?: string }).status ?? '')
  if (!isBuildStatus(currentStatus)) {
    const warning = `[dispatch-state-machine] refusing transition from non-build status '${currentStatus}' → '${to}' on ${dispatchId}; build state machine only governs {queued,building,paused,done,aborted}.`
    console.warn(warning)
    return { ok: false, finalStatus: null, warning }
  }
  if (!isTransitionAllowed(currentStatus, to)) {
    const warning = `[dispatch-state-machine] illegal transition '${currentStatus}' → '${to}' on dispatch ${dispatchId}${opts.reason ? ` (reason: ${opts.reason})` : ''} — no-op.`
    console.warn(warning)
    return { ok: false, finalStatus: currentStatus, warning }
  }

  // Conditional update: only flip the status if the row is still in the
  // expected `currentStatus`. Concurrent transitions lose the race + return
  // 0 affected rows; the caller sees ok:false + an informative warning.
  const { data: updated, error: writeErr } = await sb
    .from('atlas_dispatches')
    .update({ status: to, ...(opts.extraUpdate ?? {}) })
    .eq('id', dispatchId)
    .eq('status', currentStatus)
    .select('id, status')
    .maybeSingle()
  if (writeErr) {
    return { ok: false, finalStatus: currentStatus, error: writeErr.message }
  }
  if (!updated) {
    const warning = `[dispatch-state-machine] dispatch ${dispatchId} changed under us during '${currentStatus}' → '${to}' — concurrent writer won; no-op.`
    console.warn(warning)
    return { ok: false, finalStatus: null, warning }
  }
  return { ok: true, finalStatus: to }
}
