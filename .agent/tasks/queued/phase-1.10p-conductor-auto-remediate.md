# Task: Phase 1.10p — Atlas conductor auto-remediation upgrade

**Master plan reference:** Closes the autonomous loop. Conductor was passive observer; now it ACTS — auto-queues remediation tasks, runs pre-flight spec reviews, dispatches Designer audits, escalates to user only on genuine forks.
**Context:** 1.10m shipped the conductor as an observer. It detects stuck Builder, idle queue, fork escalations, cost spikes — but only WhatsApp-pings the user. This task upgrades it to take corrective actions autonomously under trust mode rules.
**Estimated effort:** ~45 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Upgrade `atlas/src/cron/conductor.ts` so its diagnose→action loop genuinely closes anomalies, not just reports them.

## New conductor behaviors

### 1. Pre-flight spec review (before queue)

When the conductor detects a NEW spec just appeared in `.agent/tasks/queued/` (compared to previous snapshot), it runs a multi-brain review BEFORE Builder picks it up:

```ts
async function preFlightSpecReview(specFilename: string) {
  const specContent = await fs.readFile(`.agent/tasks/queued/${specFilename}`, 'utf-8')
  const review = await debate(`Review this task spec for: ambiguity, missing acceptance criteria, scope creep, missing required env vars, references to non-existent files. Output VERDICT: ready | needs_clarification | reject_scope_violation.

Spec:
${specContent}

For each gap, output the specific lines and the fix needed.`)

  if (review.verdict === 'agreement' && review.chosen === 'reject_scope_violation') {
    // Move to .agent/tasks/cancelled/ and ping user
    await dispatchCancelTask(specFilename, review.rationale)
    await sendWhatsAppPing(`🛑 Pre-flight rejected ${specFilename}: ${review.rationale}`)
    return false
  }
  if (review.chosen === 'needs_clarification') {
    // Annotate the spec with feedback comments and pause it
    await annotateSpec(specFilename, review.rationale)
    await sendWhatsAppPing(`📝 ${specFilename} needs clarification: ${review.rationale}. Annotated; review and re-queue.`)
    return false
  }
  return true  // ready
}
```

### 2. Auto-queue remediation when Verifier failures cluster

If 3+ Verifier failures in last 30 min on different tasks → not Builder bug, but deeper issue (dependency, env, breaking schema). Conductor queues a meta-remediation:

```ts
async function detectFailureClusters(state) {
  const recentFails = state.verifierRuns.filter(r =>
    r.verdict === 'fail' &&
    Date.now() - new Date(r.created_at).getTime() < 30 * 60 * 1000,
  )
  if (recentFails.length < 3) return null

  // Multi-brain debate on root cause
  const debate = await debate(`Three Verifier failures in 30 min:
${recentFails.map(r => `- ${r.task_id}: ${r.gaps?.[0]?.description}`).join('\n')}

Common root cause? Should we (a) pause Builder, (b) queue an investigation task, (c) wait? Output VERDICT: pause | investigate | wait.`)

  if (debate.chosen === 'pause') {
    await pauseBuilder()
    return 'paused-builder'
  }
  if (debate.chosen === 'investigate') {
    await dispatch({
      tool: 'builder.queue_spec',
      arguments: {
        filename: 'phase-1-CLUSTER-investigation.md',
        body: composeInvestigationSpec(recentFails, debate.rationale),
      },
      initiatedBy: 'cron',
      trustMode: getCurrentMode(),
    })
    return 'queued-investigation'
  }
  return 'waiting'
}
```

### 3. Auto-trigger Designer review on UI commits

After any commit touching `src/pages/`, `src/components/`, `src/styles/` → conductor calls `designer.audit-commit`:

```ts
async function designerAuditOnUiCommit(commitSha: string) {
  const changedFiles = await getChangedFiles(commitSha)
  const isUi = changedFiles.some(f => /^src\/(pages|components|styles)/.test(f))
  if (!isUi) return

  const audit = await dispatch({
    tool: 'designer.audit_commit',  // NEW tool added in 1.10n
    arguments: { task_id: commitSha, head_before: `${commitSha}^`, head_after: commitSha },
    initiatedBy: 'cron',
    trustMode: getCurrentMode(),
  })
  if (audit.result?.verdict === 'fail') {
    await queueDesignRemediation(commitSha, audit.result.gaps)
  }
}
```

### 4. Self-heal stuck Builder

If snapshot detects same `queued_specs` count for 6+ consecutive snapshots (30 min) and `in_flight_specs` is 0 — Builder is wedged. Auto-action:

