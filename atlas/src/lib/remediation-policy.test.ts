import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  shouldPauseForProductFirstFailure,
  buildProductFirstFailureQuestionStub,
  buildPauseWhatsAppMessage,
  writeProductFirstFailureQuestion,
} from './remediation-policy'

describe('shouldPauseForProductFirstFailure', () => {
  it('pauses on product base spec (currentAttempt 0, not infra)', () => {
    expect(shouldPauseForProductFirstFailure({ currentAttempt: 0, infra: false })).toBe(true)
  })

  it('does NOT pause when spec is infra (infra-policy handles it first)', () => {
    expect(shouldPauseForProductFirstFailure({ currentAttempt: 0, infra: true })).toBe(false)
  })

  it('does NOT pause on -rem (currentAttempt 1) — implicit operator consent', () => {
    expect(shouldPauseForProductFirstFailure({ currentAttempt: 1, infra: false })).toBe(false)
  })

  it('does NOT pause on -rem2 (currentAttempt 2)', () => {
    expect(shouldPauseForProductFirstFailure({ currentAttempt: 2, infra: false })).toBe(false)
  })

  it('does NOT pause on -rem3 (currentAttempt 3)', () => {
    expect(shouldPauseForProductFirstFailure({ currentAttempt: 3, infra: false })).toBe(false)
  })

  it('defensive: infra + rem also does not pause', () => {
    expect(shouldPauseForProductFirstFailure({ currentAttempt: 1, infra: true })).toBe(false)
  })
})

describe('buildProductFirstFailureQuestionStub', () => {
  const baseArgs = {
    taskId: 'phase-1.6h-news-fallback',
    gaps: [
      {
        check: 'files-exist',
        severity: 'fail',
        expected: 'adela/src/scrapers/news-fallback.test.ts to exist',
        actual: 'file not found',
        remediation: 'create the test file',
      },
    ],
    commitSha: 'abc123def4567890',
    ranAt: '2026-06-01T10:30:00Z',
  }

  it('renders the spec ID in the title', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    expect(stub).toContain('# Question — phase-1.6h-news-fallback')
  })

  it('renders the metadata block with spec ID, file path, short SHA, and ran-at', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    expect(stub).toContain('**Spec ID:** `phase-1.6h-news-fallback`')
    expect(stub).toContain('**Spec file:** `.agent/tasks/done/phase-1.6h-news-fallback.md`')
    expect(stub).toContain('**Shipped commit:** `abc123d`') // 7-char SHA
    expect(stub).toContain('**Verifier ran at:** `2026-06-01T10:30:00Z`')
  })

  it('renders each verifier gap with check, severity, expected, actual, remediation', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    expect(stub).toContain('### Gap 1 — `files-exist`')
    expect(stub).toContain('*Severity: fail*')
    expect(stub).toContain('**The Verifier expected:** adela/src/scrapers/news-fallback.test.ts to exist')
    expect(stub).toContain('**What it actually found:** file not found')
    expect(stub).toContain('**Suggested fix (from the Verifier):** create the test file')
  })

  it('renders all three operator options with plain-language headers', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    expect(stub).toContain('### 1. Re-queue it as-is')
    expect(stub).toContain('### 2. Edit the spec first')
    expect(stub).toContain('### 3. Leave it as-is')
  })

  it('option 2 includes the delete-question-file-first instruction (wording adjustment #1)', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    expect(stub).toMatch(/Before re-queueing:.*delete this question file/i)
    expect(stub).toMatch(/fresh first-failure cycle/i)
  })

  it('option 3 explains WHY deleting matters (wording adjustment #2)', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    // Stub is line-joined, so "knows" and "you've" may be on adjacent lines.
    // Use dotall flag so .* matches across the newline.
    expect(stub).toMatch(/how Atlas knows.*you've reviewed this/is)
    expect(stub).toMatch(/still waiting for[\s\S]*operator/i)
  })

  it('renders a fallback message when gaps array is empty', () => {
    const stub = buildProductFirstFailureQuestionStub({ ...baseArgs, gaps: [] })
    expect(stub).toContain('no specific gaps')
  })

  it('renders multiple gaps numbered in order', () => {
    const stub = buildProductFirstFailureQuestionStub({
      ...baseArgs,
      gaps: [
        { check: 'empty-diff-guard', severity: 'fail', actual: 'diff was empty' },
        { check: 'files-exist', severity: 'fail', actual: 'foo.ts missing' },
        { check: 'tests-pass', severity: 'warn', actual: 'flaky' },
      ],
    })
    expect(stub).toContain('### Gap 1 — `empty-diff-guard`')
    expect(stub).toContain('### Gap 2 — `files-exist`')
    expect(stub).toContain('### Gap 3 — `tests-pass`')
  })

  it('renders _(not provided)_ for missing gap fields', () => {
    const stub = buildProductFirstFailureQuestionStub({
      ...baseArgs,
      gaps: [{ check: 'verdict-only' }],
    })
    expect(stub).toContain('### Gap 1 — `verdict-only`')
    // expected, actual, remediation all missing → all rendered as _(not provided)_
    const notProvidedCount = (stub.match(/_\(not provided\)_/g) ?? []).length
    expect(notProvidedCount).toBeGreaterThanOrEqual(3)
  })

  it('renders <unknown> when commitSha is null', () => {
    const stub = buildProductFirstFailureQuestionStub({ ...baseArgs, commitSha: null })
    expect(stub).toContain('**Shipped commit:** `<unknown>`')
  })

  it('renders <unknown> when ranAt is null', () => {
    const stub = buildProductFirstFailureQuestionStub({ ...baseArgs, ranAt: null })
    expect(stub).toContain('**Verifier ran at:** `<unknown>`')
  })

  it('references the taskId in option 1 (re-queue path) and option 2 (edit path)', () => {
    const stub = buildProductFirstFailureQuestionStub(baseArgs)
    expect(stub).toContain('.agent/tasks/queued/phase-1.6h-news-fallback-rem.md')
    expect(stub).toContain('.agent/tasks/done/phase-1.6h-news-fallback.md')
  })
})

