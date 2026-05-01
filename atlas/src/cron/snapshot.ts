import { getSupabaseClient } from '../lib/supabase'
import { statusSnapshot as computeSnapshot, builderQueueOrder } from '../lib/tools'
import { getBurnRate } from '../lib/cost-gate'
import { sendWhatsAppReply } from '../lib/twilio'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { withGitLock } from '../lib/git-mutex'

const execFileP = promisify(execFile)
const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

const INTERVAL_MS = parseInt(process.env.ATLAS_SNAPSHOT_INTERVAL_MS ?? '300000', 10)
const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'
const PING_RATE_LIMIT_PER_HOUR = 6
const recentPings: number[] = []

export function startSnapshotCron(): void {
  console.log(`[atlas-cron] starting snapshot cron, interval=${INTERVAL_MS}ms`)
  void runSnapshot()
  setInterval(() => void runSnapshot(), INTERVAL_MS)
}

export async function runSnapshot(): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) {
    console.warn('[atlas-cron] Supabase not configured — skipping snapshot')
    return
  }
  try {
    const stateResult = await computeSnapshot()
    const burn = await getBurnRate()
    const state = stateResult as Record<string, unknown>

    const { data: openForks } = await sb
      .from('atlas_decisions')
      .select('id, fork_question, decided_at')
      .is('chosen_option', null)
      .order('decided_at', { ascending: false })
      .limit(10)

    const { data: recentRuns } = await sb
      .from('verifier_runs')
      .select('verdict')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    const passes = (recentRuns ?? []).filter(r => r.verdict === 'pass').length
    const total = (recentRuns ?? []).length
    const passRate = total > 0 ? (passes / total) * 100 : null

    const { data: prev } = await sb
      .from('atlas_snapshots')
      .select('*')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // 1.10x: loop health metrics
    const loopHealth = await computeLoopHealth()

    const { data: snapshot } = await sb.from('atlas_snapshots').insert({
      current_phase: deriveCurrentPhase(state),
      queued_specs: state.queuedSpecs,
      in_flight_specs: state.inFlightSpecs,
      done_specs_24h: 0,
      failed_specs_24h: 0,
      verifier_pass_rate: passRate,
      memory_chunk_count: state.memoryChunkCount,
      cost_today_usd: burn.today,
      cost_month_to_date_usd: burn.monthToDate,
      open_forks: openForks ?? [],
      raw_state: { ...state, burn, loopHealth },
      loop_lag_seconds: loopHealth.loopLagSeconds,
      dependency_violations_count: loopHealth.dependencyViolationsCount,
      priority_inversions_count: loopHealth.priorityInversionsCount,
    }).select('*').single()

    console.log(`[atlas-cron] snapshot written: queued=${state.queuedSpecs}, inFlight=${state.inFlightSpecs}, cost_today=$${burn.today.toFixed(4)}`)

    if (prev && snapshot) {
      await detectAndPing(prev as Record<string, unknown>, snapshot as Record<string, unknown>)
    }
  } catch (err) {
    console.error('[atlas-cron] snapshot failed:', err)
  }
}

function deriveCurrentPhase(_state: Record<string, unknown>): string | null {
  return null
}

async function detectAndPing(prev: Record<string, unknown>, current: Record<string, unknown>): Promise<void> {
  const messages: string[] = []

  if ((current.failed_specs_24h as number) > (prev.failed_specs_24h as number)) {
    messages.push(`⚠️ New failed spec. Total failed in 24h: ${current.failed_specs_24h}`)
  }

  const prevForks = (prev.open_forks as Array<{ id: string }> ?? []).map(f => f.id)
  const newForks = ((current.open_forks as Array<{ id: string; fork_question: string }>) ?? []).filter(f => !prevForks.includes(f.id))
  for (const fork of newForks) {
    messages.push(`🤔 New fork needs your decision: ${fork.fork_question}`)
  }

  const monthly = (current.cost_month_to_date_usd as number) ?? 0
  const monthlyPrev = (prev.cost_month_to_date_usd as number) ?? 0
  const cap = parseFloat(process.env.ATLAS_BUDGET_MONTHLY ?? '400')
  if (monthly > cap * 0.8 && monthlyPrev <= cap * 0.8) {
    messages.push(`💸 Budget warning: ${Math.round(100 * monthly / cap)}% of monthly cap consumed ($${monthly.toFixed(2)} of $${cap})`)
  }

  const dailyToday = (current.cost_today_usd as number) ?? 0
  const dailyPrev = (prev.cost_today_usd as number) ?? 0
  const dailyThresh = parseFloat(process.env.ATLAS_BUDGET_DAILY_PAUSE ?? '40')
  if (dailyToday > dailyThresh && dailyPrev <= dailyThresh) {
    messages.push(`🔥 Daily soft cap exceeded: $${dailyToday.toFixed(2)} today (threshold $${dailyThresh}). Auto-dispatch paused.`)
  }

  for (const msg of messages) {
    if (canSendPing()) {
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `[Atlas] ${msg}`)
      recentPings.push(Date.now())
    }
  }
}

