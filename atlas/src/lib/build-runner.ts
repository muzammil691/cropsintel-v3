// Phase 1.10aj — Build runner.
//
// Orchestrates the queued phase sequence with approval gates. The cockpit
// Build button triggers a pre-flight check (dependency closure, topological
// sort), shows a confirmation modal, then either:
//   - "Approve all" → all specs queue at once; the Atlas conductor handles
//     gate: dependencies in dependency order.
//   - "Per phase" → only the first phase queues; each subsequent phase waits
//     on a pending approval (panel / chat / WhatsApp).
//
// We don't actually run Builder here — we sequence Builder-spec writes and
// state transitions on plan_node_state. The conductor + Builder pick them
// up via the existing queued/ → in-progress/ → done/ pipeline.

import { setPlanNodeState, listAllActivePlanNodeStates, getPlanNodeStatesBulk } from './plan-state'
import { queueSpecFromPlanNode } from './plan-server'

export interface BuildRunnerNode {
  planNodeId: string
  title: string
  body: string
  phaseHint: string
  /**
   * Optional dependency list — IDs of other plan nodes this depends on. If
   * missing, the runner uses tree position as a tie-breaker.
   */
  dependsOn?: string[]
}

export interface PreflightResult {
  totalNodes: number
  ordered: BuildRunnerNode[]
  warnings: string[]
  estimatedSpecs: number
  estimatedMinutes: number
}

/**
 * Topologically sort the followed nodes by dependency. Nodes with missing
 * dependencies (deps that are not also followed) generate a warning.
 *
 * Idempotent and pure — does not write anything to disk.
 */
export function preflight(nodes: BuildRunnerNode[]): PreflightResult {
  const warnings: string[] = []
  const idSet = new Set(nodes.map(n => n.planNodeId))
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!idSet.has(dep)) {
        warnings.push(`${n.title} depends on ${dep} which is not in the build set.`)
      }
    }
  }

  // Kahn's algorithm — nodes whose deps are satisfied first; deterministic
  // tie-break on insertion order to keep behavior stable.
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
  const ready: BuildRunnerNode[] = nodes.filter(n => (inDegree.get(n.planNodeId) ?? 0) === 0)
  const order: BuildRunnerNode[] = []
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
  if (order.length !== nodes.length) {
    warnings.push(`Cycle detected — ${nodes.length - order.length} nodes could not be ordered. Falling back to insertion order.`)
    const placed = new Set(order.map(o => o.planNodeId))
    for (const n of nodes) {
      if (!placed.has(n.planNodeId)) order.push(n)
    }
  }

  return {
    totalNodes: nodes.length,
    ordered: order,
    warnings,
    estimatedSpecs: order.length,
    estimatedMinutes: order.length * 25,
  }
}

export type BuildMode = 'approve-all' | 'per-phase'

export interface RunBuildResult {
  ok: boolean
  queued: Array<{ planNodeId: string; filename: string; sha?: string; pushed?: boolean }>
  pending: Array<{ planNodeId: string; title: string }>
  reason?: string
}

/**
 * Execute the build runner over a pre-flighted node list.
 *
 * - approve-all: queues every spec immediately. Atlas conductor sorts on
 *   gate: front matter as it picks them up.
 * - per-phase: queues the first node and marks the rest pending (state set
 *   on plan_node_state with `awaiting_approval` metadata). Each approval
 *   then triggers the next queue.
 */
export async function runBuild(
  ordered: BuildRunnerNode[],
  mode: BuildMode,
): Promise<RunBuildResult> {
  if (ordered.length === 0) {
    return { ok: false, queued: [], pending: [], reason: 'no_nodes' }
  }

  const queued: Array<{ planNodeId: string; filename: string; sha?: string; pushed?: boolean }> = []
  const pending: Array<{ planNodeId: string; title: string }> = []

  if (mode === 'approve-all') {
    for (const node of ordered) {
      try {
        const r = await queueSpecFromPlanNode(node.title, node.body, node.phaseHint)
        await setPlanNodeState({
          planNodeId: node.planNodeId,
          state: 'queued-no-build',
          setBy: 'cockpit-build-runner',
          metadata: { spec_filename: r.filename, run_mode: 'approve-all' },
        })
        queued.push({ planNodeId: node.planNodeId, filename: r.filename, sha: r.sha, pushed: r.pushed })
      } catch (err) {
        return {
          ok: false,
          queued,
          pending,
          reason: `failed at ${node.title}: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }
    return { ok: true, queued, pending }
  }

  // per-phase: first node queues immediately; rest mark pending.
  const [first, ...rest] = ordered
  try {
    const r = await queueSpecFromPlanNode(first.title, first.body, first.phaseHint)
    await setPlanNodeState({
      planNodeId: first.planNodeId,
      state: 'queued-no-build',
      setBy: 'cockpit-build-runner',
      metadata: { spec_filename: r.filename, run_mode: 'per-phase', awaiting_approval: false },
    })
    queued.push({ planNodeId: first.planNodeId, filename: r.filename, sha: r.sha, pushed: r.pushed })
  } catch (err) {
    return {
      ok: false,
      queued,
      pending,
      reason: `failed at ${first.title}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  for (const node of rest) {
    await setPlanNodeState({
      planNodeId: node.planNodeId,
      state: 'optional',                       // reuse the existing CHECK enum
      setBy: 'cockpit-build-runner',
      metadata: {
        run_mode: 'per-phase',
        awaiting_approval: true,
        title: node.title,
        body_excerpt: (node.body ?? '').slice(0, 200),
      },
    })
    pending.push({ planNodeId: node.planNodeId, title: node.title })
  }

  return { ok: true, queued, pending }
}

/**
 * Helper: enumerate followed nodes from current plan_node_state. The cockpit
 * UI passes the actual node objects to runBuild() — this is a server-side
 * cross-check.
 */
export async function getFollowedNodeIds(): Promise<string[]> {
  const rows = await listAllActivePlanNodeStates()
  const out: string[] = []
  for (const r of rows) {
    if (r.state === 'queued-no-build' && (r.metadata as Record<string, unknown> | null)?.follow === true) {
      out.push(r.plan_node_id)
    }
  }
  return out
}

/**
 * After a phase ships (Verifier + Designer pass), the conductor calls this
 * to advance the per-phase queue: pick the next node carrying
 * awaiting_approval=true and queue its spec.
 */
export async function advancePerPhaseQueue(): Promise<{
  advanced: boolean
  planNodeId?: string
  filename?: string
}> {
  const rows = await listAllActivePlanNodeStates()
  for (const row of rows) {
    const meta = row.metadata as Record<string, unknown> | null
    if (!meta) continue
    if (meta.run_mode !== 'per-phase' || meta.awaiting_approval !== true) continue
    const title = String(meta.title ?? 'unnamed phase')
    const bodyExcerpt = String(meta.body_excerpt ?? '')
    try {
      const r = await queueSpecFromPlanNode(title, bodyExcerpt, 'plan')
      await setPlanNodeState({
        planNodeId: row.plan_node_id,
        state: 'queued-no-build',
        setBy: 'cockpit-build-runner',
        metadata: { spec_filename: r.filename, run_mode: 'per-phase', awaiting_approval: false },
      })
      return { advanced: true, planNodeId: row.plan_node_id, filename: r.filename }
    } catch (err) {
      console.warn('[build-runner] advancePerPhaseQueue queue failed:', err instanceof Error ? err.message : err)
      continue
    }
  }
  return { advanced: false }
}

// Re-export getPlanNodeStatesBulk so callers depending on this module keep
// a single import surface.
export { getPlanNodeStatesBulk }
