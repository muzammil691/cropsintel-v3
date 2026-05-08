import { getSupabaseClient } from '../lib/supabase'
import { dispatch } from '../lib/dispatch'
import { sendWhatsAppReplyAutoSplit } from '../lib/twilio'

// Phase 1.10aw — every WhatsApp ping from the conductor is wrapped in the
// auto-splitter. Most pings are short (<200 chars) and pass straight through;
// the wrap exists so anything embedding multi-line spec content (debate
// summaries, log excerpts) never trips Twilio's 1600-char cap.
const sendWhatsAppReply = (to: string, body: string) =>
  sendWhatsAppReplyAutoSplit(to, body)
import { simple, debate, DebateResult } from '../lib/multi-brain'
import { checkClusterDedupe, rememberClusterKey } from '../lib/cluster-dedupe'
import { getCurrentMode } from '../lib/trust-mode'
import { checkBudget } from '../lib/cost-gate'
import { ToolName, builderQueueOrder } from '../lib/tools'
import { requeueWithGaps, type VerifierGap } from '../lib/plan-server'
import { checkWorkflowTraceInvariants, consumeNewWorkflowViolations, type WorkflowTraceViolation } from '../lib/invariants'
import { withGitLock } from '../lib/git-mutex'
import { TrustMode } from '../types'
import { maybeSummarize } from '../lib/chat-summarizer'
import { readFile, writeFile, rename, mkdir, readdir, access, stat, rm } from 'fs/promises'
import { resolve, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.ATLAS_HEARTBEAT_INTERVAL_MS ?? '300000', 10)
const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'
// Phase 1.10aw-rem — opt-in outbound notification number for task-done events.
// Distinct from MUZAMMIL_WHATSAPP (always-on critical alerts) so an operator
// can subscribe a different number to ship pings without inheriting incident
// pages. Empty string disables the outbound entirely.
const WHATSAPP_NOTIFY_NUMBER = process.env.WHATSAPP_NOTIFY_NUMBER ?? ''
const STUCK_BUILDER_MINUTES = parseInt(process.env.ATLAS_STUCK_BUILDER_MINUTES ?? '30', 10)
const IDLE_QUEUE_HOURS = parseInt(process.env.ATLAS_IDLE_QUEUE_HOURS ?? '2', 10)
const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN
const RAILWAY_BUILDER_SERVICE_ID = process.env.RAILWAY_BUILDER_SERVICE_ID
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID
// Tracks signatures of specs we've already pre-flighted so we only review NEW arrivals.
const seenSpecs = new Set<string>()
// Tracks commits we've already designer-audited so we don't re-audit on every heartbeat.
const auditedCommits = new Set<string>()
// G.2: tracks (taskId, ranAt) pairs we've already auto-requeued so the loop
// doesn't keep re-firing requeueWithGaps for the same failure on every cron tick.
const autoRequeuedFailures = new Set<string>()
// H.3: tracks zombie task ids we've already pinged about so we don't WhatsApp-spam.
// Cleared every 6h so genuinely-still-stuck specs eventually re-notify.
const pingedZombies = new Map<string, number>()  // taskId → ping timestamp (ms)

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

  if (trustMode === 'stopped') {
    console.log('[atlas-conductor] trust mode stopped — no heartbeat work')
    return
  }
  if (trustMode === 'passive') {
    console.log('[atlas-conductor] trust mode passive — snapshot only')
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

    // The autonomous behaviors. Each is internally trust-mode aware and
    // budget-gated. Run sequentially so one bad cluster doesn't trigger ten.
    await preFlightNewSpecs(state, trustMode)
    await detectFailureClusters(state, trustMode)
    await designerAuditOnUiCommits(state, trustMode)
    await selfHealStuckBuilder(state, trustMode)
    await suggestNextPhase(state, trustMode)
    // 1.10x: queue intelligence + post-ship memory ingest.
    await reorderQueueIfPriorityInversion(trustMode)
    await memoryIngestAfterShips(trustMode)
    await verifierAuditAfterShips(trustMode)
    await markVerifiedBuildAttempts(trustMode)
    // G.2: auto-requeue specs that failed Verifier with the gaps injected,
    // so Builder + Verifier can converge instead of leaving specs in limbo.
    // 3-attempt cap; beyond that, escalate via WhatsApp.
    await autoRequeueOnVerifierFail(trustMode)
    // H.3: per-spec zombie detector. Distinct from selfHealStuckBuilder
    // (which handles Builder-totally-idle). This pass surfaces specs stuck
    // in in-progress/ for >60 min so the user can force-cancel them.
    await detectInProgressZombies(trustMode)
    // Phase 1.10ag: actually reap the zombies (move to failed/) when Builder's
    // heartbeat confirms it isn't beating on the spec. Heartbeat-aware so a
    // long-running spec that's still legitimately under construction is left
    // alone. detectInProgressZombies above only PINGS — this MOVES.
    await reapZombieSpecs(trustMode)
    // Phase 1.10aw-rem: opt-in WhatsApp ping when a task ships. Sibling pass
    // (does not modify the audit/ingest behavior); no-op unless
    // WHATSAPP_NOTIFY_NUMBER is set.
    await notifyTaskDoneAfterShips(trustMode)
    // 1.10ar: rolling chat-summary sweep — covers WhatsApp/voice threads
    // that don't run through the cockpit chat handler.
    await chatSummarySweep(trustMode)
    // 1.10ad: workflow-trace invariants (verifier/designer/memory presence post-ship).
    await checkWorkflowTraceAndPing(trustMode)
    // 1.10aq: auto-fix lifecycle pass — promote queued→shipped→resolved/failed.
    await autoFixLifecyclePass(trustMode)
    // 1.10ax: write heartbeats for the non-Builder agents so all 7 nodes light up.
    await writeNonBuilderHeartbeats()
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
  recentUiCommits: Array<{ sha: string; subject: string; changedFiles: string[] }>
  now: Date
}

async function gatherState(): Promise<ConductorState> {
  const sb = getSupabaseClient()

  const queued = (await readdir(resolve(REPO_ROOT, '.agent/tasks/queued')).catch(() => [] as string[]))
    .filter(f => f.endsWith('.md') && f !== '_template.md')
  const inProgress = (await readdir(resolve(REPO_ROOT, '.agent/tasks/in-progress')).catch(() => [] as string[]))
    .filter(f => f.endsWith('.md') && f !== '_template.md')

  let verifierRuns: Array<Record<string, unknown>> = []
  let recentSnapshots: Array<Record<string, unknown>> = []
  let lastUserMsg: { created_at: string; channel: string } | null = null
  let openForks: Array<Record<string, unknown>> = []

  if (sb) {
    const { data: vr } = await sb.from('verifier_runs').select('*').order('ran_at', { ascending: false }).limit(20)
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

  const recentUiCommits = await getRecentUiCommits(20)

  return {
    queued,
    inProgress,
    verifierRuns,
    recentSnapshots,
    lastUserMsg,
    openForks,
    recentUiCommits,
    now: new Date(),
  }
}

async function diagnose(state: ConductorState): Promise<Diagnosis> {
  const signals: Signal[] = []
  const actions: Action[] = []

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
    }
  }

  if (state.queued.length === 0 && state.inProgress.length === 0) {
    const lastMsgAge = state.lastUserMsg
      ? (state.now.getTime() - new Date(state.lastUserMsg.created_at).getTime()) / 60000
      : 999999
    if (lastMsgAge > IDLE_QUEUE_HOURS * 60) {
      signals.push({
        id: 'idle_no_direction',
        severity: 'info',
        description: `Queue empty, no user message in ${Math.round(lastMsgAge)} min.`,
        data: { idleMinutes: Math.round(lastMsgAge) },
      })
    }
  }

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

  const today = (state.recentSnapshots[0]?.cost_today_usd as number) ?? 0
  const yesterday = (state.recentSnapshots[state.recentSnapshots.length - 1]?.cost_today_usd as number) ?? 0
  if (today > 30 && today > yesterday * 3) {
    signals.push({
      id: 'cost_spike',
      severity: 'warn',
      description: `Cost burn $${today.toFixed(2)} today vs $${yesterday.toFixed(2)} prior. 3x spike.`,
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
  await logDecision({
    fork_question: `Conductor action: ${action.type}`,
    options_considered: { proposed: action },
    chosen_option: action.type,
    rationale: action.reason,
  })

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
      const ok = await canSpendOnDebate(0.30)
      if (!ok) {
        await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `🧠 Skipping multi-brain debate (${action.params.topic}) — budget exhausted.`)
        break
      }
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

// ─── 1. Pre-flight spec review ──────────────────────────────────────────────

async function preFlightNewSpecs(state: ConductorState, trustMode: TrustMode): Promise<void> {
  if (trustMode === 'passive' || trustMode === 'stopped') return

  const newSpecs = state.queued.filter(f => !seenSpecs.has(f))
  for (const filename of newSpecs) {
    seenSpecs.add(filename)
    try {
      await preFlightSpecReview(filename, trustMode)
    } catch (err) {
      console.error(`[atlas-conductor] pre-flight failed for ${filename}:`, err)
    }
  }
}

async function preFlightSpecReview(specFilename: string, trustMode: TrustMode): Promise<boolean> {
  const ok = await canSpendOnDebate(0.30)
  if (!ok) {
    await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `🟡 Pre-flight skipped for ${specFilename} — budget exhausted.`)
    return true // Don't block the queue.
  }

  const specPath = resolve(REPO_ROOT, '.agent/tasks/queued', specFilename)
  let specContent: string
  try {
    specContent = await readFile(specPath, 'utf-8')
  } catch {
    return true // Spec already moved.
  }

  const review = await debate(
    `Review this task spec for: ambiguity, missing acceptance criteria, scope creep, missing required env vars, references to non-existent files. Output VERDICT: ready | needs_clarification | reject_scope_violation.

Spec:
${specContent}

For each gap, output the specific lines and the fix needed.`,
  )

  await logDecision({
    fork_question: `Pre-flight spec review: ${specFilename}`,
    options_considered: { ready: 0, needs_clarification: 0, reject_scope_violation: 0 },
    multi_brain_votes: review.votes.map(v => ({ provider: v.provider, model: v.model, content: v.content.slice(0, 500) })),
    chosen_option: review.chosen ?? 'no_consensus',
    rationale: review.rationale ?? 'pre-flight review',
  })

  // chat trust-mode is advisory: log + ping summary only.
  if (trustMode === 'chat') {
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `📋 Pre-flight (advisory) on ${specFilename}: ${review.chosen ?? 'no consensus'}. ${truncate(review.rationale ?? '', 200)}`,
    )
    return true
  }

  // confirm trust-mode: annotate but never auto-cancel; ping user.
  if (trustMode === 'confirm') {
    if (review.chosen === 'reject_scope_violation' || review.chosen === 'needs_clarification') {
      await annotateSpec(specPath, review.rationale ?? 'No rationale')
      await sendWhatsAppReply(
        MUZAMMIL_WHATSAPP,
        `📝 ${specFilename} pre-flight: ${review.chosen}. Annotated; review and re-queue (or reply CANCEL ${specFilename.replace(/\.md$/, '')}).`,
      )
      return false
    }
    return true
  }

  // auto trust-mode: full enforcement.
  if (review.verdict === 'agreement' && review.chosen === 'reject_scope_violation') {
    await dispatchCancelTask(specFilename, review.rationale ?? 'Scope violation')
    await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `🛑 Pre-flight rejected ${specFilename}: ${truncate(review.rationale ?? '', 250)}`)
    return false
  }
  if (review.chosen === 'needs_clarification') {
    await annotateSpec(specPath, review.rationale ?? 'Needs clarification')
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `📝 ${specFilename} needs clarification: ${truncate(review.rationale ?? '', 200)}. Annotated; review and re-queue.`,
    )
    return false
  }
  return true
}

