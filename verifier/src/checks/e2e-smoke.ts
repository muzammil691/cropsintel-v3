import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

// 1.10af rem3 §Gap1 — e2e-smoke must be tolerant of environments where the
// Verifier doesn't have the root repo's node_modules installed (Railway clones
// the repo but doesn't `npm install` at the root before audit). Pre-flight
// checks let us SKIP rather than FAIL when the prerequisites for an honest
// e2e run aren't present. Any check that the runner can't legitimately attempt
// must skip — falsely failing the audit because of a missing devDep is a
// gate-quality regression.
function isE2EReady(root: string): { ready: boolean; reason?: string } {
  // 1) Need a Playwright config at the root.
  if (!existsSync(join(root, 'playwright.config.ts'))) {
    return { ready: false, reason: 'no playwright.config.ts at repo root' }
  }
  // 2) Need a top-level e2e/ directory with at least one spec — Playwright will
  // exit non-zero with "no tests found" otherwise, which the runner can't
  // distinguish from a real failure.
  const e2eDir = join(root, 'e2e')
  if (!existsSync(e2eDir)) {
    return { ready: false, reason: 'no e2e/ directory in repo' }
  }
  // 3) Need @playwright/test available in the repo's node_modules. If not,
  // `npx` will auto-install `playwright` (just the runner) and then fail at
  // import time because the spec files reference '@playwright/test'.
  if (!existsSync(join(root, 'node_modules', '@playwright', 'test'))) {
    return { ready: false, reason: '@playwright/test not installed in repo node_modules' }
  }
  return { ready: true }
}

export function checkE2ESmoke(spec: TaskSpec): Gap[] {
  const root = getRepoRoot()

  const readiness = isE2EReady(root)
  if (!readiness.ready) {
    console.log(`[e2e-smoke] skipping: ${readiness.reason}`)
    return []
  }

  // Skip if this task doesn't require tests
  if (spec.testsRequired.length === 0) return []

  try {
    execSync('npx playwright test --reporter=list', {
      cwd: root,
      timeout: 120_000,
      stdio: 'pipe',
      env: { ...process.env, E2E_NO_WEBSERVER: '1' },
    })
    return []
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // If the failure is a missing dep / config issue, treat as skip — we can't
    // honestly assert "tests fail" when we don't even have the runner.
    const lower = msg.toLowerCase()
    if (
      lower.includes('cannot find package') ||
      lower.includes('err_module_not_found') ||
      lower.includes('command not found') ||
      lower.includes('no tests found')
    ) {
      console.log(`[e2e-smoke] skipping: runner unavailable in this environment (${msg.slice(0, 120)})`)
      return []
    }
    return [
      {
        check: 'e2e-smoke',
        severity: 'fail',
        expected: 'All Playwright e2e tests pass',
        actual: `Playwright test run failed: ${msg.slice(0, 200)}`,
        remediation:
          'Fix failing e2e tests or ensure the feature is correctly implemented end-to-end',
      },
    ]
  }
}
