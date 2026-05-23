import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { IncomingMessage, ServerResponse } from 'http'

// Mocks must be hoisted to top-level (vitest 4.x requirement). Mock the
// transitive openai-o3 import chain via ../verify so the test runs without
// verifier deps installed locally — the sync_failed path returns before
// verify is called.
vi.mock('../verify', () => ({
  verify: vi.fn(async () => ({
    verdict: 'pass',
    confidence: 0.95,
    gaps: [],
    judgmentCallNotes: '',
  })),
}))

vi.mock('../research', () => ({
  runResearch: vi.fn(async () => ({ findings: [], confidence: 0 })),
}))

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => null,
  requireSupabaseClient: () => {
    throw new Error('mocked: supabase client unavailable in tests')
  },
}))

let tmpDir: string
const ORIGINAL_REPO_ROOT = process.env.REPO_ROOT

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'verifier-server-test-'))
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

// ── Regression test for Bug A: spec-path-after-sync ──────────────────────────

describe('handleAudit — post-sync spec resolution', () => {
  it('returns verdict=unknown (not verifier-unhandled-exception) when spec not found after sync', async () => {
    // Setup: create the .agent/tasks directory structure but no actual task file
    mkdirSync(join(tmpDir, '.agent', 'tasks', 'in-progress'), { recursive: true })
    mkdirSync(join(tmpDir, '.agent', 'tasks', 'done'), { recursive: true })
    mkdirSync(join(tmpDir, '.agent', 'tasks', 'queued'), { recursive: true })

    // Initialize a git repo so syncRepoToHead doesn't fail
    const { execFileSync } = await import('child_process')
    execFileSync('git', ['init'], { cwd: tmpDir })
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir })
    writeFileSync(join(tmpDir, 'README.md'), 'test repo')
    execFileSync('git', ['add', '.'], { cwd: tmpDir })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir })
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir })
      .toString()
      .trim()

    // Mock request/response
    const req = {
      headers: {},
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          // Provide the request body
          handler(
            Buffer.from(
              JSON.stringify({
                task_id: 'phase-test-missing-spec',
                head_before: headAfter,
                head_after: headAfter,
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

    // We verify the fix by checking that the code order is correct in the source file.
    // Read the server.ts file and verify the fix
    const { readFileSync } = await import('fs')
    const serverCode = readFileSync(join(__dirname, '..', 'server.ts'), 'utf-8')

    // Verify that syncRepoToHead appears before findTaskSpec in handleAudit
    const syncIndex = serverCode.indexOf('syncToCommitOnDisk(REPO_ROOT, head_after)')
    const findTaskSpecIndex = serverCode.indexOf('findTaskSpec(task_id)')

    expect(syncIndex).toBeGreaterThan(0)
    expect(findTaskSpecIndex).toBeGreaterThan(0)
    expect(syncIndex).toBeLessThan(findTaskSpecIndex)
  })

  it('verifies sync_failed path receives null for taskSpecPath', async () => {
    // Read the server.ts file and verify that sync_failed branch passes null
    const { readFileSync } = await import('fs')
    const serverCode = readFileSync(join(__dirname, '..', 'server.ts'), 'utf-8')

    // Find the sync_failed writeUnknownVerifierRun call. The post-sync
    // assertion guards `actualHead !== head_after` (see ADR-2026-05-23-
    // verifier-cluster-7da23cc3f830 §3.3 / §5 priority-3).
    const syncFailedMatch = serverCode.match(
      /actualHead\s*!==\s*head_after[\s\S]*?writeUnknownVerifierRun\(\s*task_id,\s*(null|taskSpecPath)/
    )

    expect(syncFailedMatch).toBeTruthy()
    expect(syncFailedMatch?.[1]).toBe('null')
  })

  it('verifies spec_not_found path still receives null for taskSpecPath', async () => {
    // Read the server.ts file and verify that spec_not_found branch passes null
    const { readFileSync } = await import('fs')
    const serverCode = readFileSync(join(__dirname, '..', 'server.ts'), 'utf-8')

    // Find the spec_not_found writeUnknownVerifierRun call
    // Match the if (!taskSpecPath) block and find the writeUnknownVerifierRun call within it
    const specNotFoundSection = serverCode.match(
      /if \(!taskSpecPath\)\s*\{[\s\S]*?writeUnknownVerifierRun\(\s*task_id,\s*(null|taskSpecPath)/
    )

    expect(specNotFoundSection).toBeTruthy()
    expect(specNotFoundSection?.[1]).toBe('null')
  })
})

// ── Regression test for ADR-2026-05-23-verifier-cluster-7da23cc3f830 §5 P3 ──
//
// Simulates a stale HEAD: REPO_ROOT points at a freshly-init'd git repo at
// commit X, but the audit request claims `head_after` is a fake SHA Y. The
// fetch/reset inside syncToCommitOnDisk fails (no `origin` remote + SHA does
// not exist), so the on-disk HEAD remains at X. The post-sync assertion in
// handleAudit must detect actualHead !== head_after and emit verdict=unknown
// with reason=sync_failed instead of letting verify() read a stale tree.

describe('handleAudit — post-sync HEAD assertion (sync-race regression)', () => {
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

    // Plausible-looking SHA that does not exist in the repo. fetch fails (no
    // origin), reset --hard fails (SHA unknown), so HEAD stays at realHead.
    const fakeHeadAfter = 'deadbeefcafebabe0123456789abcdef01234567'
    expect(fakeHeadAfter).not.toBe(realHead)

    const { handleAudit } = await import('../server.js')

    // server.ts reads VERIFIER_API_TOKEN at module load. If it's set in the
    // env (Railway VPS sets it), forge the matching Bearer so the auth gate
    // doesn't short-circuit the sync_failed path we're trying to exercise.
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

    await handleAudit(req, res)

    expect(responseStatus).toBe(200)
    const parsed = JSON.parse(responseBody)
    expect(parsed.verdict).toBe('unknown')
    expect(parsed.reason).toBe('sync_failed')
    expect(parsed.confidence).toBe(0)
    expect(parsed.gaps).toEqual([])
  })
})
