import { getSupabaseClient } from '../lib/supabase'
import { dispatch } from '../lib/dispatch'
import { sendWhatsAppReply } from '../lib/twilio'
import { simple, debate } from '../lib/multi-brain'
import { getCurrentMode } from '../lib/trust-mode'
import { ToolName } from '../lib/tools'

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.ATLAS_HEARTBEAT_INTERVAL_MS ?? '300000', 10)
const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'
const STUCK_BUILDER_MINUTES = parseInt(process.env.ATLAS_STUCK_BUILDER_MINUTES ?? '30', 10)
const IDLE_QUEUE_HOURS = parseInt(process.env.ATLAS_IDLE_QUEUE_HOURS ?? '2', 10)

void simple

interface Diagnosis {
  signals: Signal[]
  recommendedActions: Action[]
}

interface Signal {
  id: string
  severity: 'info' | 'warn' | 'critical'
  description: string
  data: Record<string, unknown>
}

interface Action {
  type: 'whatsapp_ping' | 'queue_spec' | 'memory_ingest' | 'log_only' | 'multi_brain_debate'
  reason: string
  params: Record<string, unknown>
}

export function startConductorLoop(): void {
  console.log(`[atlas-conductor] starting heartbeat, interval=${HEARTBEAT_INTERVAL_MS}ms`)
  void runHeartbeat()
  setInterval(() => void runHeartbeat(), HEARTBEAT_INTERVAL_MS)
}

async function runHeartbeat(): Promise<void> {
  const trustMode = getCurrentMode()

  if (trustMode === 'stopped' || trustMode === 'passive' || trustMode === 'chat') {
    console.log(`[atlas-conductor] trust mode is ${trustMode}, snapshotting only`)
    await snapshotOnly()
    return
  }

  try {
    const state = await gatherState()
    const diagnosis = await diagnose(state)

    for (const signal of diagnosis.signals) {
      console.log(`[atlas-conductor] signal[${signal.severity}] ${signal.id}: ${signal.description}`)
    }

    for (const action of diagnosis.recommendedActions) {
      await executeAction(action, trustMode)
    }
  } catch (err) {
    console.error('[atlas-conductor] heartbeat failed:', err)
  }
}

interface ConductorState {
  queued: string[]
  inProgress: string[]
  verifierRuns: Array<Record<string, unknown>>
  recentSnapshots: Array<Record<string, unknown>>
  lastUserMsg: { created_at: string; channel: string } | null
  openForks: Array<Record<string, unknown>>
  now: Date
}

async function gatherState(): Promise<ConductorState> {
  const sb = getSupabaseClient()
  const repoRoot = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

  const { readdir } = await import('fs/promises')
  const { resolve } = await import('path')
  const queued = (await readdir(resolve(repoRoot, '.agent/tasks/queued')).catch(() => [] as string[]))
    .filter(f => f.endsWith('.md') && f !== '_template.md')
  const inProgress = (await readdir(resolve(repoRoot, '.agent/tasks/in-progress')).catch(() => [] as string[]))
    .filter(f => f.endsWith('.md') && f !== '_template.md')

  let verifierRuns: Array<Record<string, unknown>> = []
  let recentSnapshots: Array<Record<string, unknown>> = []
  let lastUserMsg: { created_at: string; channel: string } | null = null
  let openForks: Array<Record<string, unknown>> = []

  if (sb) {
    const { data: vr } = await sb.from('verifier_runs').select('*').order('created_at', { ascending: false }).limit(20)
    verifierRuns = (vr ?? []) as Array<Record<string, unknown>>

    const { data: snaps } = await sb.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(12)
    recentSnapshots = (snaps ?? []) as Array<Record<string, unknown>>

    const { data: lastMsg } = await sb
      .from('atlas_conversations')
      .select('created_at, channel')
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastUserMsg = (lastMsg ?? null) as { created_at: string; channel: string } | null

    const { data: forks } = await sb
      .from('atlas_decisions')
      .select('*')
      .is('chosen_option', null)
      .order('decided_at', { ascending: false })
      .limit(10)
    openForks = (forks ?? []) as Array<Record<string, unknown>>
  }

  return {
    queued,
    inProgress,
    verifierRuns,
    recentSnapshots,
    lastUserMsg,
    openForks,
    now: new Date(),
  }
}

