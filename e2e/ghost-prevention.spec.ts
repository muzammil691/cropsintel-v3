// Phase 1.10ag — ghost-duplicate prevention contract test.
//
// Three behaviors documented by safeRequeue + safeRequeueWithReset +
// POST /atlas/cleanup/ghosts:
//   (d) safeRequeue refuses to re-queue a spec already in cancelled/failed/done.
//       Returns { ok:false, reason:'already in <bucket>' }, nothing created.
//   (e) safeRequeueWithReset archives every prior copy under
//       cancelled/.archive/<ts>/ and creates a fresh queued/ entry.
//   (f) POST /atlas/cleanup/ghosts deletes in-progress/ files whose names also
//       exist in cancelled/, failed/, or done/, returns count + ghost list,
//       and (when there's anything to prune) commits + pushes.
//
// Tests are pure-JS contract assertions that mirror the production logic in
// atlas/src/lib/plan-server.ts (safeRequeue, safeRequeueWithReset) and
// atlas/src/server.ts (cleanupGhostDuplicates). Drift between these reference
// matchers and the production code is the bug class we want to catch in
// review.

import { test, expect } from '@playwright/test'

type Bucket = 'queued' | 'in-progress' | 'cancelled' | 'failed' | 'done'

interface SafeRequeueResult {
  ok: boolean
  created?: boolean
  reason?: string
}

interface SafeRequeueWithResetResult {
  ok: boolean
  archived: string[]
}

interface CleanupGhostsResponse {
  pruned: number
  ghosts: Array<{ file: string; also_in: string }>
  pushed: boolean
}

function safeRequeueRef(args: {
  specId: string
  body?: string
  buckets: Partial<Record<Bucket, Set<string>>>
}): SafeRequeueResult {
  const filename = `${args.specId}.md`
  const order: Bucket[] = ['queued', 'in-progress', 'done', 'cancelled', 'failed']
  for (const b of order) {
    if (args.buckets[b]?.has(filename)) {
      if (b === 'queued' || b === 'in-progress') {
        return { ok: true, created: false, reason: `already in ${b}` }
      }
      return { ok: false, created: false, reason: `already in ${b}` }
    }
  }
  if (!args.body) return { ok: false, created: false, reason: 'no_source' }
  return { ok: true, created: true }
}

function safeRequeueWithResetRef(args: {
  specId: string
  buckets: Partial<Record<Bucket, Set<string>>>
}): SafeRequeueWithResetResult {
  const filename = `${args.specId}.md`
  const archived: string[] = []
  for (const b of ['queued', 'in-progress', 'cancelled', 'failed', 'done'] as Bucket[]) {
    if (args.buckets[b]?.has(filename)) archived.push(`${b}/${filename}`)
  }
  return { ok: true, archived }
}

function cleanupGhostsRef(args: {
  inProgress: Set<string>
  cancelled: Set<string>
  failed: Set<string>
  done: Set<string>
}): CleanupGhostsResponse {
  const ghosts: Array<{ file: string; also_in: string }> = []
  for (const file of args.inProgress) {
    if (args.cancelled.has(file)) { ghosts.push({ file, also_in: 'cancelled' }); continue }
    if (args.failed.has(file)) { ghosts.push({ file, also_in: 'failed' }); continue }
    if (args.done.has(file)) { ghosts.push({ file, also_in: 'done' }); continue }
  }
  return {
    pruned: ghosts.length,
    ghosts,
    pushed: ghosts.length > 0,
  }
}

