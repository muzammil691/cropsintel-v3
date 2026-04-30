# Task: Phase 1.10m — Atlas Conductor Loop (autonomous orchestration heartbeat)

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §6 (multi-brain) and §10 (snapshot cron). Extends 1.10i with autonomous ACTIONS, not just observation.
**Context:** Atlas today is reactive — it answers when Muzammil messages. It does NOT proactively watch Builder/Verifier/Memory health, detect stuck queues, ping when blocked, or queue remediation. This task adds the conductor brain — Atlas becomes a 24/7 supervisor that talks to other agents and to Muzammil without prompting.
**Estimated effort:** ~45 min
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

A 5-minute interval cron inside Atlas that:

1. Snapshots project state (already in 1.10i — keep that part)
2. **Diagnoses anomalies** by comparing current state to expected behavior
3. **Takes autonomous corrective actions** under trust-mode rules
4. **Escalates to Muzammil** via WhatsApp when human input needed
5. Logs all decisions to `atlas_decisions` so user can audit what Atlas did/why

This is the conductor brain. Once shipped, the loop runs:

```
HEARTBEAT (every 5 min)
   ├─ Snapshot state (queue, in-flight, costs, audit rates, memory growth)
   ├─ Diagnose: anything stuck, slow, failing, idle, expensive?
   ├─ Decide: act autonomously OR escalate to Muzammil OR do nothing
   ├─ Act: dispatch tools (queue spec, restart hint, ingest, ask user)
   └─ Log decision rationale to atlas_decisions
```

## Implementation

### atlas/src/cron/conductor.ts

```ts
import { getSupabaseClient } from '../lib/supabase'
import { dispatch } from '../lib/dispatch'
import { sendWhatsAppReply } from '../lib/twilio'
import { simple, debate } from '../lib/multi-brain'
import { getCurrentMode } from '../lib/trust-mode'

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.ATLAS_HEARTBEAT_INTERVAL_MS ?? '300000', 10)
const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'
const STUCK_BUILDER_MINUTES = 30   // queue has work but no Builder commits in 30 min → stuck
const IDLE_QUEUE_HOURS = 2         // queue empty and no chats from user for 2 hrs → ask "what's next?"

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
  const sb = getSupabaseClient()
  const trustMode = getCurrentMode()

  if (trustMode === 'stopped' || trustMode === 'passive') {
    console.log(`[atlas-conductor] trust mode is ${trustMode}, snapshotting only`)
    // Still snapshot, just don't ACT
    await snapshotOnly()
    return
  }

  try {
    // 1. Gather data
    const state = await gatherState()

    // 2. Diagnose anomalies (this is where the brain runs)
    const diagnosis = await diagnose(state)

    // 3. Log signals
    for (const signal of diagnosis.signals) {
      console.log(`[atlas-conductor] signal[${signal.severity}] ${signal.id}: ${signal.description}`)
    }

    // 4. Execute actions per trust mode
    for (const action of diagnosis.recommendedActions) {
      await executeAction(action, trustMode, state)
    }
  } catch (err) {
    console.error('[atlas-conductor] heartbeat failed:', err)
  }
}

async function gatherState() {
  const sb = getSupabaseClient()
  const repoRoot = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

  // Filesystem queue
  const { readdir } = await import('fs/promises')
  const { resolve } = await import('path')
  const queued = (await readdir(resolve(repoRoot, '.agent/tasks/queued'))).filter(f => f.endsWith('.md') && f !== '_template.md')
  const inProgress = (await readdir(resolve(repoRoot, '.agent/tasks/in-progress'))).filter(f => f.endsWith('.md') && f !== '_template.md')

  // Recent verifier runs
  const { data: verifierRuns } = await sb.from('verifier_runs').select('*').order('created_at', { ascending: false }).limit(20)

  // Latest snapshots (for trend analysis)
  const { data: recentSnapshots } = await sb.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(12)  // last hour

  // Last user-Atlas chat (any thread)
  const { data: lastUserMsg } = await sb.from('atlas_conversations').select('created_at, channel').eq('role', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle()

  // Open forks
  const { data: openForks } = await sb.from('atlas_decisions').select('*').is('chosen_option', null).order('decided_at', { ascending: false }).limit(10)

  return {
    queued,
    inProgress,
    verifierRuns: verifierRuns ?? [],
    recentSnapshots: recentSnapshots ?? [],
    lastUserMsg,
    openForks: openForks ?? [],
    now: new Date(),
  }
}

async function diagnose(state: Awaited<ReturnType<typeof gatherState>>): Promise<Diagnosis> {
  const signals: Signal[] = []
  const actions: Action[] = []

  // SIGNAL 1: Builder stuck — queue has specs, no in-flight, no recent commits
  if (state.queued.length > 0 && state.inProgress.length === 0) {
    // Compare to previous snapshots: if queued count was the same N minutes ago, Builder may be stuck
    const prevSnap = state.recentSnapshots[1]  // 5 min ago
    const stuckMinutes = state.recentSnapshots.findIndex(s => s.queued_specs !== state.queued.length)
    const minutesStuck = stuckMinutes < 0 ? state.recentSnapshots.length * 5 : stuckMinutes * 5

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
    const lastMsgAge = state.lastUserMsg ? (state.now.getTime() - new Date(state.lastUserMsg.created_at).getTime()) / 60000 : 999999
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
    const ageMin = (state.now.getTime() - new Date(fork.decided_at).getTime()) / 60000
    if (ageMin > 60 && ageMin < 65) {  // ping at 1 hr, don't spam
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
  const today = state.recentSnapshots[0]?.cost_today_usd ?? 0
  const yesterday = state.recentSnapshots[state.recentSnapshots.length - 1]?.cost_today_usd ?? 0
  if (today > 30 && today > yesterday * 3) {  // >$30 today AND 3× yesterday
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

async function executeAction(action: Action, trustMode: string, state: Awaited<ReturnType<typeof gatherState>>): Promise<void> {
  const sb = getSupabaseClient()

  // Log to atlas_decisions
  await sb.from('atlas_decisions').insert({
    fork_question: `Conductor action: ${action.type}`,
    options_considered: { proposed: action },
    chosen_option: action.type,
    rationale: action.reason,
    decided_by: 'atlas-conductor',
  })

  switch (action.type) {
    case 'whatsapp_ping':
      // Always allowed in chat/confirm/auto modes
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, action.params.message as string)
      break

    case 'queue_spec':
      if (trustMode !== 'auto') {
        // In confirm mode, ping user first; user must reply yes via chat
        await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `Atlas wants to queue spec: ${action.params.filename}. Reply YES to approve.`)
      } else {
        await dispatch({
          tool: 'builder.queue_spec',
          arguments: action.params,
          initiatedBy: 'cron',
          trustMode: 'auto',
        })
      }
      break

    case 'memory_ingest':
      if (trustMode === 'auto') {
        await dispatch({
          tool: 'memory.ingest',
          arguments: action.params,
          initiatedBy: 'cron',
          trustMode: 'auto',
        })
      }
      break

    case 'multi_brain_debate':
      // Run debate, log result, ping user with verdict
      const result = await debate(`Project anomaly detected: ${JSON.stringify(action.params)}. Should we pause Builder, queue remediation, or escalate to user? Output VERDICT: pause | remediate | escalate.`)
      await sendWhatsAppReply(
        MUZAMMIL_WHATSAPP,
        `🧠 Multi-brain debate on ${action.params.topic}: ${result.verdict} → ${result.chosen ?? 'no consensus'}. Rationale: ${result.rationale}`,
      )
      break

    case 'log_only':
      // Already logged via atlas_decisions
      break
  }
}

async function snapshotOnly(): Promise<void> {
  // Reuse snapshot logic from 1.10i — write atlas_snapshots row but don't act
  // Implementation: import and call the snapshot writer from 1.10i
  const { runSnapshot } = await import('./snapshot')
  await runSnapshot()
}
```

