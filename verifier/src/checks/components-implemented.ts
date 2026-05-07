import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

// Patterns that indicate a component is a thin wrapper / stub, not a real implementation
const STUB_INDICATORS: RegExp[] = [
  /export default function \w+\(\)[^{]*\{\s*return null\s*\}/,
  /export default function \w+\(\)[^{]*\{\s*return <>\s*<\/>\s*\}/,
  /<NotImplemented[\s/]/,
  /import NotImplemented/,
  /throw new Error\(['"](not implemented|TODO)['"]\)/i,
]

// Files that legitimately contain stub-pattern *literals* (regex sources, test
// fixtures). Scanning them would flag self-reference matches that aren't real
// stubs. Mirrors the SCAN_EXCLUSIONS in stub-detector.ts.
const SCAN_EXCLUSIONS: RegExp[] = [
  /^verifier\/src\/checks\/stub-detector\.ts$/,
  /^verifier\/src\/checks\/components-implemented\.ts$/,
  /^verifier\/src\/__tests__\//,
  /^verifier\/src\/checks\/__tests__\//,
]

function isScanExcluded(filePath: string): boolean {
  return SCAN_EXCLUSIONS.some(re => re.test(filePath))
}

const MIN_IMPL_LINES = 5

export function checkComponentsImplemented(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const root = getRepoRoot()

  const componentFiles = spec.filesRequired.filter(
    f => f.endsWith('.tsx') || f.endsWith('.ts'),
  )

  for (const filePath of componentFiles) {
    if (isScanExcluded(filePath)) continue // skip files that define stub patterns as literals
    const fullPath = join(root, filePath)
    if (!existsSync(fullPath)) continue // files-exist handles missing files

    const content = readFileSync(fullPath, 'utf-8')

    // Check stub indicators first (highest priority)
    for (const indicator of STUB_INDICATORS) {
      if (indicator.test(content)) {
        gaps.push({
          check: 'components-implemented',
          severity: 'fail',
          expected: `${filePath} fully implemented`,
          actual: `${filePath} matches stub indicator: ${indicator.source}`,
          remediation: `Replace stub in ${filePath} with real implementation`,
        })
        break
      }
    }

    // Warn on suspiciously thin files (few non-import, non-comment lines)
    const meaningfulLines = content
      .split('\n')
      .filter(l => {
        const t = l.trim()
        return t.length > 0 && !t.startsWith('import') && !t.startsWith('//')
      })

    if (meaningfulLines.length < MIN_IMPL_LINES) {
      gaps.push({
        check: 'components-implemented',
        severity: 'warn',
        expected: `${filePath} has ≥${MIN_IMPL_LINES} non-import lines`,
        actual: `${filePath} has only ${meaningfulLines.length} — likely a stub`,
        remediation: `Implement the full component in ${filePath} per task spec`,
      })
    }
  }

  return gaps
}
