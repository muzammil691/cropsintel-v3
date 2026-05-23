// Cluster 7da23cc3f830 fix — `findInheritedBody` must walk the rem chain
// in newest-first order so each remediation attempt inherits the Builder's
// prior-attempt enumeration (in particular the back-ticked file paths
// Verifier reads as spec.filesRequired). See ADR
// docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md §3.2.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findInheritedBody } from './plan-server'

let repoRoot: string

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'plan-server-test-'))
  mkdirSync(join(repoRoot, '.agent/tasks/failed'), { recursive: true })
  mkdirSync(join(repoRoot, '.agent/tasks/done'), { recursive: true })
})

afterEach(() => {
  if (repoRoot) rmSync(repoRoot, { recursive: true, force: true })
})

describe('findInheritedBody', () => {
  const taskId = 'phase-1.0x-example'
  const originalBody = '# Original spec\n\nTitle-only.\n'
  const rem1Body = '# Rem1\n\nBuilder enumerated `src/foo.ts` and `src/bar.ts`.\n'
  const rem2Body = '# Rem2\n\nBuilder enumerated `src/foo.ts`, `src/bar.ts`, `src/baz.ts`.\n'

  it('attempt=2 reads -rem.md (rem1), not the title-only original', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}.md`), originalBody)
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}-rem.md`), rem1Body)

    const out = await findInheritedBody({ taskId, attempt: 2, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe(rem1Body)
    expect(out!.source).toBe(`failed/${taskId}-rem.md`)
  })

  it('attempt=3 reads -rem2.md, not -rem.md or the original', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}.md`), originalBody)
    writeFileSync(join(repoRoot, '.agent/tasks/done', `${taskId}-rem.md`), rem1Body)
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}-rem2.md`), rem2Body)

    const out = await findInheritedBody({ taskId, attempt: 3, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe(rem2Body)
    expect(out!.source).toBe(`failed/${taskId}-rem2.md`)
  })

  it('attempt=3 falls through to -rem.md when -rem2.md is missing', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}.md`), originalBody)
    writeFileSync(join(repoRoot, '.agent/tasks/done', `${taskId}-rem.md`), rem1Body)
    // no rem2

    const out = await findInheritedBody({ taskId, attempt: 3, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe(rem1Body)
    expect(out!.source).toBe(`done/${taskId}-rem.md`)
  })

  it('attempt=2 falls through to the original when no rem1 exists', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}.md`), originalBody)

    const out = await findInheritedBody({ taskId, attempt: 2, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe(originalBody)
    expect(out!.source).toBe(`failed/${taskId}.md`)
  })

  it('attempt=3 falls all the way through to the original when neither rem exists', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/done', `${taskId}.md`), originalBody)

    const out = await findInheritedBody({ taskId, attempt: 3, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe(originalBody)
    expect(out!.source).toBe(`done/${taskId}.md`)
  })

  it('returns null when nothing exists under failed/ or done/', async () => {
    const out = await findInheritedBody({ taskId, attempt: 2, repoRoot })
    expect(out).toBeNull()
  })

  it('attempt=1 reads only the original (no rem chain to walk)', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}.md`), originalBody)
    // A stray rem file must not be picked up at attempt=1.
    writeFileSync(join(repoRoot, '.agent/tasks/done', `${taskId}-rem.md`), rem1Body)

    const out = await findInheritedBody({ taskId, attempt: 1, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe(originalBody)
    expect(out!.source).toBe(`failed/${taskId}.md`)
  })

  it('inherited body preserves back-ticked file paths so spec.filesRequired survives the requeue', async () => {
    const enumeratedBody = '# Rem1\n\nFiles required:\n- `atlas/src/lib/plan-server.ts`\n- `atlas/src/lib/plan-server.test.ts`\n'
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}.md`), '# Original\n')
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}-rem.md`), enumeratedBody)

    const out = await findInheritedBody({ taskId, attempt: 2, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toContain('`atlas/src/lib/plan-server.ts`')
    expect(out!.content).toContain('`atlas/src/lib/plan-server.test.ts`')
  })

  it('prefers failed/ over done/ for the same filename', async () => {
    writeFileSync(join(repoRoot, '.agent/tasks/failed', `${taskId}-rem.md`), 'failed-version')
    writeFileSync(join(repoRoot, '.agent/tasks/done', `${taskId}-rem.md`), 'done-version')

    const out = await findInheritedBody({ taskId, attempt: 2, repoRoot })
    expect(out).not.toBeNull()
    expect(out!.content).toBe('failed-version')
    expect(out!.source).toBe(`failed/${taskId}-rem.md`)
  })
})
