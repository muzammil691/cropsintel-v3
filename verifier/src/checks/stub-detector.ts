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
  /^verifier\/src\/checks\/components-implemented\.ts$/,
  /^verifier\/src\/__tests__\//,
  /^verifier\/src\/checks\/__tests__\//,
  /^memory\/src\/embed\.ts$/,
]

function isExcluded(filePath: string): boolean {
  return SCAN_EXCLUSIONS.some(re => re.test(filePath))
}

// Token-fragment helpers — patterns are assembled from non-self-matching pieces
// so the verifier source itself never contains literal stub strings (defense in
// depth against an older deployed Verifier scanning this very file).
const NI_TOKEN = 'Not' + 'Implemented'
const TODO_TOKEN = 'TO' + 'DO'

// Patterns that indicate incomplete/stub implementations.
// All regex literals below are constructed via `new RegExp(...)` with split
// string fragments so the literal pattern text never appears in this source.
const STUB_PATTERNS: RegExp[] = [
  new RegExp('\\/\\/\\s*STUB\\b', 'i'),
  new RegExp('\\/\\/\\s*' + TODO_TOKEN + ':\\s*implement', 'i'),
  new RegExp('\\/\\/\\s*Phase \\d+\\.\\d+ will', 'i'),
  new RegExp('<\\w+ STUB'),
  new RegExp('\\bcoming soon\\b', 'i'),
  new RegExp('Real implementation lands in'),
  new RegExp('Real content lands in'),
  new RegExp('will wire \\d+ login methods'),
  new RegExp('will be added later'),
  // Generic scaffold markers
  new RegExp('Phase \\d+ scaffold', 'i'),
  new RegExp('agent infrastructure deploying', 'i'),
  new RegExp('Full product after Phase', 'i'),
  new RegExp('Production launch follows master plan', 'i'),
  // 1.10af §6 — runtime stub: a function body that immediately throws an error
  // whose message is the explicit "not impl" phrase. Only matches that phrase
  // (case-insensitive) so legitimate error throws aren't flagged.
  new RegExp("throw\\s+new\\s+Error\\(\\s*['\"`]\\s*not\\s+implemented", 'i'),
]

// CropsIntel-specific: the placeholder JSX tag named in NI_TOKEN is sometimes
// intentional (route stub per master plan §11.2). Scanned separately so legit
// uses can be whitelisted without weakening the rest. Patterns built from
// string fragments to avoid self-match in this source file.
const NOT_IMPLEMENTED_PATTERN = new RegExp('<' + NI_TOKEN + '[\\s/>]')
const NOT_IMPLEMENTED_IMPORT_PATTERN = new RegExp('import\\s+' + NI_TOKEN + '\\b')

const ROUTE_NI_PATTERN = new RegExp(
  '<Route[^>]*element=\\{[^}]*<' + NI_TOKEN,
)
const NI_WITH_PHASE_PATTERN = new RegExp(
  '<' + NI_TOKEN + '[^/>]*\\bphase=',
)

/**
 * Bug H fix — distinguish intentional placeholders from accidental stubs.
 * A `<{NI_TOKEN} phase="X" />` usage in route definitions or in a tiny
 * placeholder page is the canonical pattern from the master plan;
 * a bare `<{NI_TOKEN} />` in arbitrary component code is suspicious.
 *
 * Returns true when the usage in the file should NOT be flagged.
 */
export function isNotImplementedWhitelisted(filePath: string, content: string): boolean {
  // Rule 1: src/App.tsx — usage must sit inside a <Route element={...} /> prop.
  // We accept the file wholesale when the placeholder JSX appears inside a
  // route element (allowing whitespace and other props).
  if (filePath === 'src/App.tsx') {
    if (ROUTE_NI_PATTERN.test(content)) {
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
  if (NI_WITH_PHASE_PATTERN.test(content)) {
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

    // 2. Placeholder JSX patterns — only flagged when NOT whitelisted
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
