import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

// Files excluded from stub scanning: these define or import stub patterns as
// literals, so the patterns will trivially match themselves.
const SCAN_EXCLUSIONS: RegExp[] = [
  /^verifier\/src\/checks\/stub-detector\.ts$/,
  /^verifier\/src\/__tests__\//,
  /^memory\/src\/embed\.ts$/,
]

function isExcluded(filePath: string): boolean {
  return SCAN_EXCLUSIONS.some(re => re.test(filePath))
}

// Patterns that indicate incomplete/stub implementations
const STUB_PATTERNS: RegExp[] = [
  /\/\/ STUB\b/i,
  /\/\/ TODO: implement/i,
  /\/\/ Phase \d+\.\d+ will/i,
  /<\w+ STUB/,
  /\bcoming soon\b/i,
  /Real implementation lands in/i,
  /Real content lands in/i,
  /will wire \d+ login methods/i,
  /will be added later/i,
  // CropsIntel-specific: NotImplemented component usage
  /<NotImplemented[\s/]/,
  /import NotImplemented/,
  // Generic scaffold markers
  /Phase \d+ scaffold/i,
  /agent infrastructure deploying/i,
  /Full product after Phase/i,
  /Production launch follows master plan/i,
]

export function checkStubDetector(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const root = getRepoRoot()

  for (const filePath of spec.filesRequired) {
    if (isExcluded(filePath)) continue // skip files that define stub patterns as literals
    const fullPath = join(root, filePath)
    if (!existsSync(fullPath)) continue // files-exist check handles missing files

    const content = readFileSync(fullPath, 'utf-8')

    for (const pattern of STUB_PATTERNS) {
      if (pattern.test(content)) {
        gaps.push({
          check: 'stub-detector',
          severity: 'fail',
          expected: `${filePath} fully implemented`,
          actual: `${filePath} contains stub pattern: ${pattern.source}`,
          remediation: `Replace stub in ${filePath} with full implementation per task spec`,
        })
        break // one gap per file — avoid flooding the report
      }
    }
  }

  return gaps
}
