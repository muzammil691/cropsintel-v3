import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

export function checkE2ESmoke(spec: TaskSpec): Gap[] {
  const root = getRepoRoot()

  // Skip if playwright is not configured in the repo
  const playwrightConfig = join(root, 'playwright.config.ts')
  if (!existsSync(playwrightConfig)) return []

  // Skip if this task doesn't require tests
  if (spec.testsRequired.length === 0) return []

  try {
    execSync('npx playwright test --reporter=list', {
      cwd: root,
      timeout: 120_000,
      stdio: 'pipe',
    })
    return []
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
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