describe('buildPauseWhatsAppMessage', () => {
  it('is a single line (no newlines)', () => {
    const msg = buildPauseWhatsAppMessage({
      taskId: 'phase-1.6h',
      firstGap: { check: 'files-exist', actual: 'foo.ts missing' },
    })
    expect(msg.includes('\n')).toBe(false)
  })

  it('includes the pause emoji, spec ID, gap summary, and question file path', () => {
    const msg = buildPauseWhatsAppMessage({
      taskId: 'phase-1.6h-news-fallback',
      firstGap: { check: 'files-exist', actual: 'news-fallback.test.ts missing' },
    })
    expect(msg).toContain('⏸')
    expect(msg).toContain('phase-1.6h-news-fallback')
    expect(msg).toContain('first Verifier failure')
    expect(msg).toContain('files-exist')
    expect(msg).toContain('news-fallback.test.ts missing')
    expect(msg).toContain('.agent/questions/phase-1.6h-news-fallback-q.md')
  })

  it('strips backticks from the gap summary (WhatsApp clients render code spans inconsistently)', () => {
    const msg = buildPauseWhatsAppMessage({
      taskId: 'phase-X',
      firstGap: { check: 'files-exist', actual: '`adela/foo.ts` missing' },
    })
    const summaryStart = msg.indexOf('first Verifier failure.') + 'first Verifier failure.'.length
    const summaryEnd = msg.indexOf('. Review options')
    const summary = msg.slice(summaryStart, summaryEnd)
    expect(summary).not.toContain('`')
    expect(summary).toContain('adela/foo.ts missing')
  })

  it('truncates a very long gap detail to keep the message bounded', () => {
    const longActual = 'a'.repeat(500)
    const msg = buildPauseWhatsAppMessage({
      taskId: 'phase-Z',
      firstGap: { check: 'files-exist', actual: longActual },
    })
    expect(msg.length).toBeLessThanOrEqual(230)
    expect(msg).toContain('…')
    // Spec ID + suffix must still be intact even after truncation.
    expect(msg).toContain('phase-Z')
    expect(msg).toContain('.agent/questions/phase-Z-q.md')
  })

  it('falls back gracefully when firstGap is undefined (verdict-only fail)', () => {
    const msg = buildPauseWhatsAppMessage({
      taskId: 'phase-Y',
      firstGap: undefined,
    })
    expect(msg).toContain('phase-Y')
    expect(msg.toLowerCase()).toContain('no detail')
    expect(msg).toContain('.agent/questions/phase-Y-q.md')
  })

  it('uses expected as fallback when actual is missing', () => {
    const msg = buildPauseWhatsAppMessage({
      taskId: 'phase-W',
      firstGap: { check: 'tests-pass', expected: 'all tests green' },
    })
    expect(msg).toContain('tests-pass')
    expect(msg).toContain('all tests green')
  })
})

