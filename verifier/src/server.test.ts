import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { IncomingMessage, ServerResponse } from 'http'

// Regression tests for ADR-2026-05-23-verifier-cluster-7da23cc3f830 §3.3 / §5
// priority-3 — the post-sync HEAD assertion in handleAudit. If syncToCommitOnDisk
// returns without advancing on-disk HEAD to head_after (the rem1 stale-pull
// window), the Verifier must NOT proceed to read files at the stale tree.
// Instead it emits verdict='unknown' with reason='sync_failed' and a structured
// log line including both expected (head_after) and actual (current HEAD).

// Mocks must be hoisted to top-level (vitest 4.x requirement). Mock the
// transitive openai-o3 chain via ./verify so test runs without verifier deps
// installed locally — the sync_failed path returns before verify is called.
vi.mock('./verify', () => ({
  verify: vi.fn(async () => ({
    verdict: 'pass',
    confidence: 0.95,
    gaps: [],
    judgmentCallNotes: '',
  })),
}))

vi.mock('./research', () => ({
  runResearch: vi.fn(async () => ({ findings: [], confidence: 0 })),
}))

vi.mock('./lib/supabase', () => ({
  getSupabaseClient: () => null,
  requireSupabaseClient: () => {
    throw new Error('mocked: supabase client unavailable in tests')
  },
}))

let tmpDir: string
const ORIGINAL_REPO_ROOT = process.env.REPO_ROOT

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'verifier-server-sync-test-'))
  process.env.REPO_ROOT = tmpDir
})

afterEach(() => {
  if (ORIGINAL_REPO_ROOT === undefined) {
    delete process.env.REPO_ROOT
  } else {
    process.env.REPO_ROOT = ORIGINAL_REPO_ROOT
  }
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('handleAudit — post-sync HEAD assertion (stale-pull regression)', () => {
  it('emits verdict=unknown / reason=sync_failed when on-disk HEAD does not match head_after', async () => {
    const { execFileSync } = await import('child_process')
    execFileSync('git', ['init', '-q'], { cwd: tmpDir })
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir })
    writeFileSync(join(tmpDir, 'README.md'), 'stale-head regression repo')
    execFileSync('git', ['add', '.'], { cwd: tmpDir })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmpDir })
    const realHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir })
      .toString()
      .trim()

    // Plausible-looking SHA that does not exist in the repo. The fetch fails
    // (no `origin` remote) and reset --hard fails (unknown SHA), so HEAD stays
    // pinned to realHead — exactly the stale-pull condition the assertion guards.
    const fakeHeadAfter = 'deadbeefcafebabe0123456789abcdef01234567'
    expect(fakeHeadAfter).not.toBe(realHead)

    const { handleAudit } = await import('./server.js')

    // server.ts reads VERIFIER_API_TOKEN at module load. Forge the matching
    // Bearer when the env var is set so the auth gate doesn't short-circuit
    // the sync_failed path under test.
    const apiToken = process.env.VERIFIER_API_TOKEN ?? ''
    const authHeader = apiToken ? `Bearer ${apiToken}` : ''

    const req = {
      headers: authHeader ? { authorization: authHeader } : {},
      on: vi.fn((event: string, handler: (chunk?: Buffer) => void) => {
        if (event === 'data') {
          handler(
            Buffer.from(
              JSON.stringify({
                task_id: 'phase-test-stale-head',
                head_before: realHead,
                head_after: fakeHeadAfter,
              }),
            ),
          )
        } else if (event === 'end') {
          handler()
        }
      }),
    } as unknown as IncomingMessage

    let responseStatus = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((status: number) => {
        responseStatus = status
      }),
      end: vi.fn((body: string) => {
        responseBody = body
      }),
    } as unknown as ServerResponse

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await handleAudit(req, res)

    expect(responseStatus).toBe(200)
    const parsed = JSON.parse(responseBody)
    expect(parsed.verdict).toBe('unknown')
    expect(parsed.reason).toBe('sync_failed')
    expect(parsed.confidence).toBe(0)
    expect(parsed.gaps).toEqual([])

    // Acceptance criterion 2: the structured log line must include both
    // expected (head_after) and actual (current HEAD) so operators can diff
    // them in Railway logs. Find the sync_failed log among all error calls.
    const syncFailedLogs = errorSpy.mock.calls
      .map(args => args.join(' '))
      .filter(line => line.includes('sync_failed'))
    expect(syncFailedLogs.length).toBeGreaterThan(0)
    const syncFailedLog = syncFailedLogs[0]
    expect(syncFailedLog).toContain(`expected=${fakeHeadAfter}`)
    expect(syncFailedLog).toContain(`actual=${realHead}`)

    errorSpy.mockRestore()
  })

  it('source: post-sync assertion runs immediately after syncToCommitOnDisk and before findTaskSpec', async () => {
    // Static check on the source to lock in acceptance criterion 1 — the
    // assertion must sit between the sync call and any file reads. If a future
    // refactor reorders these, this test catches it before deployment.
    const { readFileSync } = await import('fs')
    const serverCode = readFileSync(join(__dirname, 'server.ts'), 'utf-8')

    const syncIdx = serverCode.indexOf('syncToCommitOnDisk(REPO_ROOT, head_after)')
    const assertionIdx = serverCode.indexOf('actualHead !== head_after')
    const findSpecIdx = serverCode.indexOf('findTaskSpec(task_id)')

    expect(syncIdx).toBeGreaterThan(0)
    expect(assertionIdx).toBeGreaterThan(syncIdx)
    expect(findSpecIdx).toBeGreaterThan(assertionIdx)
  })
})
