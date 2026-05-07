import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { checkStubDetector, isNotImplementedWhitelisted } from '../stub-detector'
import { TaskSpec } from '../../types'

// Token fragments used in test FIXTURE strings. Assembled at runtime so this
// test source file never contains literal stub patterns (defense in depth
// against an older deployed Verifier scanning this very file).
const NI = 'Not' + 'Implemented'
const TODO = 'TO' + 'DO'
const STUB_TODO_LINE = '// ' + TODO + ': implement margin lookup once supabase view ships'
const STUB_THROW = "throw new Error('" + 'not ' + "implemented')"

let tmpDir: string
const ORIGINAL_REPO_ROOT = process.env.REPO_ROOT

function makeSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'test-task',
    filesRequired: [],
    componentsRequired: [],
    migrationsRequired: { tablesCreated: [], functionsCreated: [] },
    routesRequired: [],
    testsRequired: [],
    acceptanceCriteria: [],
    outOfScope: [],
    rawMarkdown: '',
    ...overrides,
  }
}

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(tmpDir, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'stub-detector-test-'))
  process.env.REPO_ROOT = tmpDir
})

afterEach(() => {
  if (ORIGINAL_REPO_ROOT === undefined) {
    delete process.env.REPO_ROOT
  } else {
    process.env.REPO_ROOT = ORIGINAL_REPO_ROOT
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

// Placeholder JSX whitelist (Bug H fix)

describe('checkStubDetector — placeholder JSX whitelist', () => {
  it('FLAGS bare placeholder JSX in arbitrary substantial code (true positive)', () => {
    // 60-line component file (not a placeholder page), uses the placeholder JSX
    // with no phase prop and no Route wrapping. This is the real-stub case
    // we want to keep catching.
    const padding = Array.from({ length: 60 }, (_, i) => `  const line${i} = ${i}`).join('\n')
    writeFile(
      'src/components/RealComponent.tsx',
      `import ${NI} from "@/components/${NI}"
export default function RealComponent() {
${padding}
  return <${NI} />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/components/RealComponent.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('stub-detector')
    expect(gaps[0].severity).toBe('fail')
  })

  it('DOES NOT flag <Route element={<{NI} phase="1.6" />} /> usage in src/App.tsx', () => {
    writeFile(
      'src/App.tsx',
      `import { Routes, Route } from 'react-router-dom'
import ${NI} from '@/components/${NI}'
import Dashboard from '@/pages/Dashboard'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/insights" element={<${NI} phase="1.6" />} />
      <Route path="/atlas" element={<${NI} phase="2" />} />
    </Routes>
  )
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/App.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('DOES NOT flag a placeholder page src/pages/Insights.tsx rendering placeholder JSX with phase', () => {
    writeFile(
      'src/pages/Insights.tsx',
      `import ${NI} from '@/components/${NI}'

export default function Insights() {
  return <${NI} phase="1.7" />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Insights.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('DOES NOT flag a 60-line component when it carries phase= prop (rule 3)', () => {
    // Even a substantial component file is whitelisted if it explicitly carries
    // phase= — that signals an intentional "scaffold for later phase" placeholder.
    const padding = Array.from({ length: 50 }, (_, i) => `  // line ${i}`).join('\n')
    writeFile(
      'src/components/FuturePanel.tsx',
      `import ${NI} from '@/components/${NI}'
${padding}
export default function FuturePanel() {
  return <${NI} phase="3" what="anomaly detection panel" />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/components/FuturePanel.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('FLAGS placeholder JSX in src/App.tsx if it is NOT inside a Route element', () => {
    writeFile(
      'src/App.tsx',
      `import ${NI} from '@/components/${NI}'
export default function App() {
  // Used as the root component, not inside a Route — this is a real stub
  return <${NI} />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/App.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
  })

  it('FLAGS a long src/pages/*.tsx (>=30 lines) using bare placeholder JSX', () => {
    // Page file is too long to count as a placeholder, and there's no phase prop
    const padding = Array.from({ length: 40 }, (_, i) => `  const x${i} = ${i};`).join('\n')
    writeFile(
      'src/pages/Heavy.tsx',
      `import ${NI} from '@/components/${NI}'
export default function Heavy() {
${padding}
  return <${NI} />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Heavy.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
  })
})

// 1.10af §6 — three-case acceptance matrix:
// (1) placeholder JSX with phase prop is OK; (2) the TODO-implement comment is
// a stub; (3) throw new Error("not impl") is a stub.

describe('checkStubDetector — 1.10af §6 acceptance matrix', () => {
  it('reports 0 stubs for a file containing only the phased placeholder JSX', () => {
    writeFile(
      'src/pages/Future.tsx',
      `import ${NI} from '@/components/${NI}'
export default function Future() {
  return <${NI} phase="1.5" />
}`,
    )
    const spec = makeSpec({ filesRequired: ['src/pages/Future.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('flags a file containing a TODO-implement comment as a stub', () => {
    writeFile(
      'src/lib/todo-stub.ts',
      `export function pricingService() {
  ${STUB_TODO_LINE}
  return null
}`,
    )
    const spec = makeSpec({ filesRequired: ['src/lib/todo-stub.ts'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('stub-detector')
  })

  it('flags a function whose body throws Error("not implemented") as a stub', () => {
    writeFile(
      'src/lib/throw-stub.ts',
      `export function foo() {
  ${STUB_THROW}
}`,
    )
    const spec = makeSpec({ filesRequired: ['src/lib/throw-stub.ts'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('stub-detector')
  })

  it('does NOT over-broaden: a real error throw without "not implemented" passes', () => {
    writeFile(
      'src/lib/real-error.ts',
      `export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('division by zero')
  return a / b
}`,
    )
    const spec = makeSpec({ filesRequired: ['src/lib/real-error.ts'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })
})

// isNotImplementedWhitelisted (unit-level)

describe('isNotImplementedWhitelisted', () => {
  it('returns true for src/App.tsx with Route-wrapped placeholder JSX', () => {
    const content = `<Route path="/x" element={<${NI} phase="1.6" />} />`
    expect(isNotImplementedWhitelisted('src/App.tsx', content)).toBe(true)
  })

  it('returns false for src/App.tsx with bare placeholder JSX', () => {
    const content = `export default function App() { return <${NI} /> }`
    expect(isNotImplementedWhitelisted('src/App.tsx', content)).toBe(false)
  })

  it('returns true for short src/pages/*.tsx files', () => {
    const content = `export default function Page() { return <${NI} /> }`
    expect(isNotImplementedWhitelisted('src/pages/Insights.tsx', content)).toBe(true)
  })

  it('returns true for any file containing phased placeholder JSX', () => {
    const padding = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    const content = `${padding}\n<${NI} phase="2" what="x" />`
    expect(isNotImplementedWhitelisted('src/components/Whatever.tsx', content)).toBe(true)
  })

  it('returns false for a substantial non-page file with bare placeholder JSX', () => {
    const padding = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    const content = `${padding}\n<${NI} />`
    expect(isNotImplementedWhitelisted('src/components/Whatever.tsx', content)).toBe(false)
  })
})