async function annotateSpec(specPath: string, rationale: string): Promise<void> {
  const content = await readFile(specPath, 'utf-8').catch(() => '')
  const block = `\n\n<!-- atlas-preflight-annotation\nverdict: needs_clarification\nrationale: ${rationale.replace(/-->/g, '--&gt;')}\n-->\n`
  await writeFile(specPath, content + block, 'utf-8')
}

async function dispatchCancelTask(specFilename: string, rationale: string): Promise<void> {
  const taskId = specFilename.replace(/\.md$/, '')
  await dispatch({
    tool: 'builder.cancel_task' as ToolName,
    arguments: { taskId },
    initiatedBy: 'cron',
    trustMode: 'auto',
  })
  await logDecision({
    fork_question: `Auto-cancel task: ${taskId}`,
    options_considered: { proposed: 'cancel' },
    chosen_option: 'cancelled',
    rationale,
  })
}

// ─── 2. Verifier failure cluster detection ──────────────────────────────────

async function detectFailureClusters(state: ConductorState, trustMode: TrustMode): Promise<string | null> {
  if (trustMode === 'passive' || trustMode === 'stopped' || trustMode === 'chat') return null

  const recentFails = state.verifierRuns.filter(r => {
    const failed = r.passed === false || r.verdict === 'fail'
    const ts = (r.ran_at ?? r.created_at) as string | undefined
    if (!ts || !failed) return false
    return Date.now() - new Date(ts).getTime() < 30 * 60 * 1000
  })
  if (recentFails.length < 3) return null

  // Persistent dedupe gate. Precedence (highest first): closed-ADR on disk,
  // queued/in-progress investigation in the trailing 30 min, shipped
  // remediation task newer than the latest fail, in-process Set snapshot.
  // Replaces the prior in-process-only Set that wiped on every restart and
  // re-fired identical clusters (eight ADRs queued in three hours on
  // 2026-05-07 — see docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-*).
  const taskIds = recentFails.map(r => r.task_id as string)
  const clusterKey = [...taskIds].sort().join(',')
  const failTimestamps = recentFails
    .map(r => (r.ran_at ?? r.created_at) as string | undefined)
    .filter((s): s is string => Boolean(s))
  const dedupe = await checkClusterDedupe({
    clusterKey,
    taskIds,
    failTimestamps,
    repoRoot: REPO_ROOT,
  })
  if (dedupe.skip) {
    await logDecision({
      fork_question: 'cluster dedupe',
      options_considered: { gate: dedupe.reason },
      chosen_option: dedupe.reason,
      rationale: dedupe.evidence,
    })
    if (trustMode === 'auto' || trustMode === 'confirm') {
      await sendWhatsAppReply(
        MUZAMMIL_WHATSAPP,
        `🟢 Cluster ${truncate(clusterKey, 80)} already addressed (${dedupe.reason}) — skipped`,
      )
    }
    return `deduped-${dedupe.reason}`
  }
  rememberClusterKey(clusterKey)

  // confirm mode: ping with proposal, do not auto-act.
  if (trustMode === 'confirm') {
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `🚦 Verifier failure cluster detected (${recentFails.length} fails in 30 min): ${recentFails.map(r => r.task_id).join(', ')}. Proposing investigation task — reply YES to debate.`,
    )
    return 'pinged'
  }

  // auto mode: full debate + queue.
  const ok = await canSpendOnDebate(0.30)
  if (!ok) {
    await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `🟡 Cluster detected (${recentFails.length} fails) but debate skipped — budget exhausted.`)
    return 'budget-skipped'
  }

  const debatePrompt = `Three+ Verifier failures in 30 min:
${recentFails.map(r => {
  const gaps = r.gaps as
    | Array<{ description?: string; check?: string; expected?: string; actual?: string; remediation?: string }>
    | undefined
  const g = gaps?.[0]
  const detail = g
    ? [g.check && `check=${g.check}`, g.expected && `expected=${g.expected}`, g.actual && `actual=${g.actual}`, g.remediation && `fix=${g.remediation}`, !g.check && g.description].filter(Boolean).join(' | ')
    : ''
  return `- ${r.task_id}: ${detail || 'no gap detail'}`
}).join('\n')}

Common root cause? Should we (a) pause Builder, (b) queue an investigation task, (c) wait? Output VERDICT: pause | investigate | wait.`

  const result = await debate(debatePrompt)

  await logDecision({
    fork_question: `Failure cluster: ${recentFails.length} verifier fails in 30 min`,
    options_considered: { pause: 0, investigate: 0, wait: 0 },
    multi_brain_votes: result.votes.map(v => ({ provider: v.provider, model: v.model, content: v.content.slice(0, 500) })),
    chosen_option: result.chosen ?? 'wait',
    rationale: result.rationale ?? 'cluster debate',
  })

  if (result.chosen === 'pause') {
    await pauseBuilder(`Failure cluster: ${recentFails.length} fails in 30 min`)
    return 'paused-builder'
  }
  if (result.chosen === 'investigate') {
    const filename = `phase-1-CLUSTER-investigation-${Date.now()}.md`
    await dispatch({
      tool: 'builder.queue_spec' as ToolName,
      arguments: {
        filename,
        body: composeInvestigationSpec(recentFails, result),
      },
      initiatedBy: 'cron',
      trustMode: 'auto',
    })
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `🔍 Cluster investigation queued (${filename}): ${truncate(result.rationale ?? '', 200)}`,
    )
    return 'queued-investigation'
  }
  return 'waiting'
}

function composeInvestigationSpec(
  recentFails: Array<Record<string, unknown>>,
  debateResult: DebateResult,
): string {
  const failBullets = recentFails.map(r => {
    // Verifier emits structured Gap[] rows (check/expected/actual/remediation)
    // — see verifier/src/verify.ts:85-105 for empty-diff-guard. Older code
    // paths only set `description`. Render whichever fields are present so
    // investigation specs stop saying "no detail" and the empty-diff-guard
    // cannot fire on legitimate cluster investigations.
    const gaps = r.gaps as
      | Array<{
          description?: string
          check?: string
          expected?: string
          actual?: string
          remediation?: string
        }>
      | undefined
    const g = gaps?.[0]
    const parts: string[] = []
    if (g?.check) parts.push(`check: ${g.check}`)
    if (g?.expected) parts.push(`expected: ${g.expected}`)
    if (g?.actual) parts.push(`actual: ${g.actual}`)
    if (g?.remediation) parts.push(`remediation: ${g.remediation}`)
    if (g?.description && parts.length === 0) parts.push(g.description)
    const detail = parts.length > 0 ? parts.join(' | ') : 'no detail'
    return `- **${r.task_id}** (${r.ran_at ?? r.created_at ?? '?'}): ${detail}`
  }).join('\n')

  return `# Task: Cluster investigation — Verifier failure pattern

**Auto-generated by Atlas conductor** based on ${recentFails.length} Verifier failures within 30 minutes.

## Failed tasks

${failBullets}

## Multi-brain debate rationale

${debateResult.rationale ?? 'no rationale'}

Verdict: ${debateResult.verdict} → ${debateResult.chosen ?? 'no consensus'}

## Goal

Diagnose the common root cause across these failures. Hypotheses to check:
1. Recent migration broke a contract (look at \`supabase/migrations/\` HEAD)
2. Env var missing or rotated
3. Builder picked up a stale base — check \`git log --oneline\` since last green build
4. Verifier prompt regression — review \`verifier/src/verifiers/\`

## Acceptance criteria

1. A short ADR markdown in \`docs/atlas-decisions/\` describing the root cause.
2. If a fix is in scope, ship it as a follow-up task spec (not in this investigation).
3. If no fix is needed (false alarm), document why in the ADR and close.
`
}

async function pauseBuilder(reason: string): Promise<void> {
  // Pausing is implemented by writing a sentinel file the Builder runner can check.
  const sentinelPath = resolve(REPO_ROOT, '.agent/builder-paused')
  await mkdir(dirname(sentinelPath), { recursive: true }).catch(() => {})
  await writeFile(sentinelPath, `paused-by: atlas-conductor\nreason: ${reason}\nat: ${new Date().toISOString()}\n`, 'utf-8')
  await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `⏸️ Builder paused by Atlas conductor: ${reason}`)
}

// ─── 3. Designer audit on UI commits ────────────────────────────────────────

