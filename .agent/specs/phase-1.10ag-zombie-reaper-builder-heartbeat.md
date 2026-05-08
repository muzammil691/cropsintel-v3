---
phase: 1.10ag
title: Zombie reaper + Builder heartbeat + ghost-duplicate prevention
status: planned
gate: in-progress count <= 2 AND phases 1.10ae and 1.10af shipped
order: 3-of-4
estimated_builder_minutes: 120
estimated_cost_usd: 4
master_plan_section: 11.7
---

# Phase 1.10ag — Zombie reaper + Builder heartbeat + ghost-duplicate prevention

## Why this exists

Three coupled cron-layer problems:

1. **When Builder crashes mid-spec** (OOM, container restart, network blip, Claude API timeout), the spec stays in `in-progress/` forever. Manual rescue four times in 24 hours.

2. **No way to know if Builder is actually alive.** The dashboard's "Builder is on X (Nm in)" timer is just elapsed wall-clock since the spec moved to `in-progress/`. It doesn't reflect Builder's actual liveness.

3. **GHOST-DUPLICATE BUG (newly discovered 2026-05-08 morning):** When a spec is force-cancelled, the file moves from `in-progress/` to `cancelled/` and commits. **But Atlas's requeue/conductor cron then re-creates the spec in `in-progress/` from a stale list of "what should be running,"** producing a ghost copy. We had to manually delete 11 ghost copies this morning. Evidence: commit `8320b8f` ("atlas: requeue with gaps — phase-1-CLUSTER-investigation-1778146192564 (attempt 2)") shows the requeue cron creating files even when the spec already exists in `cancelled/`.

