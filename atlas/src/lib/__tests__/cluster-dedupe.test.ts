// Unit tests for the persistent cluster-dedupe gate. Each test builds a
// synthetic temp repo with the directory structure the gate expects, then
// exercises one gate in isolation. Gates are precedence-ordered (closed-adr >
// trailing-window > shipped-rem > in-process); tests for lower-precedence
// gates leave the higher-precedence directories empty so the lookup falls
// through.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkClusterDedupe,
  rememberClusterKey,
  _resetInProcessClusterKeys,
} from '../cluster-dedupe'

let repoRoot: string

const taskIds = [
  'phase-1.10af-workflow-quality-gates-fix',
  'phase-1.10af-workflow-quality-gates-fix-rem',
  'phase-1.10af-workflow-quality-gates-fix-rem2',
]
const clusterKey = [...taskIds].sort().join(',')
const failTimestamps = ['2026-05-07T13:30:00Z']

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'cluster-dedupe-test-'))
  mkdirSync(join(repoRoot, 'docs/atlas-decisions'), { recursive: true })
  mkdirSync(join(repoRoot, '.agent/tasks/queued'), { recursive: true })
  mkdirSync(join(repoRoot, '.agent/tasks/in-progress'), { recursive: true })
  mkdirSync(join(repoRoot, '.agent/tasks/done'), { recursive: true })
  _resetInProcessClusterKeys()
})

afterEach(() => {
  if (repoRoot) rmSync(repoRoot, { recursive: true, force: true })
  _resetInProcessClusterKeys()
})

describe('checkClusterDedupe', () => {
  it('matches the closed-ADR gate when an ADR contains all task ids', async () => {
    const adrName = 'ADR-2026-05-07-verifier-cluster-1778161030385.md'
    const adrPath = join(repoRoot, 'docs/atlas-decisions', adrName)
    const body = [
      '---',
      'adr: 2026-05-07-verifier-cluster-1778161030385',
      'status: closed-duplicate',
      `trigger: 3 Verifier failures within 30 minutes (cluster id 1778161030385)`,
      '---',
      '',
      '# ADR — verifier cluster 1778161030385',
      '',
      ...taskIds.map(t => `- ${t}`),
      '',
    ].join('\n')
    writeFileSync(adrPath, body)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(true)
    if (out.skip) {
      expect(out.reason).toBe('closed-adr')
      expect(out.evidence).toContain(adrName)
    }
  })

  it('matches the trailing-window gate when a queued cluster file lists same task ids', async () => {
    const queuedName = 'phase-1-CLUSTER-investigation-1778163111379.md'
    const queuedPath = join(repoRoot, '.agent/tasks/queued', queuedName)
    const body = [
      '# Task: Cluster investigation — Verifier failure pattern',
      '',
      '## Failed tasks',
      '',
      ...taskIds.map(t => `- **${t}** (2026-05-07T14:00:00Z): no detail`),
      '',
    ].join('\n')
    writeFileSync(queuedPath, body)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(true)
    if (out.skip) {
      expect(out.reason).toBe('trailing-window')
      expect(out.evidence).toContain(queuedName)
    }
  })

  it('ignores trailing-window cluster files older than 30 minutes', async () => {
    const queuedName = 'phase-1-CLUSTER-investigation-old.md'
    const queuedPath = join(repoRoot, '.agent/tasks/queued', queuedName)
    const body = ['# Task', '', ...taskIds.map(t => `- **${t}**`)].join('\n')
    writeFileSync(queuedPath, body)
    const oneHourAgoSeconds = (Date.now() - 60 * 60 * 1000) / 1000
    utimesSync(queuedPath, oneHourAgoSeconds, oneHourAgoSeconds)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(false)
  })

  it('matches the shipped-rem gate when a done -rem file is newer than the failure timestamp', async () => {
    const remName = 'phase-1.10af-workflow-quality-gates-fix-rem3.md'
    const remPath = join(repoRoot, '.agent/tasks/done', remName)
    writeFileSync(remPath, '# Remediation\n')
    const futureSeconds = Date.parse('2026-05-07T15:00:00Z') / 1000
    utimesSync(remPath, futureSeconds, futureSeconds)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(true)
    if (out.skip) {
      expect(out.reason).toBe('shipped-rem')
      expect(out.evidence).toContain(remName)
    }
  })

  it('does not match shipped-rem gate when the done -rem file is older than the failure timestamp', async () => {
    const remName = 'phase-1.10af-workflow-quality-gates-fix-rem3.md'
    const remPath = join(repoRoot, '.agent/tasks/done', remName)
    writeFileSync(remPath, '# Remediation\n')
    const pastSeconds = Date.parse('2026-05-07T12:00:00Z') / 1000
    utimesSync(remPath, pastSeconds, pastSeconds)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(false)
  })

  it('matches the in-process gate when clusterKey was previously remembered', async () => {
    rememberClusterKey(clusterKey)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(true)
    if (out.skip) {
      expect(out.reason).toBe('in-process')
      expect(out.evidence).toContain('in-process')
    }
  })

  it('returns skip:false when no gate matches', async () => {
    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(false)
  })

  it('respects gate precedence: closed-adr beats trailing-window beats shipped-rem beats in-process', async () => {
    const adrName = 'ADR-2026-05-07-verifier-cluster-1778161030385.md'
    writeFileSync(
      join(repoRoot, 'docs/atlas-decisions', adrName),
      `# ADR\n${taskIds.map(t => `- ${t}`).join('\n')}\n`,
    )
    writeFileSync(
      join(repoRoot, '.agent/tasks/queued/phase-1-CLUSTER-investigation-x.md'),
      `# Task\n${taskIds.map(t => `- **${t}**`).join('\n')}\n`,
    )
    const remPath = join(repoRoot, '.agent/tasks/done/phase-1.10af-workflow-quality-gates-fix-rem9.md')
    writeFileSync(remPath, '# rem\n')
    const futureSeconds = Date.parse('2026-05-07T15:00:00Z') / 1000
    utimesSync(remPath, futureSeconds, futureSeconds)
    rememberClusterKey(clusterKey)

    const out = await checkClusterDedupe({ clusterKey, taskIds, failTimestamps, repoRoot })
    expect(out.skip).toBe(true)
    if (out.skip) {
      expect(out.reason).toBe('closed-adr')
    }
  })
})