### Wire into server.ts

```ts
import { startConductorLoop } from './cron/conductor'

export async function startServer(): Promise<void> {
  validateEnv()
  await loadTrustModeFromDb()
  startSnapshotCron()       // 1.10i — observation
  startConductorLoop()      // 1.10m — observation + action
  // ... existing listen() ...
}
```

The conductor wraps and extends snapshot cron — both run in parallel; snapshot writes data, conductor reads + reasons + acts.

## Behavior summary by trust mode

| Mode | Conductor behavior |
|---|---|
| `passive` | Skips heartbeat entirely (snapshot-only via 1.10i) |
| `chat` | Skips heartbeat (read-only, no proactive WhatsApp) |
| `confirm` | Detects, pings user with proposed action, waits for "yes" reply |
| `auto` | Detects, executes within cost cap, pings user with summary |
| `stopped` | Skips entirely |

So this is OPT-IN to autonomy. Setting `ATLAS_TRUST_MODE=confirm` gets you proactive pings WITHOUT auto-execution. Setting `auto` gets full conductor autonomy.

## Acceptance criteria

After this task ships:

1. `atlas/src/cron/conductor.ts` exists with `startConductorLoop`.
2. `startServer()` calls both `startSnapshotCron()` and `startConductorLoop()`.
3. With `ATLAS_TRUST_MODE=confirm`, simulated stuck-builder scenario (Builder commits stale, queue has specs) triggers WhatsApp ping within 30 min.
4. With `auto`, conductor calls `multi_brain_debate` for verifier failure clusters.
5. All conductor actions logged to `atlas_decisions` with `decided_by='atlas-conductor'`.
6. Heartbeat survives transient errors (e.g., Supabase down for 1 cycle) without crashing the cron.

## Out of scope

- Restarting sibling Railway services (no Railway API integration in v0.1; user does manual restart)
- Self-modification (Atlas changing its own code) — too risky for v0.1
- Cross-cron coordination (multiple Atlas replicas) — single replica only

## Notes

- Conductor uses Opus 4.7 model (highest reasoning quality) for `multi_brain_debate`. Cost-controlled by 1.10g cost gate.
- The `STUCK_BUILDER_MINUTES = 30` threshold is configurable via env var; tune based on observed task durations.
- WhatsApp pings are subject to existing rate limit (6/hr) from 1.10i. Conductor and snapshot share the rate budget.
- This is the FINAL piece that makes Atlas truly autonomous. After this, you direct phases on WhatsApp, Atlas does the rest.