test.describe('Phase 1.10ag — ghost-duplicate prevention contract', () => {
  test('(d) spec in cancelled/ → safeRequeue ok:false, nothing created', () => {
    const result = safeRequeueRef({
      specId: 'phase-ghost-d',
      body: 'fresh body',
      buckets: { cancelled: new Set(['phase-ghost-d.md']) },
    })
    expect(result.ok).toBe(false)
    expect(result.created).toBe(false)
    expect(result.reason).toBe('already in cancelled')
  })

  test('(d.1) spec in failed/ → safeRequeue ok:false', () => {
    const result = safeRequeueRef({
      specId: 'phase-ghost-d1',
      body: 'fresh body',
      buckets: { failed: new Set(['phase-ghost-d1.md']) },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('already in failed')
  })

  test('(d.2) spec in done/ → safeRequeue ok:false (would produce 0-file ship)', () => {
    const result = safeRequeueRef({
      specId: 'phase-ghost-d2',
      body: 'fresh body',
      buckets: { done: new Set(['phase-ghost-d2.md']) },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('already in done')
  })

  test('(d.3) spec in queued/ → safeRequeue ok:true but created:false (idempotent)', () => {
    const result = safeRequeueRef({
      specId: 'phase-ghost-d3',
      body: 'fresh body',
      buckets: { queued: new Set(['phase-ghost-d3.md']) },
    })
    expect(result.ok).toBe(true)
    expect(result.created).toBe(false)
    expect(result.reason).toBe('already in queued')
  })

  test('(d.4) spec in NO bucket + body provided → safeRequeue ok:true, created:true', () => {
    const result = safeRequeueRef({
      specId: 'phase-ghost-d4',
      body: 'fresh body',
      buckets: {},
    })
    expect(result.ok).toBe(true)
    expect(result.created).toBe(true)
  })

  test('(d.5) spec in NO bucket + no body → safeRequeue ok:false (no_source)', () => {
    const result = safeRequeueRef({
      specId: 'phase-ghost-d5',
      buckets: {},
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_source')
  })

  test('(e) safeRequeueWithReset archives every prior copy across buckets', () => {
    const result = safeRequeueWithResetRef({
      specId: 'phase-ghost-e',
      buckets: {
        cancelled: new Set(['phase-ghost-e.md']),
        failed: new Set(['phase-ghost-e.md']),
        'in-progress': new Set(['phase-ghost-e.md']),
      },
    })
    expect(result.ok).toBe(true)
    expect(result.archived).toContain('cancelled/phase-ghost-e.md')
    expect(result.archived).toContain('failed/phase-ghost-e.md')
    expect(result.archived).toContain('in-progress/phase-ghost-e.md')
    expect(result.archived).toHaveLength(3)
  })

  test('(e.1) safeRequeueWithReset on a spec with no prior copies → archived:[]', () => {
    const result = safeRequeueWithResetRef({
      specId: 'phase-ghost-e1',
      buckets: {},
    })
    expect(result.ok).toBe(true)
    expect(result.archived).toEqual([])
  })

  test('(f) cleanup-ghosts prunes in-progress files that exist in terminal buckets', () => {
    const response = cleanupGhostsRef({
      inProgress: new Set(['phase-ghost-1.md', 'phase-ghost-2.md', 'phase-real-flight.md']),
      cancelled: new Set(['phase-ghost-1.md']),
      failed: new Set(['phase-ghost-2.md']),
      done: new Set(),
    })
    expect(response.pruned).toBe(2)
    expect(response.ghosts).toHaveLength(2)
    expect(response.pushed).toBe(true)
    const ghostFiles = response.ghosts.map(g => g.file)
    expect(ghostFiles).toContain('phase-ghost-1.md')
    expect(ghostFiles).toContain('phase-ghost-2.md')
    expect(ghostFiles).not.toContain('phase-real-flight.md')
  })

  test('(f.1) cleanup-ghosts on clean queue returns pruned:0, pushed:false', () => {
    const response = cleanupGhostsRef({
      inProgress: new Set(['phase-real-flight.md']),
      cancelled: new Set(),
      failed: new Set(),
      done: new Set(),
    })
    expect(response.pruned).toBe(0)
    expect(response.ghosts).toHaveLength(0)
    expect(response.pushed).toBe(false)
  })

  test('(f.2) cleanup-ghosts records correct also_in bucket per ghost', () => {
    const response = cleanupGhostsRef({
      inProgress: new Set(['a.md', 'b.md', 'c.md']),
      cancelled: new Set(['a.md']),
      failed: new Set(['b.md']),
      done: new Set(['c.md']),
    })
    expect(response.pruned).toBe(3)
    const byFile = Object.fromEntries(response.ghosts.map(g => [g.file, g.also_in]))
    expect(byFile['a.md']).toBe('cancelled')
    expect(byFile['b.md']).toBe('failed')
    expect(byFile['c.md']).toBe('done')
  })
})
