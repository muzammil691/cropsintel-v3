import { TOOLS, ToolName } from './tools'
import { getSupabaseClient } from './supabase'
import { checkBudget } from './cost-gate'
import { TrustMode } from '../types'

export interface DispatchRequest {
  tool: ToolName
  arguments: Record<string, unknown>
  initiatedBy: string // 'cron' | 'chat:<thread_id>' | 'auto'
  trustMode: TrustMode
  overrideToken?: string
}

export interface DispatchResult {
  dispatchId: string
  status: 'success' | 'failed' | 'blocked'
  result?: unknown
  error?: string
  durationMs: number
}

const READ_ONLY_TOOLS = new Set<ToolName>([
  'memory.search', 'builder.list_queue', 'verifier.recent_runs', 'status.snapshot',
])

export async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
  const start = Date.now()

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
    'council.write_spec': 0.10,
    'memory.search':      0.001,
    'memory.ingest':      0.001,
    'adela.trigger_scrape': 0.001,
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

  // Execute the tool
  const toolEntry = (TOOLS as Record<string, { fn: (...a: unknown[]) => Promise<unknown>; description: string } | undefined>)[req.tool]
  if (!toolEntry) {
    await sb.from('atlas_dispatches').update({ status: 'failed', error_message: `unknown tool: ${req.tool}`, duration_ms: Date.now() - start }).eq('id', dispatchId)
    return { dispatchId, status: 'failed', error: `unknown tool: ${req.tool}`, durationMs: Date.now() - start }
  }

  try {
    const args = Object.values(req.arguments)
    const result = await toolEntry.fn(...args)
    const duration = Date.now() - start
    await sb.from('atlas_dispatches').update({ status: 'success', result, duration_ms: duration }).eq('id', dispatchId)
    return { dispatchId, status: 'success', result, durationMs: duration }
  } catch (err) {
    const duration = Date.now() - start
    const errorMsg = err instanceof Error ? err.message : String(err)
    await sb.from('atlas_dispatches').update({ status: 'failed', error_message: errorMsg, duration_ms: duration }).eq('id', dispatchId)
    return { dispatchId, status: 'failed', error: errorMsg, durationMs: duration }
  }
}
