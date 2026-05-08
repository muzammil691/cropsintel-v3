---
phase: 1.10ag
title: Zombie reaper + Builder heartbeat
status: planned
gate: in-progress count <= 2 AND phases 1.10ae and 1.10af shipped
order: 3-of-4
estimated_builder_minutes: 90
estimated_cost_usd: 3
master_plan_section: 11.7
---

# Phase 1.10ag — Zombie reaper + Builder heartbeat

## Why this exists

When Builder crashes mid-spec (OOM, container restart, network blip, Claude API timeout), the spec stays in `in-progress/` forever. We've manually rescued zombies four times in 24 hours. The system needs to clean up after itself.

Two pieces:
1. **Builder writes a heartbeat** every 30s while running a spec. Without this, "is Builder alive?" cannot be answered honestly.
2. **Atlas runs a reaper cron** every 5 minutes that auto-moves stale `in-progress/` specs to `failed/` with a stuck-marker.

## Foundation-first check

- ✅ `atlas/src/cron/conductor.ts` already runs cron jobs.
- ✅ Builder picks up specs via cron in `cropsintel-agent` service.
- ❓ No heartbeat infrastructure today — net-new code.

## What ships

### 1. Builder heartbeat — write every 30s while building

In Builder's main loop (likely `cropsintel-agent` repo or `agent/` folder — Builder must locate the right file):

```typescript
let heartbeatTimer: NodeJS.Timer | null = null

function startHeartbeat(specId: string) {
  const writeBeat = async () => {
    await sb.from('atlas_config').upsert({
      key: 'builder_heartbeat',
      value: { spec_id: specId, beat_at: new Date().toISOString(), pid: process.pid }
    })
  }
  writeBeat()  // immediate
  heartbeatTimer = setInterval(writeBeat, 30000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  // Mark Builder as idle
  sb.from('atlas_config').upsert({
    key: 'builder_heartbeat',
    value: { spec_id: null, beat_at: new Date().toISOString(), pid: process.pid, status: 'idle' }
  })
}
```

Wrap every `runSpec()` call:

```typescript
async function runSpec(spec) {
  startHeartbeat(spec.id)
  try {
    // ... existing build logic ...
    await moveSpec(spec, 'done')
  } catch (e) {
    await moveSpec(spec, 'failed')
    throw e
  } finally {
    stopHeartbeat()
  }
}
```

### 2. Zombie reaper cron — runs every 5 min

In `atlas/src/cron/conductor.ts`, add a new cron job:

```typescript
async function reapZombies() {
  const inProgressDir = '.agent/tasks/in-progress'
  const files = await fs.readdir(inProgressDir)
  
  // Get latest builder heartbeat
  const { data: heartbeat } = await sb.from('atlas_config').select('*').eq('key', 'builder_heartbeat').single()
  const heartbeatAge = heartbeat ? (Date.now() - new Date(heartbeat.value.beat_at).getTime()) / 1000 : Infinity
  const builderActiveSpec = heartbeat?.value?.spec_id
  
  for (const file of files) {
    const specId = file.replace('.md', '')
    const filepath = path.join(inProgressDir, file)
    const stat = await fs.stat(filepath)
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000
    
    // Skip the spec Builder is actively heartbeating
    if (specId === builderActiveSpec && heartbeatAge < 120) continue
    
    // If older than 30min AND not currently being heartbeated, reap
    if (ageMinutes > 30) {
      console.log(`[reaper] reaping zombie ${specId} (age ${ageMinutes.toFixed(0)}m)`)
      await moveSpecFile(filepath, '.agent/tasks/failed/')
      // Add stuck marker to the spec front matter
      await prependFrontMatter(path.join('.agent/tasks/failed', file), {
        reaped_at: new Date().toISOString(),
        reaped_reason: 'zombie — exceeded 30min in in-progress with no Builder heartbeat',
        builder_heartbeat_age_seconds: heartbeatAge
      })
      // Commit
      await git.add(['.agent/tasks/'])
      await git.commit(`atlas: reaped zombie ${specId} (${ageMinutes.toFixed(0)}m stuck, builder ${heartbeatAge.toFixed(0)}s since heartbeat)`)
      await git.push()
      // Notify
      await sendWhatsAppReply(MUZAMMIL_WHATSAPP, `⚰️ Reaper killed zombie: ${specId} (${ageMinutes.toFixed(0)}m stuck)`)
    }
  }
}

// Register in main cron schedule
cron.schedule('*/5 * * * *', reapZombies)
```

### 3. New API endpoint — `GET /atlas/builder/heartbeat`

Returns the latest heartbeat row. Used by 1.10af's queue tab to color-code stuck specs.

```typescript
if (url === '/atlas/builder/heartbeat' && method === 'GET') {
  const { data } = await sb.from('atlas_config').select('*').eq('key', 'builder_heartbeat').maybeSingle()
  return json(res, 200, data?.value ?? { spec_id: null, beat_at: null })
}
```

### 4. Update Queue API to include heartbeat info

`GET /atlas/builder/queue` response gains:

```json
{
  "in_progress": [...],
  "queued": [...],
  "builder_heartbeat": {
    "spec_id": "phase-X",
    "beat_at": "2026-05-08T01:23:45.000Z",
    "age_seconds": 27
  }
}
```

So the dashboard (1.10af) can render correctly with one fetch.

### 5. Tests

`e2e/zombie-reaper.spec.ts`:

- (a) Place a fixture spec in `in-progress/` with mtime 35min ago. Run reaper. Assert spec moved to `failed/` with `reaped_at` front-matter.
- (b) Place a fixture spec with mtime 35min ago BUT set heartbeat to active for that spec_id 10s ago. Run reaper. Assert spec NOT moved (Builder is genuinely working on it).
- (c) Place a fresh spec (mtime 10min ago). Run reaper. Assert spec NOT moved (under threshold).

## Acceptance criteria

- Builder process writes `builder_heartbeat` row every 30s while running a spec.
- `GET /atlas/builder/heartbeat` returns valid data within 30s of Builder starting a spec.
- A spec older than 30min in `in-progress/` with no recent heartbeat → moved to `failed/` within 5min by reaper.
- A spec actively being heartbeated → never reaped.
- WhatsApp gets notified when reaper kills a zombie.
- `npm run build` passes.
- `npx playwright test e2e/zombie-reaper.spec.ts` green.

## Out of scope

- Re-queueing reaped specs automatically (Atlas operator decides).
- Heartbeat for non-Builder agents (Designer, Verifier — separate spec if needed).
- Telemetry beyond heartbeat (CPU, memory — not now).

## Dependencies

- 1.10ae shipped (atlas_config table reliable).
- 1.10af shipped (dashboard knows how to display heartbeat data).
