import { existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

export function checkTestsExist(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const root = getRepoRoot()

  // Only flag if the spec explicitly requires tests
  const testsMentioned =
    spec.testsRequired.length > 0 ||
    spec.acceptanceCriteria.some(c => /playwright|vitest|test|spec|e2e/i.test(c))

  if (!testsMentioned) return gaps

  for (const testPath of spec.testsRequired) {
    const fullPath = join(root, testPath)
    if (!existsSync(fullPath)) {
      gaps.push({
        check: 'tests-exist',
        severity: 'fail',
        expected: `Test file ${testPath} exists`,
        actual: `${testPath} is missing`,
        remediation: `Create ${testPath} with test cases for the feature`,
      })
    }
  }

  return gaps
}