This spec ships:
- Builder heartbeat (every 30s while running).
- Zombie reaper cron (auto-clean stuck `in-progress/` specs).
- Requeue cron sanity check (don't re-create specs that already exist in `cancelled/`, `failed/`, or `done/`).

## Foundation-first check

- ✅ `atlas/src/cron/conductor.ts` already runs cron jobs.
- ✅ Builder picks up specs via cron in `cropsintel-agent` service.
- ❓ The "requeue with gaps" cron — Builder must locate it (search atlas + agent code for "requeue") and document its current behavior in the diagnostic step.
- ❓ No heartbeat infrastructure today — net-new code.

## Diagnostic step (Builder runs FIRST)

Document findings in `docs/atlas-decisions/2026-MM-DD-zombie-and-ghost-investigation.md`.

1. **Locate the requeue cron.** Search atlas + agent codebases for "requeue", "with gaps", "attempt 2". Commit `8320b8f` is one example output — find the code that produced it.

2. **Document the requeue logic.** What triggers a requeue? Does it check whether the spec already exists in `done/`, `failed/`, or `cancelled/` before re-creating it in `in-progress/`?

3. **Document the spec-name-to-file mapping.** When the requeue cron decides to re-create `phase-X.md`, where does it get the file content from? Re-read from `cancelled/`? Re-create from a template? Pull from a Supabase table?

The fix in §3 below depends on these findings.

## What ships

### 1. Builder heartbeat — write every 30s while building

In Builder's main loop (Builder must locate the right file in `cropsintel-agent` repo or `agent/` folder):

```typescript
let heartbeatTimer: NodeJS.Timer | null = null

function startHeartbeat(specId: string) {
  const writeBeat = async () => {
    await sb.from('atlas_config').upsert({
      key: 'builder_heartbeat',
      value: { spec_id: specId, beat_at: new Date().toISOString(), pid: process.pid }
    })
  }
  writeBeat()
  heartbeatTimer = setInterval(writeBeat, 30000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  sb.from('atlas_config').upsert({
    key: 'builder_heartbeat',
    value: { spec_id: null, beat_at: new Date().toISOString(), pid: process.pid, status: 'idle' }
  })
}
```

Wrap every `runSpec()` call with start/stop heartbeat. On finally block, stopHeartbeat must run regardless of success/failure.

### 2. Zombie reaper cron — runs every 5 min

In `atlas/src/cron/conductor.ts`, add a new cron job:

```typescript
async function reapZombies() {
  const inProgressDir = '.agent/tasks/in-progress'
  const files = await fs.readdir(inProgressDir)
  
  const { data: heartbeat } = await sb.from('atlas_config').select('*').eq('key', 'builder_heartbeat').single()
  const heartbeatAge = heartbeat ? (Date.now() - new Date(heartbeat.value.beat_at).getTime()) / 1000 : Infinity
  const builderActiveSpec = heartbeat?.value?.spec_id
  
  for (const file of files) {
    const specId = file.replace('.md', '')
    const filepath = path.join(inProgressDir, file)
    const stat = await fs.stat(filepath)
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000
    
    if (specId === builderActiveSpec && heartbeatAge < 120) continue
    
    if (ageMinutes > 30) {
      await moveSpecFile(filepath, '.agent/tasks/failed/')
      await prependFrontMatter(path.join('.agent/tasks/failed', file), {
        reaped_at: new Date().toISOString(),
        reaped_reason: 'zombie — exceeded 30min in in-progress with no Builder heartbeat',
        builder_heartbeat_age_seconds: heartbeatAge
      })
      await git.add(['.agent/tasks/'])
      await git.commit(`atlas: reaped zombie ${specId} (${ageMinutes.toFixed(0)}m stuck)`)
      await git.push()
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `⚰️ Reaper killed zombie: ${specId} (${ageMinutes.toFixed(0)}m stuck)`)
    }
  }
}

cron.schedule('*/5 * * * *', reapZombies)
```

### 3. Requeue cron — ghost-duplicate prevention (NEW)

Based on diagnostic findings, fix the requeue/conductor cron to check terminal-state folders BEFORE creating a spec in `in-progress/`. The exact fix depends on where the bug lives, but the general shape:

```typescript
async function safeRequeue(specId: string) {
  for (const terminalDir of ['cancelled', 'failed', 'done']) {
    const terminalPath = `.agent/tasks/${terminalDir}/${specId}.md`
    if (await fileExists(terminalPath)) {
      console.warn(`[requeue] refusing to requeue ${specId} — already in ${terminalDir}/`)
      await sb.from('agent_audit_log').insert({
        kind: 'ghost_requeue_blocked',
        spec_id: specId,
        existing_state: terminalDir,
        blocked_at: new Date().toISOString()
      })
      return { ok: false, reason: `already in ${terminalDir}` }
    }
  }
  if (await fileExists(`.agent/tasks/in-progress/${specId}.md`)) {
    return { ok: false, reason: 'already in in-progress' }
  }
  await createInProgress(specId)
  return { ok: true }
}

// Separate explicit-reset path for genuine retries:
async function safeRequeueWithReset(specId: string) {
  for (const dir of ['cancelled', 'failed', 'done', 'in-progress']) {
    const existing = `.agent/tasks/${dir}/${specId}.md`
    if (await fileExists(existing)) {
      await moveToArchive(existing, `cancelled/.archive/${Date.now()}/`)
    }
  }
  await createInProgress(specId)
}
```

Replace all current call sites of unsafe requeue with `safeRequeue`. Add `safeRequeueWithReset` as a separate explicit operation only callable via API or admin command.

### 4. Cleanup endpoint — prune existing ghost duplicates

One-time endpoint `POST /atlas/cleanup/ghosts`:

```typescript
if (url === '/atlas/cleanup/ghosts' && method === 'POST') {
  const inProgressFiles = await fs.readdir('.agent/tasks/in-progress')
  const ghosts = []
  for (const file of inProgressFiles) {
    for (const dir of ['cancelled', 'failed', 'done']) {
      if (await fileExists(`.agent/tasks/${dir}/${file}`)) {
        ghosts.push({ file, also_in: dir })
        await fs.unlink(`.agent/tasks/in-progress/${file}`)
        break
      }
    }
  }
  if (ghosts.length > 0) {
    await git.commit(`atlas: pruned ${ghosts.length} ghost duplicates from in-progress/`)
    await git.push()
  }
  return json(res, 200, { pruned: ghosts.length, ghosts })
}
```

Makes the 11-ghost cleanup we did manually this morning a one-line API call.

### 5. New API endpoint — `GET /atlas/builder/heartbeat`

```typescript
if (url === '/atlas/builder/heartbeat' && method === 'GET') {
  const { data } = await sb.from('atlas_config').select('*').eq('key', 'builder_heartbeat').maybeSingle()
  return json(res, 200, data?.value ?? { spec_id: null, beat_at: null })
}
```

### 6. Update Queue API to include heartbeat info

`GET /atlas/builder/queue` response gains a `builder_heartbeat` field with `{spec_id, beat_at, age_seconds}`.

### 7. Tests

`e2e/zombie-reaper.spec.ts`:
- (a) Spec mtime 35min ago, no heartbeat → moved to `failed/` with `reaped_at`.
- (b) Spec mtime 35min ago BUT heartbeat active for that spec_id 10s ago → NOT moved.
- (c) Fresh spec (10min) → NOT moved.

`e2e/ghost-prevention.spec.ts`:
- (d) Spec exists in `cancelled/`. Call `safeRequeue` → returns `{ok:false}`, nothing created.
- (e) Spec in `cancelled/`. Call `safeRequeueWithReset` → old archived, new in `in-progress/`.
- (f) Call `POST /atlas/cleanup/ghosts` → response `{pruned:N}`, files deleted, commit pushed.

## Acceptance criteria

- Builder writes `builder_heartbeat` row every 30s while running a spec.
- `GET /atlas/builder/heartbeat` returns valid data within 30s of Builder starting.
- A spec >30min in `in-progress/` with no recent heartbeat → moved to `failed/` within 5min by reaper.
- An actively-heartbeated spec → never reaped.
- WhatsApp notified when reaper kills a zombie.
- After this spec ships, force-cancelling a spec then waiting 10 minutes does NOT result in a ghost copy reappearing in `in-progress/`. Verify on prod with one test spec.
- `POST /atlas/cleanup/ghosts` callable, returns count of ghosts pruned.
- `npm run build` passes.
- `npx playwright test e2e/zombie-reaper.spec.ts e2e/ghost-prevention.spec.ts` green.

## Out of scope

- Re-queueing reaped specs automatically.
- Heartbeat for non-Builder agents (Designer, Verifier).
- Telemetry beyond heartbeat (CPU, memory).

## Dependencies

- 1.10ae shipped (atlas_config table reliable).
- 1.10af shipped (dashboard displays heartbeat data).
