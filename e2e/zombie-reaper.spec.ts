// Phase 1.10ag — zombie reaper contract test.
//
// Three behaviors documented by /atlas/builder/heartbeat + the conductor's
// reapZombieSpecs() pass:
//   (a) An in-progress spec >30min old whose heartbeat is stale → REAPED to
//       failed/ with reaped_at frontmatter.
//   (b) An in-progress spec >30min old BUT heartbeat is fresh AND spec_id
//       matches → NOT reaped. Heartbeat protects the spec.
//   (c) Fresh in-progress spec (10min) → NOT reaped regardless of heartbeat
//       state.
//
// The conductor's reaper itself is exercised in production. Here we lock in
// the decision contract — a pure-JS reference matcher that mirrors the
// production logic in atlas/src/cron/conductor.ts:reapZombieSpecs(). Drift
// between this matcher and the production conductor is the bug class we want
// to catch in code review.

import { test, expect } from '@playwright/test'

const REAPER_THRESHOLD_MIN = 30
const HEARTBEAT_FRESH_SECONDS = 120

interface ReapDecisionInput {
  startedAt: Date
  heartbeatSpecId: string | null
  heartbeatAgeSeconds: number | null
  specId: string
}

// Reference impl mirroring reapZombieSpecs(): "is this spec eligible for the
// reaper to move it to failed/?". Keep in sync with conductor.ts.
function isReapable(args: ReapDecisionInput): boolean {
  const ageMinutes = (Date.now() - args.startedAt.getTime()) / 60_000
  if (ageMinutes < REAPER_THRESHOLD_MIN) return false
  const heartbeating =
    args.heartbeatSpecId === args.specId &&
    typeof args.heartbeatAgeSeconds === 'number' &&
    args.heartbeatAgeSeconds < HEARTBEAT_FRESH_SECONDS
  return !heartbeating
}

// Reference impl for the reaped frontmatter the conductor prepends. Mirrors
// the shape the production code writes; verifying it here keeps the contract
// the cockpit reads stable.
function buildReapedFrontmatter(args: { ageMinutes: number; heartbeatAgeSeconds: number | null }): string {
  return [
    '---',
    `reaped_at: ${new Date().toISOString()}`,
    `reaped_reason: zombie — exceeded ${REAPER_THRESHOLD_MIN}min in in-progress with no Builder heartbeat`,
    `builder_heartbeat_age_seconds: ${args.heartbeatAgeSeconds === null || !Number.isFinite(args.heartbeatAgeSeconds) ? 'infinity' : Math.floor(args.heartbeatAgeSeconds)}`,
    `reaped_age_minutes: ${args.ageMinutes.toFixed(1)}`,
    '---',
  ].join('\n')
}

test.describe('Phase 1.10ag — zombie reaper contract', () => {
  test('(a) stale spec, no heartbeat → IS reapable', () => {
    const startedAt = new Date(Date.now() - 35 * 60_000)
    expect(
      isReapable({
        startedAt,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: null,
        specId: 'phase-test-zombie-a',
      }),
    ).toBe(true)
  })

  test('(a.1) stale spec, heartbeat present but for a DIFFERENT spec → IS reapable', () => {
    const startedAt = new Date(Date.now() - 35 * 60_000)
    expect(
      isReapable({
        startedAt,
        heartbeatSpecId: 'some-other-spec-builder-is-actually-running',
        heartbeatAgeSeconds: 5,
        specId: 'phase-test-zombie-a1',
      }),
    ).toBe(true)
  })

  test('(a.2) stale spec, heartbeat matches but is stale (>120s old) → IS reapable', () => {
    const startedAt = new Date(Date.now() - 35 * 60_000)
    expect(
      isReapable({
        startedAt,
        heartbeatSpecId: 'phase-test-zombie-a2',
        heartbeatAgeSeconds: 600, // 10 min old — past freshness window
        specId: 'phase-test-zombie-a2',
      }),
    ).toBe(true)
  })

  test('(b) stale spec but heartbeat fresh and matches → NOT reapable', () => {
    const startedAt = new Date(Date.now() - 35 * 60_000)
    expect(
      isReapable({
        startedAt,
        heartbeatSpecId: 'phase-test-zombie-b',
        heartbeatAgeSeconds: 10,
        specId: 'phase-test-zombie-b',
      }),
    ).toBe(false)
  })

  test('(c) fresh spec (10min in-progress) → NOT reapable', () => {
    const startedAt = new Date(Date.now() - 10 * 60_000)
    expect(
      isReapable({
        startedAt,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: null,
        specId: 'phase-test-zombie-c',
      }),
    ).toBe(false)
  })

  test('(c.1) just-on-the-line spec (29min) → NOT reapable', () => {
    const startedAt = new Date(Date.now() - 29 * 60_000)
    expect(
      isReapable({
        startedAt,
        heartbeatSpecId: null,
        heartbeatAgeSeconds: null,
        specId: 'phase-test-zombie-c1',
      }),
    ).toBe(false)
  })

  test('reaped frontmatter contains reaped_at + reaped_reason + age fields', () => {
    const fm = buildReapedFrontmatter({ ageMinutes: 35.4, heartbeatAgeSeconds: 600 })
    expect(fm).toContain('reaped_at:')
    expect(fm).toContain('reaped_reason: zombie')
    expect(fm).toContain('builder_heartbeat_age_seconds: 600')
    expect(fm).toContain('reaped_age_minutes: 35.4')
    expect(fm.startsWith('---')).toBe(true)
    expect(fm.endsWith('---')).toBe(true)
  })

  test('reaped frontmatter handles null heartbeat age (no Builder beat ever recorded)', () => {
    const fm = buildReapedFrontmatter({ ageMinutes: 35.0, heartbeatAgeSeconds: null })
    expect(fm).toContain('builder_heartbeat_age_seconds: infinity')
  })
})
