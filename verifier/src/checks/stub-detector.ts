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
  // Generic scaffold markers
  /Phase \d+ scaffold/i,
  /agent infrastructure deploying/i,
  /Full product after Phase/i,
  /Production launch follows master plan/i,
  // 1.10af §6 — runtime stub: a function body that immediately throws
  // "not implemented" is the JS analogue of a TODO comment. Only matches the
  // explicit phrase (case-insensitive) so legitimate error throws aren't flagged.
  /throw\s+new\s+Error\(\s*['"`]\s*not\s+implemented/i,
]

// CropsIntel-specific: NotImplemented patterns are sometimes intentional
// (placeholder for un-built routes per master plan §11.2). These are checked
// separately so we can whitelist legitimate uses without weakening the rest.
const NOT_IMPLEMENTED_PATTERN = /<NotImplemented[\s/>]/
const NOT_IMPLEMENTED_IMPORT_PATTERN = /import\s+NotImplemented\b/

/**
 * Bug H fix — distinguish intentional NotImplemented placeholders from
 * accidental stubs. A `<NotImplemented phase="X" />` usage in route definitions
 * or in a tiny placeholder page is the canonical pattern from the master plan;
 * a bare `<NotImplemented />` in arbitrary component code is suspicious.
 *
 * Returns true when the usage in the file should NOT be flagged.
 */
export function isNotImplementedWhitelisted(filePath: string, content: string): boolean {
  // Rule 1: src/App.tsx — usage must be inside a <Route element={...} /> prop.
  if (filePath === 'src/App.tsx') {
    // Look for <NotImplemented inside a Route element. We accept the file
    // wholesale when ALL <NotImplemented occurrences sit inside route elements.
    // Simpler heuristic: if the file contains <Route ... element={<NotImplemented
    // (allowing whitespace and other props), call it whitelisted.
    if (/<Route[^>]*element=\{[^}]*<NotImplemented/.test(content)) {
      return true
    }
    return false
  }

  // Rule 2: src/pages/*.tsx with fewer than 30 non-empty lines is clearly a
  // placeholder page.
  if (/^src\/pages\/[^/]+\.tsx$/.test(filePath)) {
    const lineCount = content.split('\n').filter(l => l.trim().length > 0).length
    if (lineCount < 30) return true
  }

  // Rule 3: any usage carrying a `phase=` prop is an intentional placeholder.
  // <NotImplemented phase="1.6" /> or <NotImplemented phase={...} />
  if (/<NotImplemented[^/>]*\bphase=/.test(content)) {
    return true
  }

  return false
}

export function checkStubDetector(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const root = getRepoRoot()

  for (const filePath of spec.filesRequired) {
    if (isExcluded(filePath)) continue // skip files that define stub patterns as literals
    const fullPath = join(root, filePath)
    if (!existsSync(fullPath)) continue // files-exist check handles missing files

    const content = readFileSync(fullPath, 'utf-8')

    // 1. Generic stub patterns — always flagged
    let matched: RegExp | null = null
    for (const pattern of STUB_PATTERNS) {
      if (pattern.test(content)) {
        matched = pattern
        break
      }
    }

    // 2. NotImplemented patterns — only flagged when NOT whitelisted
    if (!matched) {
      const hasNotImplemented =
        NOT_IMPLEMENTED_PATTERN.test(content) || NOT_IMPLEMENTED_IMPORT_PATTERN.test(content)
      if (hasNotImplemented && !isNotImplementedWhitelisted(filePath, content)) {
        matched = NOT_IMPLEMENTED_PATTERN.test(content)
          ? NOT_IMPLEMENTED_PATTERN
          : NOT_IMPLEMENTED_IMPORT_PATTERN
      }
    }

    if (matched) {
      gaps.push({
        check: 'stub-detector',
        severity: 'fail',
        expected: `${filePath} fully implemented`,
        actual: `${filePath} contains stub pattern: ${matched.source}`,
        remediation: `Replace stub in ${filePath} with full implementation per task spec`,
      })
    }
  }

  return gaps
}
