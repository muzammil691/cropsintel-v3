// Phase 1.10af §5 — git mutex serialization test.
//
// Spawns 5 concurrent withGitLock calls running `git rev-parse HEAD` against a
// real (temporary) git repo and asserts:
//   1. All complete successfully (none throw `Unable to create '.git/index.lock'`).
//   2. They serialize — operations do not overlap (counter check).
//
// We assert serialization by tracking entry/exit of the wrapped function: at
// any moment, only one body should be executing. Two concurrent bodies would
// be observed as `inFlight > 1`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { withGitLock } from '../git-mutex'

const execFileP = promisify(execFile)

let repoDir: string

beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'atlas-git-mutex-test-'))
  await execFileP('git', ['init', '--quiet', '-b', 'main'], { cwd: repoDir })
  await execFileP('git', ['config', 'user.email', 'test@cropsintel.local'], { cwd: repoDir })
  await execFileP('git', ['config', 'user.name', 'mutex-test'], { cwd: repoDir })
  writeFileSync(join(repoDir, 'README.md'), '# mutex test\n')
  await execFileP('git', ['add', 'README.md'], { cwd: repoDir })
  await execFileP('git', ['commit', '--quiet', '-m', 'init'], { cwd: repoDir })
})

afterAll(() => {
  if (repoDir) rmSync(repoDir, { recursive: true, force: true })
})

describe('withGitLock', () => {
  it('serializes 5 concurrent rev-parse calls without index.lock collisions', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let observedOverlap = false

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        withGitLock(`test-${i}`, async () => {
          inFlight++
          if (inFlight > 1) observedOverlap = true
          if (inFlight > maxInFlight) maxInFlight = inFlight
          try {
            const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
              cwd: repoDir,
            })
            return stdout.trim()
          } finally {
            inFlight--
          }
        }),
      ),
    )

    expect(results).toHaveLength(5)
    for (const sha of results) {
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    }
    expect(observedOverlap).toBe(false)
    expect(maxInFlight).toBe(1)
  })

  it('does not poison the chain when one operation rejects', async () => {
    const order: string[] = []
    const failing = withGitLock('fail', async () => {
      order.push('fail-start')
      throw new Error('boom')
    }).catch(err => err.message)
    const succeeding = withGitLock('ok', async () => {
      order.push('ok-start')
      return 'ok'
    })

    const [errMsg, okResult] = await Promise.all([failing, succeeding])
    expect(errMsg).toBe('boom')
    expect(okResult).toBe('ok')
    expect(order).toEqual(['fail-start', 'ok-start'])
  })
})
