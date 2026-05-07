import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { checkE2ESmoke } from '../e2e-smoke'
import { TaskSpec } from '../../types'

let tmpDir: string
const ORIGINAL_REPO_ROOT = process.env.REPO_ROOT

function makeSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'test-task',
    filesRequired: [],
    componentsRequired: [],
    migrationsRequired: { tablesCreated: [], functionsCreated: [] },
    routesRequired: [],
    testsRequired: ['some.test.ts'],
    acceptanceCriteria: [],
    outOfScope: [],
    rawMarkdown: '',
    ...overrides,
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'e2e-smoke-test-'))
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

describe('checkE2ESmoke — environment readiness gating', () => {
  it('skips with no gaps when playwright.config.ts is missing', () => {
    const gaps = checkE2ESmoke(makeSpec())
    expect(gaps).toEqual([])
  })

  it('skips with no gaps when e2e/ directory is missing even if config exists', () => {
    writeFileSync(join(tmpDir, 'playwright.config.ts'), 'export default {}')
    const gaps = checkE2ESmoke(makeSpec())
    expect(gaps).toEqual([])
  })

  it('skips with no gaps when @playwright/test is not installed', () => {
    writeFileSync(join(tmpDir, 'playwright.config.ts'), 'export default {}')
    mkdirSync(join(tmpDir, 'e2e'), { recursive: true })
    writeFileSync(join(tmpDir, 'e2e', 'placeholder.spec.ts'), '// stub')
    const gaps = checkE2ESmoke(makeSpec())
    expect(gaps).toEqual([])
  })

  it('skips when spec.testsRequired is empty even with config + e2e + dep present', () => {
    writeFileSync(join(tmpDir, 'playwright.config.ts'), 'export default {}')
    mkdirSync(join(tmpDir, 'e2e'), { recursive: true })
    writeFileSync(join(tmpDir, 'e2e', 'placeholder.spec.ts'), '// stub')
    mkdirSync(join(tmpDir, 'node_modules', '@playwright', 'test'), { recursive: true })
    writeFileSync(join(tmpDir, 'node_modules', '@playwright', 'test', 'package.json'), '{}')

    const gaps = checkE2ESmoke(makeSpec({ testsRequired: [] }))
    expect(gaps).toEqual([])
  })
})