async function diagnose(state: ConductorState): Promise<Diagnosis> {
  const signals: Signal[] = []
  const actions: Action[] = []

  // SIGNAL 1: Builder stuck — queue has specs, no in-flight, queued count unchanged across snapshots
  if (state.queued.length > 0 && state.inProgress.length === 0) {
    const stuckIdx = state.recentSnapshots.findIndex(s => (s.queued_specs as number) !== state.queued.length)
    const minutesStuck = stuckIdx < 0 ? state.recentSnapshots.length * 5 : stuckIdx * 5

    if (minutesStuck >= STUCK_BUILDER_MINUTES) {
      signals.push({
        id: 'builder_stuck',
        severity: 'critical',
        description: `Builder hasn't picked up specs for ${minutesStuck} min. Queue has ${state.queued.length} specs, in-flight is empty.`,
        data: { queueSize: state.queued.length, minutesStuck, queuedSpecs: state.queued },
      })
      actions.push({
        type: 'whatsapp_ping',
        reason: 'Builder may be wedged — needs human investigation',
        params: {
          message: `🚨 Builder stuck for ${minutesStuck} min. Queue has ${state.queued.length} specs (${state.queued[0]} next). Likely needs Railway restart on cropsintel-agent.`,
        },
      })
    }
  }

  // SIGNAL 2: Queue empty AND user hasn't directed in IDLE_QUEUE_HOURS
  if (state.queued.length === 0 && state.inProgress.length === 0) {
    const lastMsgAge = state.lastUserMsg
      ? (state.now.getTime() - new Date(state.lastUserMsg.created_at).getTime()) / 60000
      : 999999
    if (lastMsgAge > IDLE_QUEUE_HOURS * 60) {
      signals.push({
        id: 'idle_no_direction',
        severity: 'info',
        description: `Queue empty, no user message in ${Math.round(lastMsgAge)} min. Waiting for direction.`,
        data: { idleMinutes: Math.round(lastMsgAge) },
      })
      actions.push({
        type: 'whatsapp_ping',
        reason: 'Long idle period; nudge user for next direction',
        params: {
          message: `🟢 Queue empty, all green. What should we tackle next? Phase 1.3 (auth) or Phase 1.6 (Adela scrapers)?`,
        },
      })
    }
  }

  // SIGNAL 3: Verifier failures clustering
  const recentFailures = state.verifierRuns.filter(r => r.verdict === 'fail').length
  if (recentFailures >= 3 && state.verifierRuns.length >= 5) {
    signals.push({
      id: 'verifier_failure_cluster',
      severity: 'warn',
      description: `${recentFailures} of last ${state.verifierRuns.length} audits failed. Code quality regression suspected.`,
      data: { recentFailures, total: state.verifierRuns.length },
    })
    actions.push({
      type: 'multi_brain_debate',
      reason: 'Decide whether to pause Builder or queue a verifier-tune remediation',
      params: { topic: 'verifier_failure_pattern', context: state.verifierRuns.slice(0, 5) },
    })
  }

  // SIGNAL 4: Open architectural forks awaiting user
  for (const fork of state.openForks) {
    const decidedAt = fork.decided_at as string | undefined
    if (!decidedAt) continue
    const ageMin = (state.now.getTime() - new Date(decidedAt).getTime()) / 60000
    if (ageMin > 60 && ageMin < 65) {
      actions.push({
        type: 'whatsapp_ping',
        reason: 'Open fork unresolved for 1+ hour',
        params: {
          message: `⏰ Fork waiting your decision (1h+): ${fork.fork_question}. Reply with your choice.`,
        },
      })
    }
  }

  // SIGNAL 5: Cost burn rate spike
  const today = (state.recentSnapshots[0]?.cost_today_usd as number) ?? 0
  const yesterday = (state.recentSnapshots[state.recentSnapshots.length - 1]?.cost_today_usd as number) ?? 0
  if (today > 30 && today > yesterday * 3) {
    signals.push({
      id: 'cost_spike',
      severity: 'warn',
      description: `Cost burn $${today.toFixed(2)} today, vs $${yesterday.toFixed(2)} prior. 3x spike.`,
      data: { today, prior: yesterday },
    })
    actions.push({
      type: 'whatsapp_ping',
      reason: 'Cost spike — user should know',
      params: {
        message: `💸 Cost spike alert: $${today.toFixed(2)} today (vs $${yesterday.toFixed(2)} yesterday). Investigate which agent is burning.`,
      },
    })
  }

  return { signals, recommendedActions: actions }
}

async function executeAction(action: Action, trustMode: string): Promise<void> {
  const sb = getSupabaseClient()

  if (sb) {
    await sb.from('atlas_decisions').insert({
      fork_question: `Conductor action: ${action.type}`,
      options_considered: { proposed: action },
      chosen_option: action.type,
      rationale: action.reason,
      decided_by: 'atlas-conductor',
    })
  }

  switch (action.type) {
    case 'whatsapp_ping':
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, action.params.message as string)
      break

    case 'queue_spec':
      if (trustMode !== 'auto') {
        await sendWhatsAppReply(
          MUZAMMIL_WHATSAPP,
          `Atlas wants to queue spec: ${action.params.filename}. Reply YES to approve.`,
        )
      } else {
        await dispatch({
          tool: 'builder.queue_spec' as ToolName,
          arguments: action.params,
          initiatedBy: 'cron',
          trustMode: 'auto',
        })
      }
      break

    case 'memory_ingest':
      if (trustMode === 'auto') {
        await dispatch({
          tool: 'memory.ingest' as ToolName,
          arguments: action.params,
          initiatedBy: 'cron',
          trustMode: 'auto',
        })
      }
      break

    case 'multi_brain_debate': {
      const result = await debate(
        `Project anomaly detected: ${JSON.stringify(action.params)}. Should we pause Builder, queue remediation, or escalate to user? Output VERDICT: pause | remediate | escalate.`,
      )
      await sendWhatsAppReply(
        MUZAMMIL_WHATSAPP,
        `🧠 Multi-brain debate on ${action.params.topic}: ${result.verdict} → ${result.chosen ?? 'no consensus'}. Rationale: ${result.rationale ?? 'n/a'}`,
      )
      break
    }

    case 'log_only':
      break
  }
}

async function snapshotOnly(): Promise<void> {
  const { runSnapshot } = await import('./snapshot.js')
  await runSnapshot()
}
