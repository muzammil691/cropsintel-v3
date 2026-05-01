import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { checkStubDetector, isNotImplementedWhitelisted } from './stub-detector'
import { TaskSpec } from '../types'

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

// ── NotImplemented whitelist (Bug H fix) ─────────────────────────────────────

describe('checkStubDetector — NotImplemented whitelist', () => {
  it('FLAGS bare <NotImplemented /> in arbitrary substantial code (true positive)', () => {
    // 60-line component file (not a placeholder page), uses <NotImplemented />
    // with no phase prop and no Route wrapping. This is the real-stub case
    // we want to keep catching.
    const padding = Array.from({ length: 60 }, (_, i) => `  const line${i} = ${i}`).join('\n')
    writeFile(
      'src/components/RealComponent.tsx',
      `import NotImplemented from "@/components/NotImplemented"
export default function RealComponent() {
${padding}
  return <NotImplemented />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/components/RealComponent.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('stub-detector')
    expect(gaps[0].severity).toBe('fail')
  })

  it('DOES NOT flag <Route element={<NotImplemented phase="1.6" />} /> usage in src/App.tsx', () => {
    writeFile(
      'src/App.tsx',
      `import { Routes, Route } from 'react-router-dom'
import NotImplemented from '@/components/NotImplemented'
import Dashboard from '@/pages/Dashboard'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/insights" element={<NotImplemented phase="1.6" />} />
      <Route path="/atlas" element={<NotImplemented phase="2" />} />
    </Routes>
  )
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/App.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('DOES NOT flag a placeholder page src/pages/Insights.tsx rendering <NotImplemented phase="1.7" />', () => {
    writeFile(
      'src/pages/Insights.tsx',
      `import NotImplemented from '@/components/NotImplemented'

export default function Insights() {
  return <NotImplemented phase="1.7" />
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
      `import NotImplemented from '@/components/NotImplemented'
${padding}
export default function FuturePanel() {
  return <NotImplemented phase="3" what="anomaly detection panel" />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/components/FuturePanel.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('FLAGS <NotImplemented /> in src/App.tsx if it is NOT inside a Route element', () => {
    writeFile(
      'src/App.tsx',
      `import NotImplemented from '@/components/NotImplemented'
export default function App() {
  // Used as the root component, not inside a Route — this is a real stub
  return <NotImplemented />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/App.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
  })

  it('FLAGS a long src/pages/*.tsx (>=30 lines) using bare <NotImplemented />', () => {
    // Page file is too long to count as a placeholder, and there's no phase prop
    const padding = Array.from({ length: 40 }, (_, i) => `  const x${i} = ${i};`).join('\n')
    writeFile(
      'src/pages/Heavy.tsx',
      `import NotImplemented from '@/components/NotImplemented'
export default function Heavy() {
${padding}
  return <NotImplemented />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Heavy.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
  })
})

// ── isNotImplementedWhitelisted (unit-level) ─────────────────────────────────

describe('isNotImplementedWhitelisted', () => {
  it('returns true for src/App.tsx with Route-wrapped NotImplemented', () => {
    const content = `<Route path="/x" element={<NotImplemented phase="1.6" />} />`
    expect(isNotImplementedWhitelisted('src/App.tsx', content)).toBe(true)
  })

  it('returns false for src/App.tsx with bare NotImplemented', () => {
    const content = `export default function App() { return <NotImplemented /> }`
    expect(isNotImplementedWhitelisted('src/App.tsx', content)).toBe(false)
  })

  it('returns true for short src/pages/*.tsx files', () => {
    const content = `export default function Page() { return <NotImplemented /> }`
    expect(isNotImplementedWhitelisted('src/pages/Insights.tsx', content)).toBe(true)
  })

  it('returns true for any file containing <NotImplemented phase=...>', () => {
    const padding = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    const content = `${padding}\n<NotImplemented phase="2" what="x" />`
    expect(isNotImplementedWhitelisted('src/components/Whatever.tsx', content)).toBe(true)
  })

  it('returns false for a substantial non-page file with bare NotImplemented', () => {
    const padding = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    const content = `${padding}\n<NotImplemented />`
    expect(isNotImplementedWhitelisted('src/components/Whatever.tsx', content)).toBe(false)
  })
})