async function designerAuditOnUiCommits(state: ConductorState, trustMode: TrustMode): Promise<void> {
  if (trustMode === 'passive' || trustMode === 'stopped') return

  // Hydrate the in-memory dedup set from designer_runs so we don't re-audit
  // commits across container restarts. Without this, every Atlas redeploy
  // re-audits + re-queues remediation specs for the same SHAs in a loop.
  if (auditedCommits.size === 0) {
    try {
      const sb = getSupabaseClient()
      if (sb) {
        const { data } = await sb
          .from('designer_runs')
          .select('head_after')
          .order('created_at', { ascending: false })
          .limit(200)
        for (const row of data ?? []) {
          if (row.head_after) auditedCommits.add(row.head_after)
        }
        console.log(`[atlas-conductor] hydrated ${auditedCommits.size} audited commits from designer_runs`)
      }
    } catch (err) {
      console.error('[atlas-conductor] hydrate auditedCommits failed:', err)
    }
  }

  for (const commit of state.recentUiCommits) {
    if (auditedCommits.has(commit.sha)) continue
    // Also skip if a remediation spec already exists on disk (queued or in-progress).
    // Atlas may have audited but not yet recorded to designer_runs (e.g., audit failed
    // post-write). The spec file is the durable signal.
    const remediationFile = `phase-1-design-remediation-${commit.sha.slice(0, 8)}.md`
    const queuedPath = `${REPO_ROOT}/.agent/tasks/queued/${remediationFile}`
    const inProgressPath = `${REPO_ROOT}/.agent/tasks/in-progress/${remediationFile}`
    try {
      await access(queuedPath)
      auditedCommits.add(commit.sha)
      continue
    } catch {}
    try {
      await access(inProgressPath)
      auditedCommits.add(commit.sha)
      continue
    } catch {}
    auditedCommits.add(commit.sha)
    try {
      await designerAuditOnUiCommit(commit, trustMode)
    } catch (err) {
      console.error(`[atlas-conductor] designer audit failed for ${commit.sha}:`, err)
    }
  }
}

async function designerAuditOnUiCommit(
  commit: { sha: string; subject: string; changedFiles: string[] },
  trustMode: TrustMode,
): Promise<void> {
  const isUi = commit.changedFiles.some(f => /^src\/(pages|components|styles)/.test(f))
  if (!isUi) return

  const ok = await canSpendOnDebate(0.10)
  if (!ok) {
    console.log(`[atlas-conductor] designer audit on ${commit.sha} skipped — budget exhausted`)
    return
  }

  const result = await dispatch({
    tool: 'designer.audit_commit' as ToolName,
    arguments: { taskId: commit.sha, headBefore: `${commit.sha}^`, headAfter: commit.sha },
    initiatedBy: 'cron',
    trustMode: 'auto',
  })

  if (result.status !== 'success') {
    console.warn(`[atlas-conductor] designer unreachable or blocked for ${commit.sha}: ${result.error}`)
    return
  }

  const audit = result.result as { verdict?: string; gaps?: Array<Record<string, unknown>> } | undefined
  if (!audit || audit.verdict !== 'fail') return

  await logDecision({
    fork_question: `Designer audit fail: ${commit.sha.slice(0, 8)} (${commit.subject})`,
    options_considered: { proposed: audit.gaps },
    chosen_option: 'audit-fail',
    rationale: `Designer flagged ${audit.gaps?.length ?? 0} gaps`,
  })

  if (trustMode === 'chat') return // read-only

  if (trustMode === 'confirm') {
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `🎨 Designer flagged ${commit.sha.slice(0, 8)} (${commit.subject}): ${audit.gaps?.length ?? 0} gaps. Reply REMEDIATE ${commit.sha.slice(0, 8)} to queue fix.`,
    )
    return
  }

  // auto: queue a remediation spec.
  if (trustMode === 'auto') {
    await queueDesignRemediation(commit, audit.gaps ?? [])
  }
}

async function queueDesignRemediation(
  commit: { sha: string; subject: string },
  gaps: Array<Record<string, unknown>>,
): Promise<void> {
  const filename = `phase-1-design-remediation-${commit.sha.slice(0, 8)}.md`
  const body = `# Task: Design remediation — ${commit.sha.slice(0, 8)}

**Auto-generated by Atlas conductor** after Designer audit failed on commit ${commit.sha}.

**Original commit:** ${commit.subject}

## Gaps to fix

${gaps.map((g, i) => `${i + 1}. **[${g.severity ?? 'warn'}] ${g.check ?? 'unknown'}** — ${g.description ?? ''}\n   Fix: ${g.fix ?? 'see Designer report'}\n   Where: ${g.file ?? '?'}${g.line ? `:${g.line}` : ''}`).join('\n\n')}

## Acceptance criteria

1. All gaps above resolved or explicitly waived in the commit message.
2. \`npm run build\` clean.
3. Re-run Designer audit — verdict must be \`pass\`.
`

  await dispatch({
    tool: 'builder.queue_spec' as ToolName,
    arguments: { filename, body },
    initiatedBy: 'cron',
    trustMode: 'auto',
  })
  await sendWhatsAppReply(
    MUZAMMIL_WHATSAPP,
    `🎨 Design remediation queued for ${commit.sha.slice(0, 8)} (${gaps.length} gaps).`,
  )
}

async function getRecentUiCommits(limit: number): Promise<Array<{ sha: string; subject: string; changedFiles: string[] }>> {
  return withGitLock('conductor:get-recent-ui-commits', async () => {
    try {
      const { stdout } = await execFileP(
        'git',
        ['log', `-n`, String(limit), '--pretty=format:%H%x09%s'],
        { cwd: REPO_ROOT },
      )
      const commits = stdout.split('\n').filter(Boolean).map(line => {
        const [sha, subject] = line.split('\t')
        return { sha, subject: subject ?? '' }
      })
      const enriched: Array<{ sha: string; subject: string; changedFiles: string[] }> = []
      for (const c of commits) {
        try {
          const { stdout: files } = await execFileP(
            'git',
            ['show', '--name-only', '--pretty=format:', c.sha],
            { cwd: REPO_ROOT },
          )
          enriched.push({ ...c, changedFiles: files.split('\n').filter(Boolean) })
        } catch {
          enriched.push({ ...c, changedFiles: [] })
        }
      }
      return enriched
    } catch (err) {
      console.warn('[atlas-conductor] git log failed:', err)
      return []
    }
  })
}

// ─── 4. Self-heal stuck Builder ─────────────────────────────────────────────

async function selfHealStuckBuilder(state: ConductorState, trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto' && trustMode !== 'confirm') return

  const snapshots = state.recentSnapshots.slice(0, 6)
  if (snapshots.length < 6) return // Not enough history.
  const allSameQueue = snapshots.every(s => (s.queued_specs as number) === (snapshots[0].queued_specs as number))
  const allEmptyInFlight = snapshots.every(s => (s.in_flight_specs as number) === 0)
  if (!allSameQueue || !allEmptyInFlight || state.queued.length === 0) return

  await sendWhatsAppReply(
    MUZAMMIL_WHATSAPP,
    `🔧 Builder appears stuck for 30+ min (queue=${state.queued.length}, in-flight=0). ${trustMode === 'auto' ? 'Attempting auto-restart.' : 'Manual intervention needed.'}`,
  )

  await logDecision({
    fork_question: 'Builder stuck 30+ min',
    options_considered: { proposed: 'auto-restart' },
    chosen_option: trustMode === 'auto' ? 'auto-restart' : 'pinged-user',
    rationale: `queued=${state.queued.length}, in-flight=0 across 6 snapshots`,
  })

  if (trustMode !== 'auto') return

  if (RAILWAY_API_TOKEN && RAILWAY_BUILDER_SERVICE_ID) {
    try {
      await railwayRestartService(RAILWAY_BUILDER_SERVICE_ID)
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `✅ Railway restart triggered for cropsintel-agent.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `⚠️ Railway auto-restart failed: ${msg}. Please redeploy manually.`)
    }
  } else {
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `⚠️ No RAILWAY_API_TOKEN/RAILWAY_BUILDER_SERVICE_ID — please manually redeploy cropsintel-agent on Railway.`,
    )
  }
}

async function railwayRestartService(serviceId: string): Promise<void> {
  if (!RAILWAY_API_TOKEN) throw new Error('RAILWAY_API_TOKEN not set')
  if (!RAILWAY_ENVIRONMENT_ID) throw new Error('RAILWAY_ENVIRONMENT_ID not set')
  const query = `mutation ServiceRestart($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID } }),
  })
  if (!res.ok) {
    throw new Error(`Railway API ${res.status}: ${await res.text()}`)
  }
  const json = await res.json() as { errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new Error(`Railway API error: ${json.errors.map(e => e.message).join('; ')}`)
  }
}

// ─── 5. Idle queue → suggest next phase ─────────────────────────────────────

async function suggestNextPhase(state: ConductorState, trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto' && trustMode !== 'confirm') return

  const userIdleMin = state.lastUserMsg
    ? (state.now.getTime() - new Date(state.lastUserMsg.created_at).getTime()) / 60000
    : 999999
  const queueEmpty = state.queued.length === 0 && state.inProgress.length === 0
  if (userIdleMin < 240 || !queueEmpty) return
  if (!isWorkHours(state.now)) return

  // Throttle: only suggest once per heartbeat cycle window. Use a sentinel
  // checked via the last decision to avoid a daily flood of suggestions.
  const lastSuggestion = await readLastSuggestion()
  if (lastSuggestion && Date.now() - lastSuggestion.getTime() < 4 * 3600 * 1000) return

  const ok = await canSpendOnDebate(0.05)
  if (!ok) return

  let masterPlanContext = ''
  try {
    const memResult = await dispatch({
      tool: 'memory.search' as ToolName,
      arguments: { query: 'master plan phase 1 next' },
      initiatedBy: 'cron',
      trustMode: 'auto',
    })
    const chunks = (memResult.result as { chunks?: Array<{ content?: string }> } | undefined)?.chunks
    masterPlanContext = chunks?.[0]?.content?.slice(0, 1500) ?? ''
  } catch (err) {
    console.warn('[atlas-conductor] memory.search failed for next-phase suggestion:', err)
  }

  const recommendation = await simple(
    `Given current done specs and master plan:
${masterPlanContext}

What's the single most logical next phase to open? One sentence answer with phase number.`,
  )

  await logDecision({
    fork_question: 'Idle queue 4h+ — suggest next phase',
    options_considered: { proposed: recommendation.content.slice(0, 200) },
    chosen_option: 'suggested',
    rationale: `userIdleMin=${Math.round(userIdleMin)}, recommendation=${recommendation.content.slice(0, 200)}`,
  })

  await sendWhatsAppReply(
    MUZAMMIL_WHATSAPP,
    `🟢 Queue idle 4h+. Atlas suggests: ${truncate(recommendation.content, 400)}. Reply YES to queue, or tell me a different phase.`,
  )
}

