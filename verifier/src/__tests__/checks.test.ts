import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { checkFilesExist } from '../checks/files-exist'
import { checkStubDetector } from '../checks/stub-detector'
import { checkMigrationsApplied } from '../checks/migrations-applied'
import { checkRoutesWired } from '../checks/routes-wired'
import { checkTestsExist } from '../checks/tests-exist'
import { checkDepsInstalled } from '../checks/deps-installed'
import { checkComponentsImplemented } from '../checks/components-implemented'
import { parseTaskSpec } from '../lib/spec-parser'
import { TaskSpec } from '../types'

// ── Test helpers ──────────────────────────────────────────────────────────────

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
  tmpDir = mkdtempSync(join(tmpdir(), 'verifier-test-'))
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

// ── 1. files-exist ────────────────────────────────────────────────────────────
describe('checkFilesExist', () => {
  it('returns no gaps when all required files exist', () => {
    writeFile('src/pages/Auth.tsx', 'export default function Auth() { return null }')
    writeFile('src/lib/supabase.ts', 'export const supabase = null')

    const spec = makeSpec({
      filesRequired: ['src/pages/Auth.tsx', 'src/lib/supabase.ts'],
    })

    const gaps = checkFilesExist(spec)
    expect(gaps).toHaveLength(0)
  })

  it('returns a fail gap for each missing file', () => {
    writeFile('src/pages/Auth.tsx', 'exists')
    // src/lib/missing.ts intentionally NOT created

    const spec = makeSpec({
      filesRequired: ['src/pages/Auth.tsx', 'src/lib/missing.ts'],
    })

    const gaps = checkFilesExist(spec)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].check).toBe('files-exist')
    expect(gaps[0].severity).toBe('fail')
    expect(gaps[0].actual).toContain('src/lib/missing.ts')
  })
})

