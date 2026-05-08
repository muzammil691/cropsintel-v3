---
phase: 1.10ai
title: Atlas reacts on real signals not estimates
status: planned
gate: in-progress count <= 2
order: 1-of-1 (final Atlas reliability spec before CropsIntel V1)
estimated_builder_minutes: 12
estimated_cost_usd: 2
master_plan_section: 11.7
---

# Phase 1.10ai — Atlas reacts on real signals, not estimates

## Why this exists

Atlas's conductor and reaper currently make decisions on **estimates and hardcoded thresholds** rather than real-world signals. Specifically:

1. **Reaper threshold is a hardcoded 30 min** (`STUCK_BUILDER_MINUTES`, atlas/src/cron/conductor.ts:35). It does not vary by spec size. A 2-minute spec gets 30 min before reaping (good), but a legitimate 60-minute spec also gets only 30 min (bad — false positive, like 1.10ag).

2. **Reaper relies only on Builder heartbeat** to determine liveness. If heartbeat goes stale during a Verifier audit (when Builder genuinely isn't writing because Verifier is working), the reaper would falsely conclude the spec is dead.

3. **Spec front-matter fields (`estimated_builder_minutes`) are never read** by any code in `atlas/src/`. Verified: zero matches in source. The estimates are documentation only — Atlas doesn't use them.

4. **Builder ships much faster than my spec estimates suggested.** Real-world data from yesterday + today:
   - 1.10ae: 386s (6 min) — estimated 60 min
   - 1.10af: 418s (7 min) — estimated 90 min
   - 1.10ag: 900s (15 min) — estimated 120 min
   - 1.10ag2: 662s (11 min) — estimated 60 min
   - design-remediation-eceef830: 148s (2.5 min)

   Estimates were 4-10x too high. Atlas's reaper threshold (calibrated against estimates) is therefore well-tuned for a slow-Builder world that doesn't exist.

This spec replaces estimate-based decisions with real-signal decisions.

## Foundation-first check

- ✅ `atlas/src/cron/conductor.ts` exists with `reapZombies()` shipped in 1.10ag.
- ✅ Builder heartbeat shipped in 1.10ag (writes to `atlas_config` every 30s while running).
- ✅ Builder logs to `.agent/tasks/logs/<spec>-<timestamp>.log`.
- ✅ Spec front matter has `estimated_builder_minutes` field, currently ignored.
- ✅ `atlas/src/lib/plan-parser.ts` already parses spec front matter for the Plan tab.

## What ships

### 1. Reaper reads spec front matter — dynamic threshold

In `atlas/src/cron/conductor.ts`, `reapZombies()`:

```typescript
async function reapZombies() {
  const inProgressDir = '.agent/tasks/in-progress'
  const files = await fs.readdir(inProgressDir)
  
  const { data: heartbeat } = await sb.from('atlas_config').select('*').eq('key', 'builder_heartbeat').maybeSingle()
  const heartbeatAge = heartbeat ? (Date.now() - new Date(heartbeat.value.beat_at).getTime()) / 1000 : Infinity
  const builderActiveSpec = heartbeat?.value?.spec_id
  
  for (const file of files) {
    const specId = file.replace('.md', '')
    const filepath = path.join(inProgressDir, file)
    const stat = await fs.stat(filepath)
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000
    
    // NEW: read the spec's own estimate from front matter
    const specContent = await fs.readFile(filepath, 'utf-8')
    const fm = parseFrontMatter(specContent)
    const estimatedMinutes = parseInt(fm.estimated_builder_minutes ?? '15', 10)
    
    // Dynamic threshold: 2× the estimate, clamped 30..180 min
    const dynamicThreshold = Math.min(180, Math.max(30, estimatedMinutes * 2))
    
    // Skip if Builder is actively heartbeating on this spec
    if (specId === builderActiveSpec && heartbeatAge < 120) continue
    
    // NEW: check if log file is fresh (signal of real work happening)
    const logFiles = await glob(`.agent/tasks/logs/${specId}-*.log`)
    let logFresh = false
    for (const logPath of logFiles) {
      const logStat = await fs.stat(logPath)
      const logAgeMin = (Date.now() - logStat.mtimeMs) / 60000
      if (logAgeMin < 5) { logFresh = true; break }
    }
    
    // If log is fresh, skip reaping even if heartbeat is stale (Builder may be in Verifier/Designer audit)
    if (logFresh) {
      console.log(`[reaper] skipping ${specId} — log written ${(Date.now() - heartbeat.value.beat_at)/60000 | 0}m ago but log fresh`)
      continue
    }
    
    if (ageMinutes > dynamicThreshold) {
      const reason = `zombie — exceeded ${dynamicThreshold}m in in-progress (estimate ${estimatedMinutes}m × 2), no heartbeat (${heartbeatAge}s old), no log activity (>5m)`
      console.log(`[reaper] reaping ${specId} — ${reason}`)
      // ... existing reap logic
    }
  }
}
```

### 2. Conductor reads completion from disk, not just heartbeat

The dispatch loop checks "is Builder still working?" When heartbeat shows `spec_id: null` OR `status: idle`, conductor concludes Builder is free. **But the file-system is the truth:** if `in-progress/` is empty, Builder is free. If it's non-empty AND log is fresh, Builder is working regardless of heartbeat.

Add to the dispatch check:

```typescript
async function isBuilderBusy(): Promise<{busy: boolean, reason: string}> {
  const inProgressFiles = await fs.readdir('.agent/tasks/in-progress')
  
  if (inProgressFiles.length === 0) {
    return { busy: false, reason: 'in-progress empty' }
  }
  
  // Files exist — check if any have fresh logs (Builder genuinely working)
  for (const file of inProgressFiles) {
    const specId = file.replace('.md', '')
    const logFiles = await glob(`.agent/tasks/logs/${specId}-*.log`)
    for (const logPath of logFiles) {
      const logStat = await fs.stat(logPath)
      if ((Date.now() - logStat.mtimeMs) / 60000 < 5) {
        return { busy: true, reason: `${specId} log fresh ${((Date.now() - logStat.mtimeMs)/1000)|0}s ago` }
      }
    }
  }
  
  // Files exist but no fresh logs — let reaper handle it, conductor treats Builder as free
  return { busy: false, reason: 'in-progress non-empty but no fresh logs (will be reaped)' }
}
```

### 3. Real-data estimate calibration helper

Add a one-shot script `atlas/src/scripts/calibrate-estimates.ts` that:

1. Reads recent `done/` specs (last 30).
2. For each, computes actual Builder time from the log file timestamps and the "feat:" commit message duration.
3. Compares to `estimated_builder_minutes` in front matter.
4. Outputs a calibration report: `Spec X estimated 60m, took 6m. Ratio 0.10x. Bias factor 10x.`
5. Prints the median ratio so future specs can be calibrated.

Run on first deploy. Output goes to `docs/atlas-decisions/2026-MM-DD-estimate-calibration.md`. Future specs Claude Code writes for this repo should use the calibration ratio.

This doesn't change any production code path — it's diagnostic only.

### 4. Dashboard timer reads real signals

Already partially shipped in 1.10af, but verify:

- Queue tab "Builder is on X (Nm in)" reads from `builder_heartbeat.value.beat_at`, not from queued-time.
- If heartbeat is stale BUT log is fresh, show "Builder · in audit phase" instead of "Builder unresponsive."

If 1.10af already does this, this section is no-op (Verifier audit confirms).

### 5. Tests

`e2e/atlas-real-signals.spec.ts`:

- (a) Place fixture spec with `estimated_builder_minutes: 5` and mtime 12 min old. Assert reaper kills it (12 > 5×2 = 10 = clamped to 30, but using min-threshold 30 — actually NOT killed because clamp). Adjust test to verify clamping.
- (b) Place spec with `estimated_builder_minutes: 60` and mtime 90 min old, no heartbeat. Assert reaper kills it (90 > 60×2 = 120 — wait, 90 < 120, NOT killed). Test that 130 min triggers kill.
- (c) Place spec with mtime 90 min old AND a log file written 2 min ago. Assert reaper does NOT kill (log fresh).
- (d) Place spec with mtime 200 min old and no log. Assert reaper DOES kill (above 180 max clamp).
- (e) Run calibration script with fixture done specs. Assert report file generated.

## Acceptance criteria

- Reaper threshold is dynamic per spec, clamped 30-180 min.
- Reaper does NOT kill specs whose log file was written in the last 5 min, regardless of heartbeat staleness.
- Conductor's "Builder busy" check uses log freshness + filesystem state, not just heartbeat.
- Calibration script generates report showing real Builder time vs estimates for last 30 specs.
- 5 e2e test scenarios pass.
- `npm run build` clean.
- Spec lands in `done/` (lifecycle test).

## Out of scope

- Changing the heartbeat write frequency (stays 30s).
- Auto-adjusting future spec estimates based on calibration data (calibration is read-only diagnostic).
- Reaper for non-Builder agents (still out of scope, same as 1.10ag).
- Notifying user when reaper kills (already shipped via WhatsApp in 1.10ag).

## Dependencies

- 1.10ae, 1.10af, 1.10ag, 1.10ag2 all shipped (✅ all in `done/`).

## Realistic time estimate

Based on real Builder data (1.10ag2 was 11 min for 5 implementation areas + tests + diagnostic):

- This spec has 4 implementation areas + 1 test file + 0 diagnostic (we already know what's wrong).
- Expect: **8-12 minutes Builder time** (660-720s).
- Plus ~5 min Verifier audit.
- Plus ~5 min cron pickup.
- Total wall clock: ~20-25 min.

If Builder takes >25 min on this spec, that itself is evidence the lifecycle bug from 1.10ag2 wasn't fully fixed and we have a regression.