describe('writeProductFirstFailureQuestion (skip-if-exists dedup)', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'atlas-remediation-policy-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('writes the file on first call (creating .agent/questions/ as needed)', async () => {
    const result = await writeProductFirstFailureQuestion({
      taskId: 'phase-1.6h',
      gaps: [{ check: 'files-exist', severity: 'fail', actual: 'foo.ts missing' }],
      commitSha: 'abc1234deadbeef',
      ranAt: '2026-06-01T10:30:00Z',
      repoRoot: tmpRoot,
    })
    expect(result.written).toBe(true)
    expect(result.path).toBe(resolve(tmpRoot, '.agent/questions/phase-1.6h-q.md'))

    const written = await readFile(result.path, 'utf-8')
    expect(written).toContain('# Question — phase-1.6h')
    expect(written).toContain('files-exist')
    expect(written).toContain('foo.ts missing')
  })

  it('returns written: false when the file already exists (no overwrite)', async () => {
    // Simulate the operator (or a prior tick) already wrote the file.
    const path = resolve(tmpRoot, '.agent/questions/phase-1.6h-q.md')
    await mkdir(resolve(tmpRoot, '.agent/questions'), { recursive: true })
    await writeFile(path, '# Question — phase-1.6h\n_(prior content)_\n', 'utf-8')

    const result = await writeProductFirstFailureQuestion({
      taskId: 'phase-1.6h',
      gaps: [{ check: 'files-exist', severity: 'fail', actual: 'foo.ts missing' }],
      commitSha: 'abc1234',
      ranAt: '2026-06-01T10:30:00Z',
      repoRoot: tmpRoot,
    })

    expect(result.written).toBe(false)
    expect(result.reason).toBe('already exists')

    // Critically: the prior content survives — we did NOT overwrite.
    const preserved = await readFile(path, 'utf-8')
    expect(preserved).toContain('_(prior content)_')
    expect(preserved).not.toContain('files-exist')
  })

  it('second call after a first-call write is a no-op (the dedup contract)', async () => {
    const firstArgs = {
      taskId: 'phase-1.6h',
      gaps: [{ check: 'files-exist', severity: 'fail', actual: 'foo.ts missing' }],
      commitSha: 'abc1234',
      ranAt: '2026-06-01T10:30:00Z',
      repoRoot: tmpRoot,
    }

    const first = await writeProductFirstFailureQuestion(firstArgs)
    expect(first.written).toBe(true)

    const second = await writeProductFirstFailureQuestion(firstArgs)
    expect(second.written).toBe(false)
    expect(second.reason).toBe('already exists')

    // Confirm the body still matches the first-call render (no overwrite).
    const written = await readFile(first.path, 'utf-8')
    expect(written).toContain('# Question — phase-1.6h')
  })
})