// ── 2. stub-detector ─────────────────────────────────────────────────────────
describe('checkStubDetector', () => {
  it('returns no gaps for a fully implemented file', () => {
    writeFile(
      'src/pages/Auth.tsx',
      `import { useState } from 'react'
export default function Auth() {
  const [email, setEmail] = useState('')
  return <form><input value={email} onChange={e => setEmail(e.target.value)} /></form>
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Auth.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('detects <NotImplemented> import as a stub', () => {
    writeFile(
      'src/pages/Auth.tsx',
      `import NotImplemented from "@/components/NotImplemented"
export default function Auth() {
  return <NotImplemented phase="1.30" what="login" />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Auth.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('stub-detector')
    expect(gaps[0].severity).toBe('fail')
  })

  it('detects // STUB comment', () => {
    writeFile('src/lib/auth.ts', `// STUB\nexport function login() {}`)

    const spec = makeSpec({ filesRequired: ['src/lib/auth.ts'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].severity).toBe('fail')
  })

  it('detects "coming soon" text', () => {
    writeFile('src/pages/Welcome.tsx', `<p>coming soon</p>`)

    const spec = makeSpec({ filesRequired: ['src/pages/Welcome.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps.length).toBeGreaterThan(0)
  })

  it('skips files that do not exist (files-exist handles that)', () => {
    const spec = makeSpec({ filesRequired: ['src/pages/DoesNotExist.tsx'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })
})

// ── 3. migrations-applied ────────────────────────────────────────────────────
describe('checkMigrationsApplied', () => {
  it('returns no gaps when required table exists in migrations', () => {
    mkdirSync(join(tmpDir, 'supabase', 'migrations'), { recursive: true })
    writeFile(
      'supabase/migrations/001_init.sql',
      'CREATE TABLE IF NOT EXISTS public.verifier_runs (id uuid PRIMARY KEY);',
    )

    const spec = makeSpec({
      migrationsRequired: { tablesCreated: ['verifier_runs'], functionsCreated: [] },
    })

    const gaps = checkMigrationsApplied(spec)
    expect(gaps).toHaveLength(0)
  })

  it('returns a fail gap when required table is missing from migrations', () => {
    mkdirSync(join(tmpDir, 'supabase', 'migrations'), { recursive: true })
    writeFile(
      'supabase/migrations/001_init.sql',
      'CREATE TABLE IF NOT EXISTS public.other_table (id uuid PRIMARY KEY);',
    )

    const spec = makeSpec({
      migrationsRequired: { tablesCreated: ['missing_table'], functionsCreated: [] },
    })

    const gaps = checkMigrationsApplied(spec)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].check).toBe('migrations-applied')
    expect(gaps[0].severity).toBe('fail')
    expect(gaps[0].actual).toContain('missing_table')
  })

  it('returns no gaps when spec has no migration requirements', () => {
    const spec = makeSpec()
    expect(checkMigrationsApplied(spec)).toHaveLength(0)
  })
})

// ── 4. routes-wired ───────────────────────────────────────────────────────────
describe('checkRoutesWired', () => {
  it('returns no gaps when route exists and points to a real component', () => {
    writeFile(
      'src/App.tsx',
      `<Route path="/auth" element={<Auth />} />`,
    )

    const spec = makeSpec({ routesRequired: ['/auth'] })
    const gaps = checkRoutesWired(spec)
    expect(gaps).toHaveLength(0)
  })

  it('returns a fail gap when route points to NotImplemented', () => {
    writeFile(
      'src/App.tsx',
      `<Route path="/auth" element={<NotImplemented phase="1.30" />} />`,
    )

    const spec = makeSpec({ routesRequired: ['/auth'] })
    const gaps = checkRoutesWired(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('routes-wired')
    expect(gaps[0].severity).toBe('fail')
    expect(gaps[0].actual).toContain('NotImplemented')
  })

  it('returns a fail gap when route is missing entirely from App.tsx', () => {
    writeFile('src/App.tsx', `<Route path="/welcome" element={<Welcome />} />`)

    const spec = makeSpec({ routesRequired: ['/dashboard'] })
    const gaps = checkRoutesWired(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].actual).toContain('/dashboard')
  })

  it('returns no gaps when no routes are required', () => {
    const spec = makeSpec()
    expect(checkRoutesWired(spec)).toHaveLength(0)
  })
})

// ── 5. tests-exist ────────────────────────────────────────────────────────────
describe('checkTestsExist', () => {
  it('returns no gaps when required test file exists', () => {
    writeFile(
      'src/__tests__/auth.test.ts',
      `import { test } from 'vitest'\ntest('auth works', () => {})`,
    )

    const spec = makeSpec({
      testsRequired: ['src/__tests__/auth.test.ts'],
      acceptanceCriteria: ['All tests pass'],
    })

    const gaps = checkTestsExist(spec)
    expect(gaps).toHaveLength(0)
  })

  it('returns a fail gap when required test file is missing', () => {
    const spec = makeSpec({
      testsRequired: ['src/__tests__/missing.test.ts'],
      acceptanceCriteria: ['All Playwright e2e tests pass'],
    })

    const gaps = checkTestsExist(spec)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].check).toBe('tests-exist')
    expect(gaps[0].severity).toBe('fail')
  })

  it('returns no gaps when spec does not mention tests', () => {
    const spec = makeSpec({ acceptanceCriteria: ['Build passes'] })
    expect(checkTestsExist(spec)).toHaveLength(0)
  })
})

// ── 6. deps-installed ────────────────────────────────────────────────────────
describe('checkDepsInstalled', () => {
  it('returns no gaps when required package is in package.json', () => {
    writeFile(
      'package.json',
      JSON.stringify({ dependencies: { openai: '^4.0.0' }, devDependencies: {} }),
    )

    const spec = makeSpec({ rawMarkdown: 'Run `npm install openai` to add the SDK.' })
    const gaps = checkDepsInstalled(spec)
    expect(gaps).toHaveLength(0)
  })

  it('returns a fail gap when required package is missing from package.json', () => {
    writeFile(
      'package.json',
      JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: {} }),
    )

    const spec = makeSpec({
      rawMarkdown: 'Run `npm install some-missing-package` to use this feature.',
    })
    const gaps = checkDepsInstalled(spec)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].check).toBe('deps-installed')
    expect(gaps[0].severity).toBe('fail')
    expect(gaps[0].actual).toContain('some-missing-package')
  })

  it('returns no gaps when markdown has no npm install commands', () => {
    const spec = makeSpec({ rawMarkdown: 'Just some text without npm install.' })
    expect(checkDepsInstalled(spec)).toHaveLength(0)
  })
})

// ── 7. components-implemented ─────────────────────────────────────────────────
describe('checkComponentsImplemented', () => {
  it('returns no gaps for a substantial implementation', () => {
    writeFile(
      'src/pages/Auth.tsx',
      `import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await signIn({ email, password })
  }

  return (
    <form onSubmit={handleSubmit}>
      <Input value={email} onChange={e => setEmail(e.target.value)} />
      <Input type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <Button type="submit">Sign in</Button>
    </form>
  )
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Auth.tsx'] })
    const gaps = checkComponentsImplemented(spec)
    // May have warns for min lines but no fails
    expect(gaps.filter(g => g.severity === 'fail')).toHaveLength(0)
  })

  it('detects a component that imports NotImplemented', () => {
    writeFile(
      'src/pages/Auth.tsx',
      `import NotImplemented from "@/components/NotImplemented"
export default function Auth() {
  return <NotImplemented phase="1.30" what="login" />
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Auth.tsx'] })
    const gaps = checkComponentsImplemented(spec)
    expect(gaps.filter(g => g.severity === 'fail').length).toBeGreaterThan(0)
  })

  it('warns on a suspiciously thin file', () => {
    writeFile(
      'src/pages/Stub.tsx',
      `export default function Stub() {
  return null
}`,
    )

    const spec = makeSpec({ filesRequired: ['src/pages/Stub.tsx'] })
    const gaps = checkComponentsImplemented(spec)
    expect(gaps.length).toBeGreaterThan(0)
  })

  it('skips missing files (files-exist handles that)', () => {
    const spec = makeSpec({ filesRequired: ['src/pages/DoesNotExist.tsx'] })
    expect(checkComponentsImplemented(spec)).toHaveLength(0)
  })
})

// ── False-positive regression tests ──────────────────────────────────────────

// FP-1: checkFilesExist skips home-directory paths
describe('checkFilesExist — external path filtering', () => {
  it('ignores paths starting with ~/ (home-dir read-only references)', () => {
    // These paths live outside the repo — the agent only reads them, never creates them
    const spec = makeSpec({
      filesRequired: [
        '~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md',
        '~/Documents/Claude/Projects/Cropsintel/v3-step2-v1-audit.md',
      ],
    })
    const gaps = checkFilesExist(spec)
    expect(gaps).toHaveLength(0)
  })

  it('ignores paths with unrecognized prefix (V2 source, external repos, etc.)', () => {
    const spec = makeSpec({
      filesRequired: ['some-unknown-dir/runner.js', 'external/lib/util.ts'],
    })
    const gaps = checkFilesExist(spec)
    expect(gaps).toHaveLength(0)
  })

  it('strips cropsintel-v3/ prefix and checks the normalized path', () => {
    writeFile('src/lib/supabase.ts', 'export const supabase = null')

    const spec = makeSpec({ filesRequired: ['cropsintel-v3/src/lib/supabase.ts'] })
    const gaps = checkFilesExist(spec)
    // After stripping the prefix, the file exists — no gap
    expect(gaps).toHaveLength(0)
  })
})

// FP-2: spec-parser drops placeholder filenames
describe('parseTaskSpec — placeholder path filtering', () => {
  it('does not include xxxxxx-timestamp placeholder migration files', () => {
    const md = `## Schema additions\n- \`supabase/migrations/20260429xxxxxx_verifier.sql\`\n`
    const spec = parseTaskSpec(md, 'test')
    expect(spec.filesRequired).toHaveLength(0)
  })

  it('does not include <task-id> placeholder paths', () => {
    const md = `## Deliverables\n- \`.agent/tasks/queued/<task-id>-remediation-NNN.md\`\n`
    const spec = parseTaskSpec(md, 'test')
    expect(spec.filesRequired).toHaveLength(0)
  })

  it('does not include phase-X.YY example path patterns', () => {
    const md = `## Example\n- \`.agent/tasks/queued/phase-X.YY-name.md\`\n`
    const spec = parseTaskSpec(md, 'test')
    expect(spec.filesRequired).toHaveLength(0)
  })

  it('does not include .agent/questions/ paths (optional fallback artifacts)', () => {
    const md = `## Deliverables\n- \`.agent/questions/phase-1.00a-q.md\`\n`
    const spec = parseTaskSpec(md, 'test')
    expect(spec.filesRequired).toHaveLength(0)
  })

  it('normalizes paths — strips leading ./ and / and cropsintel-v3/ prefix', () => {
    const md = [
      '## Files',
      '- `./src/pages/Auth.tsx`',
      '- `/src/lib/supabase.ts`',
      '- `cropsintel-v3/src/lib/types.ts`',
    ].join('\n')
    const spec = parseTaskSpec(md, 'test')
    expect(spec.filesRequired).toContain('src/pages/Auth.tsx')
    expect(spec.filesRequired).toContain('src/lib/supabase.ts')
    expect(spec.filesRequired).toContain('src/lib/types.ts')
    // Should not contain the prefixed versions
    expect(spec.filesRequired).not.toContain('./src/pages/Auth.tsx')
    expect(spec.filesRequired).not.toContain('/src/lib/supabase.ts')
    expect(spec.filesRequired).not.toContain('cropsintel-v3/src/lib/types.ts')
  })
})

// FP-3: stub-detector excludes self-reflexive files
describe('checkStubDetector — self-exclusion', () => {
  it('does not flag verifier/src/checks/stub-detector.ts for containing stub pattern literals', () => {
    // The stub-detector source file contains stub patterns as string literals — it would
    // always match itself. The exclusion list prevents this false positive.
    writeFile('verifier/src/checks/stub-detector.ts', `// STUB\nexport const STUB_PATTERNS = [/\\/\\/ STUB\\b/i]`)

    const spec = makeSpec({ filesRequired: ['verifier/src/checks/stub-detector.ts'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })

  it('does not flag verifier test files', () => {
    writeFile('verifier/src/__tests__/checks.test.ts', `// STUB\nimport { describe } from 'vitest'`)

    const spec = makeSpec({ filesRequired: ['verifier/src/__tests__/checks.test.ts'] })
    const gaps = checkStubDetector(spec)
    expect(gaps).toHaveLength(0)
  })
})