async function readLastSuggestion(): Promise<Date | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb
    .from('atlas_decisions')
    .select('decided_at')
    .eq('fork_question', 'Idle queue 4h+ — suggest next phase')
    .order('decided_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.decided_at ? new Date(data.decided_at as string) : null
}

function isWorkHours(now: Date): boolean {
  const day = now.getUTCDay() // 0=Sun..6=Sat
  // Asia/Dubai is UTC+4. Workweek there is Mon–Fri.
  const dubaiHour = (now.getUTCHours() + 4) % 24
  const isWeekday = day >= 1 && day <= 5
  return isWeekday && dubaiHour >= 9 && dubaiHour <= 22
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function canSpendOnDebate(estimatedCostUsd: number): Promise<boolean> {
  const check = await checkBudget(estimatedCostUsd)
  if (!check.allow) {
    console.warn(`[atlas-conductor] budget gate blocked spend $${estimatedCostUsd}: ${check.reason}`)
  }
  return check.allow
}

async function logDecision(row: {
  fork_question: string
  options_considered: Record<string, unknown>
  multi_brain_votes?: unknown
  chosen_option: string
  rationale: string
}): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  try {
    await sb.from('atlas_decisions').insert({
      ...row,
      decided_by: 'atlas-conductor',
    })
  } catch (err) {
    console.error('[atlas-conductor] logDecision failed:', err)
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

async function snapshotOnly(): Promise<void> {
  const { runSnapshot } = await import('./snapshot.js')
  await runSnapshot()
}

// ─── 1.10ax: heartbeats for the non-Builder agents ──────────────────────────
//
// Builder pushes its own state from agent-loop.sh. The other six agents don't,
// so the conductor writes on their behalf based on /health + recent activity.
// Atlas writes its own row directly (it's running this code).

interface AgentProbe {
  agent: string
  healthUrl: string | null
  recentActivity: () => Promise<boolean>
}

async function writeNonBuilderHeartbeats(): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return

  const probes: AgentProbe[] = [
    {
      agent: 'atlas',
      healthUrl: null,
      recentActivity: async () => true,
    },
    {
      agent: 'verifier',
      healthUrl: process.env.VERIFIER_URL ? `${process.env.VERIFIER_URL.replace(/\/$/, '')}/health` : null,
      recentActivity: () => recentActivityIn(sb, 'verifier_runs', 'ran_at'),
    },
    {
      agent: 'designer',
      healthUrl: process.env.DESIGNER_URL ? `${process.env.DESIGNER_URL.replace(/\/$/, '')}/health` : null,
      recentActivity: () => recentActivityIn(sb, 'designer_runs', 'created_at'),
    },
    {
      agent: 'memory',
      healthUrl: null,
      recentActivity: () => recentActivityIn(sb, 'memory_chunks', 'created_at'),
    },
    {
      agent: 'council',
      healthUrl: null,
      recentActivity: () => recentActivityIn(sb, 'atlas_decisions', 'decided_at'),
    },
    {
      agent: 'adela',
      healthUrl: process.env.ADELA_URL ? `${process.env.ADELA_URL.replace(/\/$/, '')}/health` : null,
      recentActivity: async () => false,
    },
  ]

  for (const probe of probes) {
    let state: 'idle' | 'running' | 'unreachable' = 'idle'
    if (probe.healthUrl) {
      try {
        const res = await fetch(probe.healthUrl, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) state = 'unreachable'
      } catch {
        state = 'unreachable'
      }
    }
    if (state === 'idle') {
      try {
        const recent = await probe.recentActivity()
        if (recent) state = 'running'
      } catch {
        // leave as idle
      }
    }

    try {
      await sb.from('atlas_agent_heartbeats').upsert({
        agent: probe.agent,
        state,
        task: null,
        elapsed_s: 0,
        msg: state === 'unreachable' ? 'health probe failed' : (state === 'running' ? 'recent activity' : 'no recent activity'),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent' })
    } catch (err) {
      console.warn(`[atlas-conductor] heartbeat upsert failed for ${probe.agent}:`, err)
    }
  }
}

async function recentActivityIn(
  sb: ReturnType<typeof getSupabaseClient>,
  table: string,
  tsCol: string,
): Promise<boolean> {
  if (!sb) return false
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { count } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(tsCol, fiveMinAgo)
  return (count ?? 0) > 0
}

// ─── 6. Queue intelligence — priority inversion detection ───────────────────
//
// "Inversion" = a queued spec exists with priority lower (more urgent) than the
// current head spec, but it's NOT the head because it arrived later
// alphabetically. Atlas should bump it to the head.
//
// Debounce: don't act on the same inversion (same set of spec ids) more than
// once per 30 min, to prevent fight-with-self loops.

interface InversionRecord { key: string; ts: number }
const recentInversions: InversionRecord[] = []
const INVERSION_DEBOUNCE_MS = 30 * 60 * 1000

async function reorderQueueIfPriorityInversion(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto' && trustMode !== 'confirm') return
  let order: Awaited<ReturnType<typeof builderQueueOrder>>['order']
  try {
    const result = await builderQueueOrder()
    order = result.order
  } catch (err) {
    console.warn('[atlas-conductor] queue_order failed:', err)
    return
  }
  // Only inspect non-blocked specs for inversions. The "head" is the first non-blocked spec.
  const candidates = order.filter(s => !s.blocked)
  if (candidates.length < 2) return
  const head = candidates[0]
  // Find a deeper spec with strictly lower priority than the head — that's an inversion.
  const inverted = candidates.slice(1).find(s => s.priority < head.priority)
  if (!inverted) return

  const key = `${inverted.id}->${head.id}`
  pruneOldInversions()
  if (recentInversions.some(r => r.key === key)) {
    console.log(`[atlas-conductor] inversion ${key} already debounced — skipping`)
    return
  }
  recentInversions.push({ key, ts: Date.now() })

  await logDecision({
    fork_question: `Priority inversion: ${inverted.id} (p${inverted.priority}) ranked behind ${head.id} (p${head.priority})`,
    options_considered: { proposed: 'bump-to-head', head: head.id, victim: inverted.id },
    chosen_option: trustMode === 'auto' ? 'auto-bumped' : 'pinged-user',
    rationale: `${inverted.id} has lower priority number than current head; would ship sooner if reordered`,
  })

  if (trustMode === 'confirm') {
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `🔀 Queue inversion: ${inverted.id} (p${inverted.priority}) is queued behind ${head.id} (p${head.priority}). Reply BUMP ${inverted.id} to promote.`,
    )
    return
  }

  // auto: bump the inverted spec one notch ahead of the head's priority.
  // Never auto-promote to priority=1 — reserved for explicit user direction
  // unless the spec was already priority 1 (in which case the inversion is
  // about an even-lower-priority head, which shouldn't happen but we
  // tolerate by leaving priority alone).
  const newPriority = Math.max(1, Math.min(inverted.priority, head.priority - 1))
  if (newPriority === inverted.priority) {
    console.log(`[atlas-conductor] inversion ${key} would require no priority change — skipping`)
    return
  }
  try {
    await dispatch({
      tool: 'builder.set_priority' as ToolName,
      arguments: { taskId: inverted.id, priority: newPriority },
      initiatedBy: 'cron',
      trustMode: 'auto',
    })
    await sendWhatsAppReply(
      MUZAMMIL_WHATSAPP,
      `🔀 Queue reorder: bumped ${inverted.id} to priority=${newPriority} (was p${inverted.priority}, sat behind ${head.id} p${head.priority}).`,
    )
  } catch (err) {
    console.error('[atlas-conductor] reorder dispatch failed:', err)
  }
}

function pruneOldInversions(): void {
  const cutoff = Date.now() - INVERSION_DEBOUNCE_MS
  while (recentInversions.length > 0 && recentInversions[0].ts < cutoff) {
    recentInversions.shift()
  }
}

// ─── 8. Workflow-trace invariants (1.10ad) ─────────────────────────────────
//
// Each heartbeat, verify the 7-agent choreography actually fired for recent
// ships: verifier audit within 5 min, designer audit within 5 min for UI
// commits, memory.ingest within 10 min. Fresh violations log to atlas_decisions
// and ping WhatsApp so degradation surfaces fast.

async function checkWorkflowTraceAndPing(trustMode: TrustMode): Promise<void> {
  if (trustMode === 'stopped') return
  let violations: WorkflowTraceViolation[]
  try {
    violations = await checkWorkflowTraceInvariants({ repoRoot: REPO_ROOT })
  } catch (err) {
    console.warn('[atlas-conductor] checkWorkflowTraceInvariants failed:', err)
    return
  }
  const fresh = consumeNewWorkflowViolations(violations)
  if (fresh.length === 0) return

  for (const v of fresh) {
    await logDecision({
      fork_question: `Workflow-trace invariant violated: ${v.invariant}`,
      options_considered: { commit_sha: v.commit_sha, commit_subject: v.commit_subject, age_minutes: v.age_minutes },
      chosen_option: 'logged',
      rationale: v.description,
    })
  }

  // Single batched WhatsApp message to avoid spamming
  if (trustMode !== 'passive' && trustMode !== 'chat') {
    const summary = fresh.length === 1
      ? `🚨 Workflow trace gap: ${fresh[0].invariant} on ${fresh[0].commit_sha.slice(0, 8)} (${truncate(fresh[0].commit_subject, 60)}). ${truncate(fresh[0].description, 200)}`
      : `🚨 ${fresh.length} workflow trace gaps detected:\n${fresh.map(v => `- ${v.invariant} on ${v.commit_sha.slice(0, 8)}`).join('\n')}\nSee atlas_decisions for detail.`
    try {
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, summary)
    } catch (err) {
      console.warn('[atlas-conductor] whatsapp ping for workflow-trace violation failed:', err)
    }
  }
}

// ─── Phase 1.10aw-rem — task-done WhatsApp notification ────────────────────
//
// Opt-in outbound ping fired once per ship-commit when WHATSAPP_NOTIFY_NUMBER
// is set. We dedupe per commit-sha so re-running the heartbeat inside the
// 6-min look-back window doesn't double-ping. Always uses the auto-split
// helper so multi-line ship summaries stay under Twilio's 1600-char cap.
//
// Caller contract:
//  - returns void; never throws (errors logged + swallowed)
//  - no-op if WHATSAPP_NOTIFY_NUMBER is empty
//  - safe to call concurrently — Set.add() is atomic under Node's single
//    event-loop, and dispatch is at-most-once per (to, sha) tuple.
const notifiedShipShas = new Set<string>()

export async function notifyWhatsApp(to: string, message: string): Promise<void> {
  if (!to) return
  try {
    const result = await sendWhatsAppReplyAutoSplit(to, message)
    if (result.errors.length > 0) {
      console.warn('[atlas-conductor] notifyWhatsApp partial failure:', result.errors.join('; '))
    }
  } catch (err) {
    // NEVER list compliance: don't let an outbound notification error
    // propagate up the conductor heartbeat.
    console.warn('[atlas-conductor] notifyWhatsApp threw (suppressed):', err instanceof Error ? err.message : err)
  }
}

// Sibling of memoryIngestAfterShips / verifierAuditAfterShips. Walks the same
// 6-min commit window for ship subjects (matched via the shared
// extractTaskIdFromShipSubject helper) and pings WHATSAPP_NOTIFY_NUMBER once
// per new commit-sha. Never modifies the existing post-ship passes.
async function notifyTaskDoneAfterShips(trustMode: TrustMode): Promise<void> {
  if (!WHATSAPP_NOTIFY_NUMBER) return
  // Same trust-mode envelope as the rest of the post-ship passes — passive /
  // stopped trust modes don't emit outbound WhatsApp work.
  if (trustMode === 'stopped' || trustMode === 'passive') return

  let stdout: string
  try {
    const result = await withGitLock('conductor:ship-notify-log', () => execFileP(
      'git',
      ['log', '--since=6 minutes ago', '--pretty=format:%H%x09%s'],
      { cwd: REPO_ROOT },
    ))
    stdout = result.stdout
  } catch (err) {
    console.warn('[atlas-conductor] git log for ship-notify failed:', err)
    return
  }
  const lines = stdout.split('\n').filter(Boolean)
  if (lines.length === 0) return

  const shipEntries: Array<{ sha: string; taskId: string }> = []
  for (const line of lines) {
    const [sha, subj] = line.split('\t')
    if (!sha || !subj) continue
    const taskId = extractTaskIdFromShipSubject(subj)
    if (taskId) shipEntries.push({ sha, taskId })
  }
  if (shipEntries.length === 0) return

  const fresh = shipEntries.filter(e => !notifiedShipShas.has(e.sha))
  if (fresh.length === 0) return
  for (const entry of fresh) notifiedShipShas.add(entry.sha)
  // Cap dedup set at 200 entries — shipEntries arrive in 6-min windows, so
  // even at 50 ships/hr we'd never approach this organically.
  if (notifiedShipShas.size > 200) {
    const first = notifiedShipShas.values().next().value
    if (first !== undefined) notifiedShipShas.delete(first)
  }

  const summaryLines = fresh.map(e => `• ${e.taskId} (${e.sha.slice(0, 8)})`)
  const body = fresh.length === 1
    ? `✅ Task shipped: ${fresh[0].taskId}\nCommit: ${fresh[0].sha.slice(0, 8)}`
    : `✅ ${fresh.length} tasks shipped:\n${summaryLines.join('\n')}`
  await notifyWhatsApp(WHATSAPP_NOTIFY_NUMBER, body)
  console.log(`[atlas-conductor] notifyWhatsApp sent for ${fresh.length} ship commit(s) → ${WHATSAPP_NOTIFY_NUMBER}`)
}

// ─── 7. Memory ingest after every ship ──────────────────────────────────────
// After Builder ships a spec, the relevant commits land on origin/main. Memory
// only sees them on its next manual ingest call. We bridge the gap by firing
// memory.ingest('github-history') whenever recent commits include a
// "X → done" or "feat: phase-* (autonomous agent...)" message.
// Memory dedupes by commit SHA, so re-firing within the heartbeat window is safe.

const ingestedCommitWindows = new Set<string>()

async function memoryIngestAfterShips(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto') return // confirm/chat: stay passive on memory
  // Look at commits in roughly the last heartbeat window.
  let stdout: string
  try {
    const result = await withGitLock('conductor:ship-detect-log', () => execFileP(
      'git',
      ['log', '--since=6 minutes ago', '--pretty=format:%H%x09%s'],
      { cwd: REPO_ROOT },
    ))
    stdout = result.stdout
  } catch (err) {
    console.warn('[atlas-conductor] git log for ship-detect failed:', err)
    return
  }
  const lines = stdout.split('\n').filter(Boolean)
  if (lines.length === 0) return
  const shipCommits = lines.filter(l => {
    const subj = l.split('\t')[1] ?? ''
    return /chore\(agent\):.* → done/.test(subj) || /^feat:.*\(autonomous agent/.test(subj)
  })
  if (shipCommits.length === 0) return
  // Dedupe per heartbeat: a single window (set of SHAs) only triggers one ingest call.
  const windowKey = shipCommits.map(l => l.split('\t')[0]).sort().join(',')
  if (ingestedCommitWindows.has(windowKey)) return
  ingestedCommitWindows.add(windowKey)
  // Cap memory of windows to last 50 to prevent unbounded growth.
  if (ingestedCommitWindows.size > 50) {
    const first = ingestedCommitWindows.values().next().value
    if (first !== undefined) ingestedCommitWindows.delete(first)
  }
  // Three sources fire in sequence after each ship window:
  //   github-history — commits & PR bodies (existing behavior)
  //   agent-history  — verifier_runs + designer_runs failures (audit C1a)
  //   adrs           — architecture_decisions Council writes during draft
  // Together they close the loop: spec-draft (C1b) pulls "we already failed
  // on this scope" AND "we already debated this decision" before Council
  // writes a fresh spec. ADR ingest runs even when no new ADR exists — the
  // dedup in embedAndStore makes it a no-op cost (~$0.001) on idle windows.
  for (const source of ['github-history', 'agent-history', 'adrs'] as const) {
    try {
      await dispatch({
        tool: 'memory.ingest' as ToolName,
        arguments: { source },
        initiatedBy: 'cron',
        trustMode: 'auto',
      })
      console.log(`[atlas-conductor] memory.ingest(${source}) fired after ${shipCommits.length} ship commit(s)`)
    } catch (err) {
      console.warn(`[atlas-conductor] memory.ingest(${source}) after-ship dispatch failed:`, err)
    }
  }
}

// After Builder ships a spec, the verifier_runs row for that spec might
// still be from a pre-ship audit (when the implementation files didn't exist
// yet). Without an explicit recheck, that fail row persists forever — every
// future audit-feed read sees an old failure for a task that has actually
// been completed, and the diagnose-batch endpoint keeps generating
// fix-prompts demanding files that already exist.
//
// This pass extracts task_ids from ship-commit subjects and re-runs verifier
// at the new HEAD. The fresh verifier_runs row supersedes the old one via
// the latest-per-task dedup at /atlas/verifier/runs.

const recheckedShipWindows = new Set<string>()

function extractTaskIdFromShipSubject(subject: string): string | null {
  // Match "feat: phase-X.Y-name (autonomous agent...)"
  const featMatch = subject.match(/^feat:\s+(phase-[a-z0-9.-]+?)(?:\s+\(autonomous|\s*$|\s+—|\s+-)/i)
  if (featMatch) return featMatch[1]
  // Match "chore(agent): phase-X.Y-name → done"
  const choreMatch = subject.match(/chore\(agent\):\s*(phase-[a-z0-9.-]+?)\s*→\s*done/i)
  if (choreMatch) return choreMatch[1]
  return null
}

async function verifierAuditAfterShips(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto') return
  let stdout: string
  try {
    const result = await withGitLock('conductor:ship-recheck-log', () => execFileP(
      'git',
      ['log', '--since=6 minutes ago', '--pretty=format:%H%x09%s'],
      { cwd: REPO_ROOT },
    ))
    stdout = result.stdout
  } catch (err) {
    console.warn('[atlas-conductor] git log for ship-recheck failed:', err)
    return
  }
  const lines = stdout.split('\n').filter(Boolean)
  if (lines.length === 0) return

  // Pull (commit_sha, task_id) for each ship commit. Skip commits we can't
  // parse a task_id from.
  const shipEntries: Array<{ sha: string; taskId: string }> = []
  for (const line of lines) {
    const [sha, subj] = line.split('\t')
    if (!sha || !subj) continue
    const taskId = extractTaskIdFromShipSubject(subj)
    if (taskId) shipEntries.push({ sha, taskId })
  }
  if (shipEntries.length === 0) return

  // Phase 6: flip 'queued' atlas_build_attempts to 'shipped' for each detected
  // ship. Done before the recheck loop so the shipped row is observable even
  // if the recheck takes a few cycles.
  await markBuildAttemptsAsShipped(shipEntries)

  const windowKey = shipEntries.map(e => `${e.sha}:${e.taskId}`).sort().join(',')
  if (recheckedShipWindows.has(windowKey)) return
  recheckedShipWindows.add(windowKey)
  if (recheckedShipWindows.size > 50) {
    const first = recheckedShipWindows.values().next().value
    if (first !== undefined) recheckedShipWindows.delete(first)
  }

  // Only recheck tasks whose latest verifier_runs row is still a fail. If
  // the autonomous Builder loop already wrote a passing row for the new
  // commit, the dedup feed will hide the old fail without our help.
  const sb = getSupabaseClient()
  if (!sb) return

  for (const { sha, taskId } of shipEntries) {
    try {
      const { data } = await sb
        .from('verifier_runs')
        .select('passed, ran_at, commit_sha')
        .eq('task_id', taskId)
        .order('ran_at', { ascending: false })
        .limit(1)
      const latest = (data ?? [])[0] as { passed: boolean | null; commit_sha: string | null } | undefined
      if (!latest) continue
      if (latest.passed === true) continue
      // If the latest fail was already against this exact commit, no point
      // rechecking — the audit ran against the post-ship state and still
      // failed. Operators should look at the row, not auto-rerun.
      if (latest.commit_sha === sha) continue

      await dispatch({
        tool: 'verifier.audit' as ToolName,
        arguments: { taskId, headBefore: latest.commit_sha ?? sha, headAfter: sha },
        initiatedBy: 'cron',
        trustMode: 'auto',
      })
      console.log(`[atlas-conductor] verifier.audit(${taskId} @ ${sha.slice(0, 8)}) fired post-ship — superseding stale fail`)
    } catch (err) {
      console.warn(`[atlas-conductor] post-ship verifier audit for ${taskId} failed:`, err instanceof Error ? err.message : err)
    }
  }
}

// H.3: per-spec zombie detector. selfHealStuckBuilder above handles "Builder
// is completely idle" (queue full, in-flight=0). This pass handles the
// orthogonal case: a SPECIFIC spec stuck in in-progress/ for >60 min while
// Builder may still be making progress on other specs. The lifecycle move
// (.agent/tasks/in-progress/X.md → done/ or failed/) sometimes doesn't fire
// when Builder ships 0 files — the spec file orphans in in-progress/.
//
// Behavior:
//   - Read .agent/tasks/in-progress/, stat each .md file.
//   - If mtime is >ZOMBIE_THRESHOLD_MIN old, flag it as a zombie.
//   - Dedup against pingedZombies Map (timestamp-keyed; re-pings after 6h
//     for genuinely-still-stuck specs).
//   - WhatsApp-ping the user with the list + force-cancel guidance.
//
// Action stays manual: the user uses the Queue tab's force-cancel button
// (H.2) or tells Atlas "force-cancel <id>" (H.1's chat tool). We don't
// auto-cancel because some specs LEGITIMATELY take >60 min (big migrations).
const ZOMBIE_THRESHOLD_MIN = parseInt(process.env.ATLAS_ZOMBIE_THRESHOLD_MIN ?? '60', 10)
const ZOMBIE_REPING_HOURS = 6

async function detectInProgressZombies(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto' && trustMode !== 'confirm') return

  const inProgressDir = resolve(REPO_ROOT, '.agent/tasks/in-progress')
  const files = await readdir(inProgressDir).catch(() => [] as string[])
  const candidates = files.filter(f => f.endsWith('.md') && f !== '_template.md')
  if (candidates.length === 0) return

  const now = Date.now()
  const zombies: Array<{ taskId: string; ageMin: number }> = []
  for (const file of candidates) {
    try {
      const s = await stat(resolve(inProgressDir, file))
      const ageMin = Math.floor((now - s.mtime.getTime()) / 60_000)
      if (ageMin >= ZOMBIE_THRESHOLD_MIN) {
        zombies.push({ taskId: file.replace(/\.md$/, ''), ageMin })
      }
    } catch { /* skip unreadable files */ }
  }
  if (zombies.length === 0) return

  // Filter against the dedup Map: skip taskIds we've pinged within the
  // re-ping window. Refresh the timestamp on the others.
  const repingMs = ZOMBIE_REPING_HOURS * 3600_000
  const newZombies = zombies.filter(z => {
    const last = pingedZombies.get(z.taskId)
    return last === undefined || (now - last) > repingMs
  })
  if (newZombies.length === 0) return

  for (const z of newZombies) pingedZombies.set(z.taskId, now)
  // Cap the Map size so it doesn't grow unbounded across many days.
  if (pingedZombies.size > 200) {
    const oldest = [...pingedZombies.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) pingedZombies.delete(oldest[0])
  }

  // Sort newest-first so the user sees the freshest zombies at top.
  newZombies.sort((a, b) => b.ageMin - a.ageMin)
  const lines = newZombies.slice(0, 10).map(z => `• ${z.taskId} (${z.ageMin}m)`)
  const more = newZombies.length > 10 ? `\n…and ${newZombies.length - 10} more` : ''
  const msg = [
    `Atlas zombie alert — ${newZombies.length} spec${newZombies.length === 1 ? '' : 's'} stuck in in-progress/ for ≥${ZOMBIE_THRESHOLD_MIN} min:`,
    ...lines,
    more,
    '',
    'Recover via the Queue tab (force-cancel button on the row), or tell me in chat: "force-cancel <taskId>".',
  ].filter(Boolean).join('\n')

  try {
    await sendWhatsAppReply(MUZAMMIL_WHATSAPP, msg)
  } catch (err) {
    console.warn('[atlas-conductor] zombie WhatsApp ping failed:', err)
  }

  await logDecision({
    fork_question: `${newZombies.length} in-progress zombies detected`,
    options_considered: { zombies: newZombies.map(z => `${z.taskId}(${z.ageMin}m)`) },
    chosen_option: 'pinged-user',
    rationale: `User-action required: force-cancel via Queue tab or chat`,
  }).catch(() => { /* non-fatal */ })
}

// Phase 1.10ag: zombie reaper — moves dead in-progress/ specs to failed/.
// Distinct from detectInProgressZombies (which only WhatsApp-pings the user
// at 60min): the reaper is heartbeat-aware and acts on its own at 30min when
// it's confident Builder isn't actually working the spec.
//
// Decision matrix:
//   - in-progress mtime is fresh (<REAPER_THRESHOLD_MIN)         → leave alone.
//   - mtime is old AND builder_heartbeat.spec_id matches AND     → leave alone
//     heartbeat is fresh (<HEARTBEAT_FRESH_SECONDS)                (still working).
//   - mtime is old AND heartbeat is stale OR points elsewhere    → REAP to failed/.
//
// Side effects: moves the file, prepends frontmatter recording the reap, then
// commits + pushes through withGitLock so we don't collide with the autofix
// lifecycle pass or chat tools.
const REAPER_THRESHOLD_MIN = parseInt(process.env.ATLAS_REAPER_THRESHOLD_MIN ?? '30', 10)
const HEARTBEAT_FRESH_SECONDS = parseInt(process.env.ATLAS_REAPER_HEARTBEAT_FRESH_SECONDS ?? '120', 10)

interface BuilderHeartbeatRow {
  spec_id: string | null
  beat_at: string | null
  state?: string | null
}

async function readBuilderHeartbeatForReaper(): Promise<{ spec_id: string | null; ageSeconds: number }> {
  const sb = getSupabaseClient()
  if (!sb) return { spec_id: null, ageSeconds: Number.POSITIVE_INFINITY }
  try {
    const { data } = await sb.from('atlas_config').select('value').eq('key', 'builder_heartbeat').maybeSingle()
    if (!data) return { spec_id: null, ageSeconds: Number.POSITIVE_INFINITY }
    let parsed: BuilderHeartbeatRow = { spec_id: null, beat_at: null }
    try { parsed = JSON.parse(String(data.value ?? '{}')) as BuilderHeartbeatRow } catch { /* malformed */ }
    const ageSeconds = parsed.beat_at
      ? Math.max(0, Math.floor((Date.now() - new Date(parsed.beat_at).getTime()) / 1000))
      : Number.POSITIVE_INFINITY
    return { spec_id: parsed.spec_id ?? null, ageSeconds }
  } catch (err) {
    console.warn('[atlas-reaper] heartbeat read failed:', err instanceof Error ? err.message : err)
    return { spec_id: null, ageSeconds: Number.POSITIVE_INFINITY }
  }
}

async function reapZombieSpecs(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto' && trustMode !== 'confirm') return

  const inProgressDir = resolve(REPO_ROOT, '.agent/tasks/in-progress')
  const failedDir = resolve(REPO_ROOT, '.agent/tasks/failed')
  const files = await readdir(inProgressDir).catch(() => [] as string[])
  const candidates = files.filter(f => f.endsWith('.md') && f !== '_template.md')
  if (candidates.length === 0) return

  const heartbeat = await readBuilderHeartbeatForReaper()
  const now = Date.now()

  type ToReap = { taskId: string; file: string; ageMinutes: number; heartbeatAgeSeconds: number }
  const toReap: ToReap[] = []
  for (const file of candidates) {
    let s
    try { s = await stat(resolve(inProgressDir, file)) } catch { continue }
    const ageMinutes = (now - s.mtime.getTime()) / 60_000
    const taskId = file.replace(/\.md$/, '')
    const isHeartbeating = heartbeat.spec_id === taskId && heartbeat.ageSeconds < HEARTBEAT_FRESH_SECONDS
    if (isHeartbeating) continue
    if (ageMinutes >= REAPER_THRESHOLD_MIN) {
      toReap.push({ taskId, file, ageMinutes, heartbeatAgeSeconds: heartbeat.ageSeconds })
    }
  }
  if (toReap.length === 0) return

  await mkdir(failedDir, { recursive: true }).catch(() => { /* exists */ })

  for (const z of toReap) {
    const fromRel = `.agent/tasks/in-progress/${z.file}`
    const toRel = `.agent/tasks/failed/${z.file}`
    const fromPath = resolve(REPO_ROOT, fromRel)
    const toPath = resolve(REPO_ROOT, toRel)

    let original = ''
    try { original = await readFile(fromPath, 'utf-8') } catch { continue }

    const reapedFrontmatter = [
      '---',
      `reaped_at: ${new Date().toISOString()}`,
      `reaped_reason: zombie — exceeded ${REAPER_THRESHOLD_MIN}min in in-progress with no Builder heartbeat`,
      `builder_heartbeat_age_seconds: ${Number.isFinite(z.heartbeatAgeSeconds) ? Math.floor(z.heartbeatAgeSeconds) : 'infinity'}`,
      `reaped_age_minutes: ${z.ageMinutes.toFixed(1)}`,
      '---',
      '',
    ].join('\n')

    try {
      await writeFile(toPath, reapedFrontmatter + original, 'utf-8')
      await rm(fromPath).catch(() => { /* race */ })
    } catch (err) {
      console.warn(`[atlas-reaper] failed to move ${z.file}:`, err instanceof Error ? err.message : err)
      continue
    }

    try {
      await withGitLock(`reaper:${z.taskId}`, async () => {
        try { await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: REPO_ROOT }) } catch { /* keep going */ }
        try { await execFileP('git', ['add', fromRel, toRel], { cwd: REPO_ROOT }) } catch { /* ignore */ }
        try {
          await execFileP(
            'git',
            ['-c', 'user.name=Atlas', '-c', 'user.email=atlas@cropsintel.local', 'commit', '-m', `atlas: reaped zombie ${z.taskId} (${z.ageMinutes.toFixed(0)}m stuck)`],
            { cwd: REPO_ROOT },
          )
        } catch { /* nothing to commit */ }
        try { await execFileP('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT }) } catch (err) {
          console.warn('[atlas-reaper] push failed:', err instanceof Error ? err.message : err)
        }
      })
    } catch (err) {
      console.warn('[atlas-reaper] git op failed:', err instanceof Error ? err.message : err)
    }

    try {
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `⚰️ Reaper killed zombie: ${z.taskId} (${z.ageMinutes.toFixed(0)}m stuck)`)
    } catch (err) {
      console.warn('[atlas-reaper] WhatsApp ping failed:', err instanceof Error ? err.message : err)
    }

    await logDecision({
      fork_question: `Reap zombie ${z.taskId}`,
      options_considered: {
        ageMinutes: Number(z.ageMinutes.toFixed(1)),
        heartbeatAgeSeconds: Number.isFinite(z.heartbeatAgeSeconds) ? Math.floor(z.heartbeatAgeSeconds) : null,
        thresholdMin: REAPER_THRESHOLD_MIN,
      },
      chosen_option: 'reaped',
      rationale: 'in-progress mtime exceeded threshold and Builder heartbeat did not match this spec',
    }).catch(() => { /* non-fatal */ })
  }
}

// G.2: Auto-requeue passes — when verifier_runs has a recent passed=false
// row, inject the gaps back into a remediation spec and queue it. Reads
// the failed task's lineage from the task_id (-rem<N> suffix) to chain
// remediations safely. Caps at 3 attempts, then pings WhatsApp to escalate.
//
// Idempotency: requeueWithGaps already refuses to re-queue when the target
// remediation filename is already in queued/in-progress. The conductor
// also tracks autoRequeuedFailures to avoid log spam for failures it has
// already processed within the same cron lifecycle.
async function autoRequeueOnVerifierFail(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto' && trustMode !== 'confirm') return

  const sb = getSupabaseClient()
  if (!sb) return

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { data, error } = await sb
    .from('verifier_runs')
    .select('task_id, gaps, ran_at, commit_sha')
    .eq('passed', false)
    .gt('ran_at', oneHourAgo)
    .order('ran_at', { ascending: false })
    .limit(50)
  if (error) {
    console.warn('[atlas-conductor] auto-requeue verifier_runs query failed:', error.message)
    return
  }
  if (!data || data.length === 0) return

  // Dedup by task_id — keep only the most recent failure per task. Skip
  // failures we've already processed in this cron lifecycle.
  const latestByTask = new Map<string, { task_id: string; gaps: unknown; ran_at: string }>()
  for (const row of data as Array<{ task_id: string; gaps: unknown; ran_at: string }>) {
    if (!latestByTask.has(row.task_id)) latestByTask.set(row.task_id, row)
  }

  for (const row of latestByTask.values()) {
    const taskId = row.task_id
    const dedupeKey = `${taskId}@${row.ran_at}`
    if (autoRequeuedFailures.has(dedupeKey)) continue

    // Parse remediation lineage from task_id. ${X}-rem  → X, attempt 1.
    // ${X}-rem<N> → X, attempt N. Otherwise → X, attempt 0 (original).
    const remMatch = taskId.match(/^(.+)-rem(\d*)$/)
    const rootTaskId = remMatch ? remMatch[1] : taskId
    const currentAttempt = remMatch ? (parseInt(remMatch[2] || '1', 10) || 1) : 0
    const nextAttempt = currentAttempt + 1

    autoRequeuedFailures.add(dedupeKey)
    if (autoRequeuedFailures.size > 200) {
      const first = autoRequeuedFailures.values().next().value
      if (first !== undefined) autoRequeuedFailures.delete(first)
    }

    if (nextAttempt > 3) {
      console.warn(`[atlas-conductor] auto-requeue cap (3) exceeded for ${rootTaskId} — escalating via WhatsApp`)
      try {
        await sendWhatsAppReply(
          MUZAMMIL_WHATSAPP,
          `Atlas: ${rootTaskId} has failed 3 remediation attempts. Verifier still says fail. Manual review required.`,
        )
      } catch (err) {
        console.warn('[atlas-conductor] auto-requeue escalation WhatsApp failed:', err)
      }
      continue
    }

    try {
      const result = await requeueWithGaps({
        taskId: rootTaskId,
        gaps: (Array.isArray(row.gaps) ? row.gaps : []) as VerifierGap[],
        attempt: nextAttempt,
      })
      if (result.ok && result.filename) {
        if (result.reason && result.reason.includes('idempotent')) {
          // Already queued — fine, no log spam.
        } else {
          console.log(`[atlas-conductor] auto-requeued ${rootTaskId} as ${result.filename} (attempt ${nextAttempt}, sha ${result.sha?.slice(0, 8) ?? '—'})`)
        }
      } else if (!result.ok) {
        console.warn(`[atlas-conductor] auto-requeue refused for ${rootTaskId}: ${result.reason}`)
      }
    } catch (err) {
      console.warn(`[atlas-conductor] auto-requeue threw for ${rootTaskId}:`, err instanceof Error ? err.message : err)
    }
  }
}

// Phase 6 of agent-loop redesign — atlas_build_attempts state transitions.
//
// markBuildAttemptsAsShipped: when ship commits are detected, flip the most
// recent 'queued' row for each task_id to 'shipped' with shipped_at + the
// commit SHA recorded in the spec_filename's matching row. Best-effort.
//
// markVerifiedBuildAttempts: heartbeat pass that finds 'shipped' rows whose
// task_id has a passing verifier_runs row in the last hour, flips them to
// 'verified' + completed_at. Idempotent — only updates rows where verified_at
// IS NULL.
//
// Pair with the Phase 6b extension to memory/src/ingest/agent-history.ts that
// also pulls verified attempts so Memory's agent-history index records
// successful completions, not just failures.

async function markBuildAttemptsAsShipped(
  shipEntries: Array<{ sha: string; taskId: string }>,
): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return

  for (const { sha, taskId } of shipEntries) {
    try {
      // Find the most recent 'queued' (or 'planned') row for this task and flip
      // it. We accept 'planned' as a fallback for cases where builderQueueSpec
      // didn't get to flip planned → queued (network blip, race, etc.).
      const { data } = await sb
        .from('atlas_build_attempts')
        .select('id, status')
        .eq('task_id', taskId)
        .in('status', ['queued', 'planned'])
        .order('planned_at', { ascending: false })
        .limit(1)
      const row = (data ?? [])[0] as { id: string; status: string } | undefined
      if (!row) continue

      const { error } = await sb
        .from('atlas_build_attempts')
        .update({ status: 'shipped', shipped_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) {
        console.warn(
          `[atlas-conductor] failed to mark build_attempt ${row.id} as shipped: ${error.message}`,
        )
        continue
      }
      console.log(
        `[atlas-conductor] build_attempt ${row.id} (${taskId}) → shipped @ ${sha.slice(0, 8)}`,
      )
    } catch (err) {
      console.warn(
        `[atlas-conductor] markBuildAttemptsAsShipped error for ${taskId}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

async function markVerifiedBuildAttempts(trustMode: TrustMode): Promise<void> {
  if (trustMode !== 'auto') return
  const sb = getSupabaseClient()
  if (!sb) return

  // Find 'shipped' rows whose task_id has a passing verifier_runs row written
  // since shipped_at. The latest-per-task collapse on /atlas/verifier/runs
  // already considers a passing row authoritative, so this transition mirrors
  // what the audit-feed already shows.
  const { data: shippedRows } = await sb
    .from('atlas_build_attempts')
    .select('id, task_id, shipped_at')
    .eq('status', 'shipped')
    .is('verified_at', null)
    .order('shipped_at', { ascending: false })
    .limit(50)

  if (!shippedRows || shippedRows.length === 0) return

  for (const row of shippedRows as Array<{ id: string; task_id: string; shipped_at: string | null }>) {
    if (!row.shipped_at) continue
    try {
      const { data: vRows } = await sb
        .from('verifier_runs')
        .select('passed, ran_at')
        .eq('task_id', row.task_id)
        .gte('ran_at', row.shipped_at)
        .order('ran_at', { ascending: false })
        .limit(1)
      const latest = (vRows ?? [])[0] as { passed: boolean | null } | undefined
      if (!latest) continue
      if (latest.passed !== true) continue

      const nowIso = new Date().toISOString()
      const { error } = await sb
        .from('atlas_build_attempts')
        .update({ status: 'verified', verified_at: nowIso, completed_at: nowIso })
        .eq('id', row.id)
      if (error) {
        console.warn(
          `[atlas-conductor] failed to mark build_attempt ${row.id} as verified: ${error.message}`,
        )
        continue
      }
      console.log(
        `[atlas-conductor] build_attempt ${row.id} (${row.task_id}) → verified`,
      )
    } catch (err) {
      console.warn(
        `[atlas-conductor] markVerifiedBuildAttempts error for ${row.task_id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

// ─── 9. Auto-fix lifecycle pass (Phase 1.10aq) ─────────────────────────────
//
// Walks atlas_diagnosis_cache rows whose lifecycle_state is non-terminal:
//
//   auto-fix-queued → auto-fix-shipped:
//     The Builder ship-commit appears on origin/main referencing the queued
//     spec filename. We mark the row shipped + record commit sha.
//
//   auto-fix-shipped → auto-fix-resolved | auto-fix-failed:
//     After ≥30 min from ship, look at the latest verifier/designer audit on
//     the new commit. If the original gap (gap.check + gap.file) is no longer
//     present → resolved. If still present → failed; ping WhatsApp with the
//     escalation prompt.
//
// Wraps git ops in withGitLock so we don't collide with snapshot/builderList.

interface DiagnosisRow {
  id: string
  artifact_kind: string
  bucket: string
  result: Record<string, unknown> | null
  reason: string | null
  task_id: string | null
  commit_sha: string | null
  auto_fix_spec_filename: string | null
  auto_fix_commit_sha: string | null
  auto_fix_queued_at: string | null
  auto_fix_shipped_at: string | null
  lifecycle_state: string
  lifecycle_updated_at: string
}

async function autoFixLifecyclePass(trustMode: TrustMode): Promise<void> {
  if (trustMode === 'stopped' || trustMode === 'passive') return
  const sb = getSupabaseClient()
  if (!sb) return

  let queuedRows: DiagnosisRow[] = []
  let shippedRows: DiagnosisRow[] = []
  try {
    const queuedQ = await sb
      .from('atlas_diagnosis_cache')
      .select('id, artifact_kind, bucket, result, reason, task_id, commit_sha, auto_fix_spec_filename, auto_fix_commit_sha, auto_fix_queued_at, auto_fix_shipped_at, lifecycle_state, lifecycle_updated_at')
      .eq('lifecycle_state', 'auto-fix-queued')
    queuedRows = (queuedQ.data ?? []) as unknown as DiagnosisRow[]
    const shippedQ = await sb
      .from('atlas_diagnosis_cache')
      .select('id, artifact_kind, bucket, result, reason, task_id, commit_sha, auto_fix_spec_filename, auto_fix_commit_sha, auto_fix_queued_at, auto_fix_shipped_at, lifecycle_state, lifecycle_updated_at')
      .eq('lifecycle_state', 'auto-fix-shipped')
    shippedRows = (shippedQ.data ?? []) as unknown as DiagnosisRow[]
  } catch (err) {
    console.warn('[atlas-conductor] autoFixLifecyclePass query failed:', err)
    return
  }

  if (queuedRows.length === 0 && shippedRows.length === 0) return

  // Resolve queued → shipped: scan recent commits for the spec filename.
  for (const row of queuedRows) {
    if (!row.auto_fix_spec_filename) continue
    const taskKey = row.auto_fix_spec_filename.replace(/\.md$/, '')
    let stdout = ''
    try {
      const result = await withGitLock('autofix:detect-ship', () => execFileP(
        'git',
        ['log', '--since=2 days ago', '--pretty=format:%H%x09%s'],
        { cwd: REPO_ROOT },
      ))
      stdout = result.stdout
    } catch (err) {
      console.warn('[atlas-conductor] autofix git log failed:', err)
      continue
    }
    const lines = stdout.split('\n').filter(Boolean)
    const shipLine = lines.find((l) => {
      const subj = l.split('\t')[1] ?? ''
      // Match Builder ship message that references the task id.
      return subj.includes(taskKey) || subj.includes(taskKey.replace(/^phase-/, ''))
    })
    if (shipLine) {
      const sha = shipLine.split('\t')[0]
      try {
        await sb
          .from('atlas_diagnosis_cache')
          .update({
            lifecycle_state: 'auto-fix-shipped',
            lifecycle_updated_at: new Date().toISOString(),
            auto_fix_commit_sha: sha,
            auto_fix_shipped_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        console.log(`[atlas-conductor] autofix queued→shipped for ${row.auto_fix_spec_filename} at ${sha.slice(0, 8)}`)
      } catch (err) {
        console.warn('[atlas-conductor] autofix mark-shipped failed:', err)
      }
    }
  }

  // Resolve shipped → resolved | failed: only after ≥30 min so verifier/designer have run.
  const cutoffMs = Date.now() - 30 * 60 * 1000
  for (const row of shippedRows) {
    if (!row.auto_fix_shipped_at) continue
    const shippedAt = new Date(row.auto_fix_shipped_at).getTime()
    if (Number.isNaN(shippedAt) || shippedAt > cutoffMs) continue

    const newSha = row.auto_fix_commit_sha
    if (!newSha) continue

    // Pull the original gap from the cached diagnosis result.
    const result = row.result as Record<string, unknown> | null
    const reason = row.reason ?? '(no reason)'
    const originalCheck = extractFirstGapCheck(result)
    const originalFile = extractFirstGapFile(result)

    let stillFails = false
    let cleared = false
    let evidence = ''
    try {
      // Look at the most recent verifier_run + designer_run for this task on the new sha.
      const taskId = row.task_id ?? ''
      const verifierQ = await sb
        .from('verifier_runs')
        .select('id, passed, gaps, ran_at, commit_sha, task_id')
        .eq('commit_sha', newSha)
        .order('ran_at', { ascending: false })
        .limit(1)
      const designerQ = await sb
        .from('designer_runs')
        .select('id, verdict, ai_judgment, created_at, task_id')
        .eq('task_id', taskId)
        .gte('created_at', new Date(shippedAt).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)

      const v = verifierQ.data?.[0] as { passed?: boolean; gaps?: unknown[] } | undefined
      const d = designerQ.data?.[0] as { verdict?: string; ai_judgment?: Record<string, unknown> } | undefined

      if (!v && !d) {
        // Audits haven't shown up yet — leave shipped state, try next heartbeat.
        continue
      }

      if (v) {
        const newGaps = Array.isArray(v.gaps) ? v.gaps : []
        const matched = newGaps.find((g) => gapMatchesOriginal(g, originalCheck, originalFile))
        if (matched) {
          stillFails = true
          evidence = `verifier_run still reports the original gap on ${newSha.slice(0, 8)}.`
        } else if (v.passed) {
          cleared = true
          evidence = `verifier_run passed on ${newSha.slice(0, 8)}.`
        }
      }
      if (d) {
        const judgment = d.ai_judgment ?? {}
        const newGaps = Array.isArray((judgment as Record<string, unknown>).gaps)
          ? ((judgment as Record<string, unknown>).gaps as unknown[])
          : []
        const matched = newGaps.find((g) => gapMatchesOriginal(g, originalCheck, originalFile))
        if (matched) {
          stillFails = true
          evidence = `designer_run still reports the original gap on the post-fix audit.`
        } else if (d.verdict === 'pass') {
          cleared = true
          evidence = `designer_run passed on ${newSha.slice(0, 8)}.`
        }
      }
    } catch (err) {
      console.warn('[atlas-conductor] autofix audit lookup failed:', err)
      continue
    }

    if (cleared && !stillFails) {
      try {
        await sb
          .from('atlas_diagnosis_cache')
          .update({
            lifecycle_state: 'auto-fix-resolved',
            lifecycle_updated_at: new Date().toISOString(),
            auto_fix_resolved_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        console.log(`[atlas-conductor] autofix resolved for diagnosis ${row.id}`)
      } catch (err) {
        console.warn('[atlas-conductor] autofix mark-resolved failed:', err)
      }
    } else if (stillFails) {
      const failReason = `Auto-fix shipped at ${newSha.slice(0, 8)} but the original gap is still present. ${evidence}\n\nOriginal diagnosis reason: ${reason}`
      try {
        await sb
          .from('atlas_diagnosis_cache')
          .update({
            lifecycle_state: 'auto-fix-failed',
            lifecycle_updated_at: new Date().toISOString(),
            auto_fix_failure_reason: failReason,
          })
          .eq('id', row.id)
      } catch (err) {
        console.warn('[atlas-conductor] autofix mark-failed failed:', err)
      }
      // Per the spec, ping WhatsApp with the escalation prompt.
      if (trustMode !== 'chat') {
        try {
          await sendWhatsAppReply(
            MUZAMMIL_WHATSAPP,
            `❌ Auto-fix failed for diagnosis on ${row.task_id ?? 'unknown task'}. ${truncate(failReason, 400)} Open Atlas → Audit to escalate to Claude Code.`,
          )
        } catch (err) {
          console.warn('[atlas-conductor] autofix-failed whatsapp ping failed:', err)
        }
      }
    }
  }
}

function extractFirstGapCheck(result: Record<string, unknown> | null): string | null {
  if (!result) return null
  const reason = result.reason
  if (typeof reason === 'string' && reason.length > 0) return reason
  return null
}

function extractFirstGapFile(_result: Record<string, unknown> | null): string | null {
  // The cached diagnosis result doesn't always carry the original gap. Best-effort.
  return null
}

function gapMatchesOriginal(
  gap: unknown,
  originalCheck: string | null,
  originalFile: string | null,
): boolean {
  if (!gap || typeof gap !== 'object') return false
  const g = gap as Record<string, unknown>
  if (originalCheck) {
    const check = typeof g.check === 'string' ? g.check : ''
    if (check === originalCheck) return true
  }
  if (originalFile) {
    const file = typeof g.file === 'string' ? g.file : ''
    if (file === originalFile) return true
  }
  // Without a precise comparator, default to "no match" so we don't trigger
  // false-positive failures.
  return false
}

// ─── 10. Phase 1.10ar — chat summary sweep ─────────────────────────────────
//
// The chat handler fires maybeSummarize() inline after every assistant turn,
// but threads that received messages via WhatsApp / voice / mobile-pwa never
// pass through that path. This sweep finds any thread with activity in the
// last 30 min and lets maybeSummarize() decide whether to fire (it
// self-rate-limits to 1 per thread per 5 min and is gated by 10-min wall
// clock OR ≥30 unsummarised messages).
//
// Caps: at most 5 thread summaries per heartbeat to keep cost bounded.
async function chatSummarySweep(trustMode: TrustMode): Promise<void> {
  if (trustMode === 'stopped' || trustMode === 'passive') return
  const sb = getSupabaseClient()
  if (!sb) return

  const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  let activeThreadIds: string[] = []
  try {
    const { data, error } = await sb
      .from('atlas_conversations')
      .select('thread_id')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      console.warn('[atlas-conductor] chat sweep query failed:', error.message)
      return
    }
    const seen = new Set<string>()
    for (const row of (data ?? []) as Array<{ thread_id: string }>) {
      if (!seen.has(row.thread_id)) {
        seen.add(row.thread_id)
        activeThreadIds.push(row.thread_id)
      }
    }
  } catch (err) {
    console.warn('[atlas-conductor] chat sweep query crash:', err)
    return
  }

  let firedCount = 0
  for (const threadId of activeThreadIds.slice(0, 5)) {
    if (firedCount >= 5) break
    try {
      const result = await maybeSummarize(threadId)
      if (result.status === 'inserted') {
        firedCount++
        console.log(`[atlas-conductor] chat summary inserted for ${threadId} (${result.messageCount} msgs)`)
      }
    } catch (err) {
      console.warn(`[atlas-conductor] chat summary failed for ${threadId}:`, err)
    }
  }
}
