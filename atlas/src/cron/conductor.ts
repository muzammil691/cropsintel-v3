import { getSupabaseClient } from '../lib/supabase'
import { dispatch } from '../lib/dispatch'
import { sendWhatsAppReply } from '../lib/twilio'
import { simple, debate, DebateResult } from '../lib/multi-brain'
import { getCurrentMode } from '../lib/trust-mode'
import { checkBudget } from '../lib/cost-gate'
import { ToolName, builderQueueOrder } from '../lib/tools'
import { checkWorkflowTraceInvariants, consumeNewWorkflowViolations, type WorkflowTraceViolation } from '../lib/invariants'
import { withGitLock } from '../lib/git-mutex'
import { TrustMode } from '../types'
import { readFile, writeFile, rename, mkdir, readdir, access } from 'fs/promises'
import { resolve, dirname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.ATLAS_HEARTBEAT_INTERVAL_MS ?? '300000', 10)
const MUZAMMIL_WHATSAPP = process.env.MUZAMMIL_WHATSAPP ?? '+971562556592'
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
    // 1.10ad: workflow-trace invariants (verifier/designer/memory presence post-ship).
    await checkWorkflowTraceAndPing(trustMode)
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

  // Avoid debating the same cluster every heartbeat: snapshot the task IDs.
  const clusterKey = recentFails.map(r => r.task_id as string).sort().join(',')
  if (recentClusterKeys.has(clusterKey)) return 'already-debated'
  recentClusterKeys.add(clusterKey)

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
  const gaps = r.gaps as Array<{ description?: string }> | undefined
  return `- ${r.task_id}: ${gaps?.[0]?.description ?? 'no gap detail'}`
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

const recentClusterKeys = new Set<string>()

function composeInvestigationSpec(
  recentFails: Array<Record<string, unknown>>,
  debateResult: DebateResult,
): string {
  const failBullets = recentFails.map(r => {
    const gaps = r.gaps as Array<{ description?: string }> | undefined
    return `- **${r.task_id}** (${r.ran_at ?? r.created_at ?? '?'}): ${gaps?.[0]?.description ?? 'no detail'}`
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
  try {
    await dispatch({
      tool: 'memory.ingest' as ToolName,
      arguments: { source: 'github-history' },
      initiatedBy: 'cron',
      trustMode: 'auto',
    })
    console.log(`[atlas-conductor] memory.ingest fired after ${shipCommits.length} ship commit(s)`)
  } catch (err) {
    console.warn('[atlas-conductor] memory.ingest after-ship dispatch failed:', err)
  }
}
