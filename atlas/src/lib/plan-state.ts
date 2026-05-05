// Phase A.2 of Pillar A — helper for atlas_plan_node_state.
//
// Wraps the CRUD-ish flows on the plan-state table so the server.ts route
// handlers stay slim and the test surface is one module. Best-effort
// throughout: a missing Supabase client returns {ok:false,reason}; nothing
// here throws to the caller's caller.

import { getSupabaseClient } from './supabase'

export type PlanNodeStateKind =
  | 'voided'
  | 'queued-no-build'
  | 'suggested-by-multi-brain'
  | 'suggested-by-verifier'
  | 'optional'

export interface PlanNodeStateRow {
  id: string
  plan_node_id: string
  state: PlanNodeStateKind
  reason: string | null
  set_by: string | null
  set_at: string
  cleared_at: string | null
  metadata: Record<string, unknown>
}

export interface SetStateInput {
  planNodeId: string
  state: PlanNodeStateKind
  reason?: string
  setBy?: string                           // defaults to 'user'
  metadata?: Record<string, unknown>
}

export interface OpResult {
  ok: boolean
  reason?: string
  rowId?: string
}

/**
 * Insert a state row. Idempotent against the partial UNIQUE: if an active
 * row already exists for (plan_node_id, state), we return ok with that
 * row's id rather than 23505-erroring.
 */
export async function setPlanNodeState(input: SetStateInput): Promise<OpResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'Supabase client not configured' }

  // Check for an existing active row first to keep the API idempotent.
  const { data: existing } = await sb
    .from('atlas_plan_node_state')
    .select('id')
    .eq('plan_node_id', input.planNodeId)
    .eq('state', input.state)
    .is('cleared_at', null)
    .limit(1)
  const found = (existing ?? [])[0] as { id?: string } | undefined
  if (found?.id) return { ok: true, rowId: found.id }

  const { data, error } = await sb
    .from('atlas_plan_node_state')
    .insert({
      plan_node_id: input.planNodeId,
      state: input.state,
      reason: input.reason ?? null,
      set_by: input.setBy ?? 'user',
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, reason: error?.message ?? 'insert returned no row' }
  }
  return { ok: true, rowId: data.id as string }
}

/**
 * Mark the active row for (plan_node_id, state) as cleared_at=now(). If
 * no active row exists, returns ok=true (already cleared / never set).
 */
export async function clearPlanNodeState(
  planNodeId: string,
  state: PlanNodeStateKind,
): Promise<OpResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'Supabase client not configured' }

  const { error } = await sb
    .from('atlas_plan_node_state')
    .update({ cleared_at: new Date().toISOString() })
    .eq('plan_node_id', planNodeId)
    .eq('state', state)
    .is('cleared_at', null)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

/**
 * Fetch all active state rows for a plan node — used by the route handler
 * to return the current state set after a mutation.
 */
export async function getPlanNodeState(planNodeId: string): Promise<PlanNodeStateRow[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_plan_node_state')
    .select('*')
    .eq('plan_node_id', planNodeId)
    .is('cleared_at', null)
    .order('set_at', { ascending: false })
  return (data ?? []) as PlanNodeStateRow[]
}

/**
 * List ALL active state rows (no filter). Used by chat tool plan.list_states
 * to answer "which phases are voided / queued / suggested?" without an id list.
 */
export async function listAllActivePlanNodeStates(): Promise<PlanNodeStateRow[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_plan_node_state')
    .select('*')
    .is('cleared_at', null)
    .order('set_at', { ascending: false })
  return (data ?? []) as PlanNodeStateRow[]
}

/**
 * Bulk fetch — returns a Map<plan_node_id, PlanNodeStateRow[]> for the
 * provided node ids. Used by the Plan tab's GET /atlas/plan endpoint to
 * paint state overlays in a single round-trip.
 */
export async function getPlanNodeStatesBulk(
  planNodeIds: readonly string[],
): Promise<Map<string, PlanNodeStateRow[]>> {
  const out = new Map<string, PlanNodeStateRow[]>()
  if (planNodeIds.length === 0) return out
  const sb = getSupabaseClient()
  if (!sb) return out
  const { data } = await sb
    .from('atlas_plan_node_state')
    .select('*')
    .in('plan_node_id', planNodeIds)
    .is('cleared_at', null)
  for (const row of (data ?? []) as PlanNodeStateRow[]) {
    const arr = out.get(row.plan_node_id) ?? []
    arr.push(row)
    out.set(row.plan_node_id, arr)
  }
  return out
}
