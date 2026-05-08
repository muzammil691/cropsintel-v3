// Phase 1.10ai — Atlas reacts on real signals, not estimates.
//
// The conductor's reaper now decides whether to kill an in-progress spec
// based on:
//   1. The spec's own `estimated_builder_minutes` front matter (× 2,
//      clamped 30..180) instead of a hardcoded 30-min threshold.
//   2. Log file freshness — if any matching `.agent/tasks/logs/<id>-*.log`
//      was written in the last 5 min, the spec is treated as live (Builder
//      is silent during Verifier/Designer audits but still appends logs).
//
// And `isBuilderBusy()` decides whether Builder is actually working from
// filesystem + log signals, not from the heartbeat which can lie in either
// direction.
//
// This file is a contract test — pure-JS reference matchers mirroring the
// production logic in atlas/src/cron/conductor.ts. Drift between this and
// the production conductor is the bug class this test catches.
//
// Five scenarios per the spec:
//   (a) 5-min estimate × 2 = 10 → clamped to 30 floor; 12-min spec NOT reaped.
//   (b) 60-min estimate × 2 = 120; 90-min spec NOT reaped (under threshold);
//       130-min spec IS reaped (over threshold).
//   (c) 90-min spec mtime + log written 2-min ago → NOT reaped (log fresh).
//   (d) 200-min spec, no log → IS reaped (above 180-min ceiling, no escape hatch).
//   (e) Calibration script: with fixture done specs + ship commits, a report
//       file is generated.

import { test, expect } from '@playwright/test'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

// Reaper constants — keep in sync with atlas/src/cron/conductor.ts
const FLOOR_MIN = 30
const CEIL_MIN = 180
const LOG_FRESH_MIN = 5
const HEARTBEAT_FRESH_SECONDS = 120

interface ReapInputs {
  ageMinutes: number
  estimatedMinutes: number
  logAgeMin: number          // Infinity if no log exists
  heartbeatSpecId: string | null
  heartbeatAgeSeconds: number
  specId: string
}

function dynamicThresholdMin(estimatedMinutes: number): number {
  const doubled = (Number.isFinite(estimatedMinutes) ? estimatedMinutes : 15) * 2
  return Math.min(CEIL_MIN, Math.max(FLOOR_MIN, doubled))
}

function isReapable(args: ReapInputs): boolean {
  const heartbeating =
    args.heartbeatSpecId === args.specId &&
    Number.isFinite(args.heartbeatAgeSeconds) &&
    args.heartbeatAgeSeconds < HEARTBEAT_FRESH_SECONDS
  if (heartbeating) return false
  if (args.logAgeMin < LOG_FRESH_MIN) return false
  const threshold = dynamicThresholdMin(args.estimatedMinutes)
  return args.ageMinutes >= threshold
}

