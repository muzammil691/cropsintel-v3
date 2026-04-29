import { existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

export function checkFilesExist(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const root = getRepoRoot()

  for (const filePath of spec.filesRequired) {
    const fullPath = join(root, filePath)
    if (!existsSync(fullPath)) {
      gaps.push({
        check: 'files-exist',
        severity: 'fail',
        expected: `${filePath} exists`,
        actual: `${filePath} is missing`,
        remediation: `Create ${filePath} per task spec`,
      })
    }
  }

  return gaps
}
