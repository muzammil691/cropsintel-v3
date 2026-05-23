// Unit tests for the Workshop pre-flight `validateQueueCandidate` gate.
//
// Three acceptance cases from `phase-1.0x-workshop-preflight-filesrequired`:
//   1. reject empty-filesRequired without `audit-only`
//   2. accept empty-filesRequired WITH `audit-only`
//   3. accept non-empty filesRequired regardless of `audit-only`
//
// Each test stages a synthetic spec in a temp dir mirroring the real
// `.agent/tasks/<bucket>/<id>.md` shape so the default questions-dir
// resolver picks up the sibling `.agent/questions/` directory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  validateQueueCandidate,
  extractFilesRequired,
} from './queue-validator'

let repoRoot: string

function writeSpec(taskId: string, body: string): string {
  const specPath = join(repoRoot, '.agent/tasks/in-progress', `${taskId}.md`)
  writeFileSync(specPath, body, 'utf-8')
  return specPath
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'workshop-queue-validator-'))
  mkdirSync(join(repoRoot, '.agent/tasks/in-progress'), { recursive: true })
  mkdirSync(join(repoRoot, '.agent/tasks/queued'), { recursive: true })
  mkdirSync(join(repoRoot, '.agent/questions'), { recursive: true })
})

afterEach(() => {
  if (repoRoot) rmSync(repoRoot, { recursive: true, force: true })
})

describe('extractFilesRequired', () => {
  it('returns empty for a title-only body', () => {
    const body = '# Task: do something\n'
    expect(extractFilesRequired(body)).toEqual([])
  })

  it('picks up backticked code paths in a Files required section', () => {
    const body = `# Task: do something

## Files required

- \`src/lib/foo.ts\` — new module
- \`src/lib/foo.test.ts\` — tests
`
    expect(extractFilesRequired(body).sort()).toEqual(
      ['src/lib/foo.test.ts', 'src/lib/foo.ts'].sort(),
    )
  })

  it('ignores placeholder paths', () => {
    const body = `# Task

## Files required

- \`supabase/migrations/20260429xxxxxx_thing.sql\`
- \`.agent/tasks/queued/<task-id>-remediation-NNN.md\`
- \`src/lib/real.ts\`
`
    expect(extractFilesRequired(body)).toEqual(['src/lib/real.ts'])
  })
})

describe('validateQueueCandidate', () => {
  it('rejects empty-filesRequired when audit-only is absent', () => {
    const taskId = 'phase-x-title-only'
    const specPath = writeSpec(
      taskId,
      `---
priority: 2
---
# Task: ${taskId}
`,
    )

    const result = validateQueueCandidate(specPath)

    expect(result.ok).toBe(false)
    if (result.ok) return // narrow for TS
    expect(result.taskId).toBe(taskId)
    expect(result.reason).toMatch(/audit-only/i)
    expect(result.questionFilePath).toBe(
      join(repoRoot, '.agent/questions', `${taskId}-q.md`),
    )
    expect(existsSync(result.questionFilePath)).toBe(true)
    const stub = readFileSync(result.questionFilePath, 'utf-8')
    expect(stub).toContain(`# Question — ${taskId}`)
    expect(stub).toContain('audit-only')
  })

  it('accepts empty-filesRequired WHEN audit-only: true is set', () => {
    const taskId = 'phase-x-investigation'
    const specPath = writeSpec(
      taskId,
      `---
priority: 2
audit-only: true
---
# Task: ${taskId}

ADR-only investigation; deliverable is markdown.
`,
    )

    const result = validateQueueCandidate(specPath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.taskId).toBe(taskId)
    expect(result.auditOnly).toBe(true)
    expect(result.filesRequired).toEqual([])
    expect(
      existsSync(join(repoRoot, '.agent/questions', `${taskId}-q.md`)),
    ).toBe(false)
  })

  it('accepts non-empty filesRequired regardless of audit-only', () => {
    const taskId = 'phase-x-real-work'
    const body = `---
priority: 2
---
# Task: ${taskId}

## Files required

- \`atlas/src/workshop/queue-validator.ts\`
- \`atlas/src/workshop/queue-validator.test.ts\`
`
    const specPath = writeSpec(taskId, body)

    const result = validateQueueCandidate(specPath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auditOnly).toBe(false)
    expect(result.filesRequired.sort()).toEqual(
      [
        'atlas/src/workshop/queue-validator.test.ts',
        'atlas/src/workshop/queue-validator.ts',
      ].sort(),
    )
  })

  it('accepts non-empty filesRequired even when audit-only is also set', () => {
    const taskId = 'phase-x-hybrid'
    const body = `---
priority: 2
audit-only: true
---
# Task: ${taskId}

## Files required

- \`src/lib/real.ts\`
`
    const specPath = writeSpec(taskId, body)

    const result = validateQueueCandidate(specPath)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auditOnly).toBe(true)
    expect(result.filesRequired).toEqual(['src/lib/real.ts'])
  })

  it('does not write the question file when writeQuestion: false', () => {
    const taskId = 'phase-x-dry-run'
    const specPath = writeSpec(taskId, `# Task: ${taskId}\n`)

    const result = validateQueueCandidate(specPath, { writeQuestion: false })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(existsSync(result.questionFilePath)).toBe(false)
    expect(result.questionStub).toContain(`# Question — ${taskId}`)
  })
})