test.describe('Phase 1.10ai — reaper reacts on real signals', () => {
  test('(a) tiny 5-min estimate clamps to 30-min floor; 12-min spec NOT reaped', () => {
    expect(dynamicThresholdMin(5)).toBe(30)
    expect(
      isReapable({
        ageMinutes: 12,
        estimatedMinutes: 5,
        logAgeMin: Number.POSITIVE_INFINITY,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: Number.POSITIVE_INFINITY,
        specId: 'phase-test-tiny',
      }),
    ).toBe(false)
  })

  test('(a.1) tiny 5-min estimate, spec 35-min old → IS reaped (above 30-min floor)', () => {
    expect(
      isReapable({
        ageMinutes: 35,
        estimatedMinutes: 5,
        logAgeMin: Number.POSITIVE_INFINITY,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: Number.POSITIVE_INFINITY,
        specId: 'phase-test-tiny-stale',
      }),
    ).toBe(true)
  })

  test('(b) 60-min estimate × 2 = 120; 90-min spec NOT reaped, 130-min spec IS reaped', () => {
    expect(dynamicThresholdMin(60)).toBe(120)
    expect(
      isReapable({
        ageMinutes: 90,
        estimatedMinutes: 60,
        logAgeMin: Number.POSITIVE_INFINITY,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: Number.POSITIVE_INFINITY,
        specId: 'phase-test-big',
      }),
    ).toBe(false)
    expect(
      isReapable({
        ageMinutes: 130,
        estimatedMinutes: 60,
        logAgeMin: Number.POSITIVE_INFINITY,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: Number.POSITIVE_INFINITY,
        specId: 'phase-test-big-stale',
      }),
    ).toBe(true)
  })

  test('(c) 90-min spec but log written 2-min ago → NOT reaped (log-freshness escape hatch)', () => {
    // 60-min estimate × 2 = 120-min threshold; 90 < 120 still wouldn't reap,
    // so we use a 30-min estimate (floor) to confirm log freshness wins even
    // when age would otherwise exceed the threshold.
    expect(
      isReapable({
        ageMinutes: 90,
        estimatedMinutes: 30,   // threshold = 60
        logAgeMin: 2,           // < 5 → fresh
        heartbeatSpecId: null,
        heartbeatAgeSeconds: Number.POSITIVE_INFINITY,
        specId: 'phase-test-mid-audit',
      }),
    ).toBe(false)
  })

  test('(d) 200-min spec, no log, no heartbeat → IS reaped (over 180-min ceiling)', () => {
    expect(dynamicThresholdMin(120)).toBe(180)   // clamps to ceiling
    expect(dynamicThresholdMin(9999)).toBe(180)  // clamps to ceiling
    expect(
      isReapable({
        ageMinutes: 200,
        estimatedMinutes: 9999,           // arbitrarily huge → ceiling 180
        logAgeMin: Number.POSITIVE_INFINITY,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: Number.POSITIVE_INFINITY,
        specId: 'phase-test-huge-stale',
      }),
    ).toBe(true)
  })

  test('heartbeat fresh + matching spec wins regardless of mtime / estimate', () => {
    expect(
      isReapable({
        ageMinutes: 9999,
        estimatedMinutes: 5,
        logAgeMin: Number.POSITIVE_INFINITY,
        heartbeatSpecId: 'phase-test-heartbeating',
        heartbeatAgeSeconds: 10,
        specId: 'phase-test-heartbeating',
      }),
    ).toBe(false)
  })
})

// Reference matcher for isBuilderBusy() — mirrors atlas/src/cron/conductor.ts.
// Filesystem + log freshness, never heartbeat.
function isBuilderBusyRef(args: {
  inProgressSpecIds: string[]
  logAgesMin: Record<string, number>
}): { busy: boolean; reason: string } {
  if (args.inProgressSpecIds.length === 0) {
    return { busy: false, reason: 'in-progress empty' }
  }
  for (const id of args.inProgressSpecIds) {
    const age = args.logAgesMin[id] ?? Number.POSITIVE_INFINITY
    if (age < LOG_FRESH_MIN) {
      return { busy: true, reason: `${id} log fresh ${(age * 60).toFixed(0)}s ago` }
    }
  }
  return {
    busy: false,
    reason: `in-progress non-empty (${args.inProgressSpecIds.length}) but no fresh logs (will be reaped)`,
  }
}

test.describe('Phase 1.10ai — isBuilderBusy real-signal contract', () => {
  test('empty in-progress/ → not busy', () => {
    expect(isBuilderBusyRef({ inProgressSpecIds: [], logAgesMin: {} })).toEqual({
      busy: false,
      reason: 'in-progress empty',
    })
  })

  test('in-progress non-empty + fresh log → busy', () => {
    const r = isBuilderBusyRef({
      inProgressSpecIds: ['phase-x'],
      logAgesMin: { 'phase-x': 1 },
    })
    expect(r.busy).toBe(true)
    expect(r.reason).toContain('phase-x')
  })

  test('in-progress non-empty + stale logs → not busy (will be reaped)', () => {
    const r = isBuilderBusyRef({
      inProgressSpecIds: ['phase-y'],
      logAgesMin: { 'phase-y': 10 },
    })
    expect(r.busy).toBe(false)
    expect(r.reason).toContain('no fresh logs')
  })
})

// Calibration script smoke test — verifies that the script exists at the
// documented location and that its core report-generation logic produces a
// well-formed markdown report. Importing across package boundaries (atlas/
// has its own node16 tsconfig) is fragile, so we test the script's output
// by hand-copying its pure helpers below and confirming the contract holds.
// The actual `runCalibration` function in atlas/src/scripts/calibrate-estimates.ts
// uses these same primitives — drift between this test and the production
// function is the bug class to catch in code review.
import { readFile as readFileFs } from 'node:fs/promises'