function canSendPing(): boolean {
  const oneHourAgo = Date.now() - 3600 * 1000
  while (recentPings.length > 0 && recentPings[0] < oneHourAgo) {
    recentPings.shift()
  }
  return recentPings.length < PING_RATE_LIMIT_PER_HOUR
}

interface LoopHealth {
  loopLagSeconds: number | null
  dependencyViolationsCount: number
  priorityInversionsCount: number
}

// Loop lag: seconds between the most-recent commit that *added* a spec to
// .agent/tasks/queued/ and the most-recent in-progress pickup. Proxy for
// "how long is Builder behind?". Null when we can't compute (no queue, no
// recent queue add commits).
async function computeLoopHealth(): Promise<LoopHealth> {
  let queueOrder: Awaited<ReturnType<typeof builderQueueOrder>>['order'] = []
  try {
    const r = await builderQueueOrder()
    queueOrder = r.order
  } catch (err) {
    console.warn('[atlas-cron] queue_order for loop health failed:', err)
  }
  const dependencyViolationsCount = queueOrder.filter(s => s.blocked).length
  // Priority inversion = an unblocked spec with priority strictly lower (more
  // urgent) than the head spec. Same metric the conductor acts on.
  const unblocked = queueOrder.filter(s => !s.blocked)
  let priorityInversionsCount = 0
  if (unblocked.length >= 2) {
    const headPri = unblocked[0].priority
    priorityInversionsCount = unblocked.slice(1).filter(s => s.priority < headPri).length
  }

  let loopLagSeconds: number | null = null
  try {
    // Most recent commit that touched .agent/tasks/queued/* (should be when a spec arrived).
    // Both git log calls are serialized as one critical section so they don't race
    // with concurrent fetch+reset ops from tools.ts / conductor.ts.
    const { queueAddedAt, pickupAt } = await withGitLock('snapshot:loop-lag', async () => {
      const queueCommit = await execFileP(
        'git',
        ['log', '-1', '--pretty=format:%ct', '--', '.agent/tasks/queued/'],
        { cwd: REPO_ROOT },
      )
      const pickupCommit = await execFileP(
        'git',
        ['log', '-1', '--pretty=format:%ct', '--', '.agent/tasks/in-progress/'],
        { cwd: REPO_ROOT },
      )
      return {
        queueAddedAt: parseInt(queueCommit.stdout.trim(), 10),
        pickupAt: parseInt(pickupCommit.stdout.trim(), 10),
      }
    })
    if (!isNaN(queueAddedAt)) {
      // If a pickup happened AFTER the latest queue add, lag is small.
      // If queue add is more recent and queue isn't empty → lag = now - queueAdd.
      if (queueOrder.length === 0) {
        loopLagSeconds = 0
      } else if (!isNaN(pickupAt) && pickupAt >= queueAddedAt) {
        loopLagSeconds = 0
      } else {
        loopLagSeconds = Math.max(0, Math.floor(Date.now() / 1000) - queueAddedAt)
      }
    }
  } catch (err) {
    console.warn('[atlas-cron] loop lag git log failed:', err)
  }

  return { loopLagSeconds, dependencyViolationsCount, priorityInversionsCount }
}