```ts
async function selfHealStuckBuilder(state) {
  const snapshots = state.recentSnapshots.slice(0, 6)
  const allSameQueue = snapshots.every(s => s.queued_specs === snapshots[0].queued_specs)
  const allEmptyInFlight = snapshots.every(s => s.in_flight_specs === 0)
  if (!allSameQueue || !allEmptyInFlight || state.queued.length === 0) return

  await sendWhatsAppPing(`🔧 Builder appears stuck for 30+ min — attempting auto-restart via Railway API`)
  // Try Railway restart via API if RAILWAY_API_TOKEN is set; otherwise just escalate
  if (process.env.RAILWAY_API_TOKEN) {
    await railwayRestartService('cropsintel-agent')
  } else {
    await sendWhatsAppPing(`⚠️ No RAILWAY_API_TOKEN — please manually redeploy cropsintel-agent on Railway`)
  }
}
```

### 5. Idle queue → ask user proactively

If queue is empty AND in-flight is empty AND no user message in 4+ hours during work hours, conductor proactively suggests next phase:

```ts
async function suggestNextPhase(state) {
  const userIdle = !state.lastUserMsg || ageMinutes(state.lastUserMsg.created_at) > 240
  const queueEmpty = state.queued.length === 0 && state.inProgress.length === 0
  const isWorkHours = isWeekday() && hourLocal() >= 9 && hourLocal() <= 22
  if (!userIdle || !queueEmpty || !isWorkHours) return

  // Read master plan via Memory; find most logical next phase
  const masterPlan = await dispatch({ tool: 'memory.search', arguments: { query: 'master plan phase 1 next' } })
  const recommendation = await simple(`Given current done specs and master plan:
${(masterPlan.result as any)?.chunks?.[0]?.content?.slice(0, 1500)}

What's the single most logical next phase to open? One sentence answer with phase number.`)
  await sendWhatsAppPing(`🟢 Queue idle 4hr+. Atlas suggests: ${recommendation.content}. Reply YES to queue, or tell me a different phase.`)
}
```

## Trust mode behavior matrix

| Trust mode | Pre-flight review | Cluster auto-action | Designer audit | Self-heal stuck Builder | Idle suggestion |
|---|---|---|---|---|---|
| stopped | ❌ | ❌ | ❌ | ❌ | ❌ |
| passive | ❌ (snapshot only) | ❌ | ❌ | ❌ | ❌ |
| chat | ✅ (advisory) | ❌ | ✅ (read-only) | ❌ | ❌ |
| confirm | ✅ (annotate, no auto-queue) | ❌ (ping user with proposal) | ✅ + ping on fail | ❌ (ping only) | ✅ (ping) |
| auto | ✅ (full) | ✅ (full debate + queue) | ✅ (full + auto-remediate) | ✅ (auto-restart attempt) | ✅ (auto-suggest) |

## Cost gating for all conductor actions

Every action (debate calls, multi-brain decisions, dispatch) must check budget via `cost-gate.ts`. If budget exhausted, action degrades to "ping user only" mode, no AI calls.

## Acceptance criteria

After this task ships:

1. `atlas/src/cron/conductor.ts` extended with all 5 behaviors above.
2. Trust-mode matrix correctly enforced — synthetic tests with each mode produce expected behavior.
3. Synthetic stuck-builder scenario triggers self-heal at 30 min mark.
4. Synthetic 3+ verifier failures triggers cluster debate.
5. Conductor's multi-brain debate calls cost-gate, all costs logged.
6. UI commit triggers designer audit (requires 1.10n shipped first; fall back to log-only if Designer unreachable).
7. atlas_decisions table accumulates rows for every autonomous action with full rationale.

## Required env vars (Atlas Railway service)

- `RAILWAY_API_TOKEN` (optional but enables auto-restart of sibling services)
- `DESIGNER_URL` (after 1.10n deploys)
- `DESIGNER_API_TOKEN`

## Out of scope

- Self-modification (Atlas changing its own code) — too risky
- Cross-Railway-project actions
- Multi-Atlas coordination (single replica only)
- Atlas escalating to a "human-on-call" rotation (you are the on-call)

## Notes

- This is the LAST piece of the autonomous loop. After this ships, the system is genuinely closed-loop in `auto` mode.
- Every autonomous action is logged AND announced via WhatsApp summary, so you can audit overnight in the morning.
- Cost cap from 1.10g protects against runaway behavior — conductor cannot exceed monthly budget.
- The 3-attempt remediation cap from 1.10o prevents infinite loops.
- Combined: conductor proposes, multi-brain decides, cost-gate rate-limits, verifier+designer audit, you approve big forks. That's the entire autonomous build system.