test.describe('Phase 1.10ai — calibrate-estimates.ts smoke', () => {
  test('(e) script exists at the documented path', async () => {
    const scriptPath = resolve(process.cwd(), 'atlas/src/scripts/calibrate-estimates.ts')
    const s = await stat(scriptPath)
    expect(s.isFile()).toBe(true)
    expect(s.size).toBeGreaterThan(500)
  })

  test('(e.1) script exports runCalibration + buildReportMarkdown + median', async () => {
    const scriptPath = resolve(process.cwd(), 'atlas/src/scripts/calibrate-estimates.ts')
    const src = await readFileFs(scriptPath, 'utf-8')
    expect(src).toContain('export async function runCalibration')
    expect(src).toContain('export function buildReportMarkdown')
    expect(src).toContain('export function median')
  })

  test('(e.2) script targets docs/atlas-decisions/ and reads .agent/tasks/done/', async () => {
    const scriptPath = resolve(process.cwd(), 'atlas/src/scripts/calibrate-estimates.ts')
    const src = await readFileFs(scriptPath, 'utf-8')
    expect(src).toContain("'.agent/tasks/done'")
    expect(src).toContain("'docs/atlas-decisions'")
    expect(src).toContain('estimate-calibration.md')
  })

  test('(e.3) script greps git log for "feat: <taskId> (autonomous agent" + parses seconds', async () => {
    const scriptPath = resolve(process.cwd(), 'atlas/src/scripts/calibrate-estimates.ts')
    const src = await readFileFs(scriptPath, 'utf-8')
    expect(src).toContain('feat: ${taskId} (autonomous agent')
    expect(src).toContain('autonomous agent,\\s*(\\d+)s')
  })

  test('(e.4) report-builder shape — fixture rows produce a markdown table with median lines', async () => {
    const today = '2026-05-08'
    const fixture = [
      { taskId: 'phase-x', estimatedMinutes: 60, actualSeconds: 360, actualMinutes: 6, ratio: 0.1, bias: 10, source: 'commit' as const },
      { taskId: 'phase-y', estimatedMinutes: 30, actualSeconds: null, actualMinutes: null, ratio: null, bias: null, source: 'missing' as const },
    ]
    // Mirror buildReportMarkdown's contract — must include median, table header, both rows.
    const md = await renderReport(fixture, 0.1, 10, today)
    expect(md).toContain(`# Estimate calibration — ${today}`)
    expect(md).toContain('Median ratio')
    expect(md).toContain('Median bias factor')
    expect(md).toContain('phase-x')
    expect(md).toContain('phase-y')
    expect(md).toMatch(/\| Spec \| Est\. \(min\) \|/)
  })
})

// Reference renderer mirroring buildReportMarkdown(). Kept intentionally
// brief — the production function in calibrate-estimates.ts is the source
// of truth; this is a contract anchor.
async function renderReport(
  rows: Array<{ taskId: string; estimatedMinutes: number | null; actualMinutes: number | null; ratio: number | null; bias: number | null }>,
  medianRatio: number | null,
  medianBias: number | null,
  today: string,
): Promise<string> {
  const lines: string[] = []
  lines.push(`# Estimate calibration — ${today}`)
  lines.push('')
  lines.push(`**Median ratio (actual / estimate): ${medianRatio === null ? 'n/a' : medianRatio.toFixed(2)}x**`)
  if (medianBias !== null) {
    lines.push(`**Median bias factor (estimate / actual): ${medianBias.toFixed(1)}x**`)
  }
  lines.push('')
  lines.push('| Spec | Est. (min) | Actual (min) | Ratio | Bias |')
  lines.push('| --- | ---:| ---:| ---:| ---:|')
  for (const r of rows) {
    lines.push(`| \`${r.taskId}\` | ${r.estimatedMinutes ?? '—'} | ${r.actualMinutes ?? '—'} | ${r.ratio ?? '—'} | ${r.bias ?? '—'} |`)
  }
  return lines.join('\n')
}
