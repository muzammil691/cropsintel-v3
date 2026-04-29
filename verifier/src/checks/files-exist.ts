import { existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

const KNOWN_REPO_PREFIXES = [
  'src/', 'supabase/', '.agent/', 'agent/', 'verifier/', 'memory/',
  'council/', 'adela/', 'docs/', 'public/', '.github/',
]

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

function normalizeFilePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\//, '').replace(/^cropsintel-v3\//, '')
}

// Returns false for paths that live outside the repo (home-dir refs, V2 sources, etc.).
function isRepoRelativePath(p: string): boolean {
  if (p.startsWith('~/')) return false
  const normalized = normalizeFilePath(p)
  return KNOWN_REPO_PREFIXES.some(prefix => normalized.startsWith(prefix))
}

export function checkFilesExist(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const root = getRepoRoot()

  for (const filePath of spec.filesRequired) {
    if (!isRepoRelativePath(filePath)) continue // skip external / unrecognized paths

    const normalized = normalizeFilePath(filePath)
    const fullPath = join(root, normalized)
    if (!existsSync(fullPath)) {
      gaps.push({
        check: 'files-exist',
        severity: 'fail',
        expected: `${normalized} exists`,
        actual: `${normalized} is missing`,
        remediation: `Create ${normalized} per task spec`,
      })
    }
  }

  return gaps
}
