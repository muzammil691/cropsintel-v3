// Phase 1.10af §7 — verifier context loader line-aware behavior.
//
// 1) A 1,800-line file is loaded whole — no `[verifier-context] truncated` log.
// 2) A 5,000-line file in a context already near 180k chars IS truncated, with
//    the explicit `[verifier-context] truncated <path> (origLines → keptLines)
//    to fit model context` log.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadShippedCodeContext } from '../context-loader'
import type { TaskSpec } from '../../types'

let tmpDir: string
let consoleLogSpy: ReturnType<typeof vi.spyOn>

function makeSpec(filesRequired: string[]): TaskSpec {
  return {
    id: 'ctx-loader-test',
    filesRequired,
    componentsRequired: [],
    migrationsRequired: { tablesCreated: [], functionsCreated: [] },
    routesRequired: [],
    testsRequired: [],
    acceptanceCriteria: [],
    outOfScope: [],
    rawMarkdown: '',
  }
}

function writeFile(rel: string, content: string): void {
  const full = join(tmpDir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ctx-loader-test-'))
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  rmSync(tmpDir, { recursive: true, force: true })
})

function getTruncationLogs(): string[] {
  return consoleLogSpy.mock.calls
    .map((args: unknown[]) => args.join(' '))
    .filter((line: string) => line.startsWith('[verifier-context] truncated '))
}

describe('loadShippedCodeContext — 1.10af §7', () => {
  it('loads a 1,800-line file WHOLE without emitting a truncation log', () => {
    const lines = Array.from({ length: 1800 }, (_, i) => `// line ${i}`)
    writeFile('src/short.ts', lines.join('\n'))

    const spec = makeSpec(['src/short.ts'])
    const result = loadShippedCodeContext({ spec, repoRoot: tmpDir })

    const decision = result.decisions.find(d => d.filePath === 'src/short.ts')
    expect(decision).toBeDefined()
    expect(decision?.outcome).toBe('full')
    expect(getTruncationLogs()).toHaveLength(0)
    // Whole-load includes every original line.
    for (const line of lines) {
      expect(result.contextString).toContain(line)
    }
  })

  it('truncates a 5,000-line file when the context is already near 180k chars and emits the explicit log', () => {
    // First file: ~120k chars — pads us close to the critical budget so the
    // 5,000-line file can't fit whole.
    const padLines = Array.from({ length: 1500 }, (_, i) => `// pad ${i.toString().padEnd(60, 'x')}`)
    writeFile('src/pad.ts', padLines.join('\n'))

    // Big file: 5,000 lines, each ~50 chars → ~250KB; far over remaining budget.
    const bigLines = Array.from({ length: 5000 }, (_, i) => `// big-line-${i.toString().padEnd(40, 'y')}`)
    writeFile('src/big.ts', bigLines.join('\n'))

    const spec = makeSpec(['src/pad.ts', 'src/big.ts'])
    const result = loadShippedCodeContext({ spec, repoRoot: tmpDir })

    const big = result.decisions.find(d => d.filePath === 'src/big.ts')
    expect(big).toBeDefined()
    expect(big?.outcome).toBe('truncated')

    const logs = getTruncationLogs()
    const matched = logs.find(line => line.includes('src/big.ts') && /5000\s*→\s*\d+/.test(line))
    expect(matched).toBeDefined()
    expect(matched).toMatch(/to fit model context/)
  })
})
