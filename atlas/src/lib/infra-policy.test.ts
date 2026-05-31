// Phase 1.0x — infra-spec policy guard tests.
//
// Two test groups:
//   1. isInfraSpec + buildInfraQuestionStub behavioral tests.
//   2. Drift-pin: queue-validator's extractFilesRequired must agree with
//      the verifier's parseTaskSpec on a representative corpus, so any
//      future widening of either parser fails this test instead of
//      silently weakening the guard.

import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'
import {
  isInfraSpec,
  buildInfraQuestionStub,
  writeInfraRefusalQuestion,
  INFRA_PATH_PREFIXES,
  INFRA_TASKID_PATTERN,
} from './infra-policy'
import { extractFilesRequired } from '../workshop/queue-validator'
// Cross-package import: verifier's parser is reused via Option 5 (queue-
// validator's existing copy in production code). The drift-pin test
// below imports the verifier's actual parseTaskSpec to pin agreement.
import { parseTaskSpec } from '../../../verifier/src/lib/spec-parser'

// ───────────────────────── isInfraSpec behavioral ─────────────────────────

describe('isInfraSpec — Layer A (path prefix)', () => {
  it('product spec with src/ paths and infra-ish task_id is NOT blocked', () => {
    const body = `# Task

## Files required

- \`src/components/atlas/AtlasCockpit.tsx\`
- \`src/lib/atlas-client.ts\`
`
    const r = isInfraSpec({ body, taskId: 'phase-1.4-cockpit-conductor-polish' })
    // Note: the task_id contains "conductor", but Layer C is gated on
    // Layer A returning zero paths. Layer A found 2 product paths, so
    // Layer C never runs — product spec requeues cleanly.
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })

  it('infra spec with atlas/ path is blocked', () => {
    const body = `# Task

## Files required

- \`atlas/src/lib/plan-server.ts\`
`
    const r = isInfraSpec({ body, taskId: 'phase-X-anything' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('A')
    expect(r.evidence).toContain('atlas/src/lib/plan-server.ts')
  })

  it('infra spec with verifier/ path is blocked', () => {
    const body = `# Task\n\n- \`verifier/src/server.ts\``
    const r = isInfraSpec({ body, taskId: 'phase-X-anything' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('A')
  })

  it('infra spec with council/ path is blocked', () => {
    const body = `# Task\n\n- \`council/src/index.ts\``
    const r = isInfraSpec({ body, taskId: 'phase-X-anything' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('A')
  })

  it('infra spec with agent/ path is blocked', () => {
    const body = `# Task\n\n- \`agent/agent-loop.sh\``
    const r = isInfraSpec({ body, taskId: 'phase-X-anything' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('A')
  })

  it('infra spec with designer/ path is blocked', () => {
    const body = `# Task\n\n- \`designer/src/review.ts\``
    const r = isInfraSpec({ body, taskId: 'phase-X-anything' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('A')
  })

  it('adela/ path is NOT treated as infra (product-adjacent — V1.0-beta data spine)', () => {
    const body = `# Task\n\n- \`adela/src/scheduler.ts\``
    const r = isInfraSpec({ body, taskId: 'phase-1.6-adela-fix' })
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })

  it('memory/ path is NOT treated as infra (product-adjacent — cockpit search)', () => {
    const body = `# Task\n\n- \`memory/src/ingest/agent-history.ts\``
    const r = isInfraSpec({ body, taskId: 'phase-1.10-memory-fix' })
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })

  it('mixed product + infra paths: ANY infra path triggers block', () => {
    const body = `# Task\n\n- \`src/components/Foo.tsx\`\n- \`atlas/src/lib/bar.ts\``
    const r = isInfraSpec({ body, taskId: 'phase-X-anything' })
    expect(r.infra).toBe(true)
    expect(r.evidence).toContain('atlas/src/lib/bar.ts')
    expect(r.evidence).not.toContain('src/components/Foo.tsx')
  })
})

describe('isInfraSpec — Layer C (task_id fallback)', () => {
  const emptyBody = '# Task\n\nTitle-only spec with no path enumeration.\n'

  it('empty filesRequired + infra task_id token is blocked via Layer C (requeue)', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.0x-requeue-inheritance-fix' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('C')
    expect(r.evidence[0]).toMatch(/requeue/i)
  })

  it('empty filesRequired + infra task_id token "conductor" is blocked', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.0x-conductor-heartbeat-fix' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('C')
  })

  it('empty filesRequired + infra task_id token "verifier-sync" is blocked', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.0x-verifier-sync-hardening' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('C')
  })

  it('empty filesRequired + infra task_id token "workshop-preflight" is blocked', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.0x-workshop-preflight-filesrequired' })
    expect(r.infra).toBe(true)
    expect(r.layer).toBe('C')
  })

  it('empty filesRequired + product task_id requeues normally', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.4-public-landing-polish' })
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })

  it('bare "queue" in task_id does NOT trigger Layer C (too generic)', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.4-queue-tab-empty-state' })
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })

  it('bare "workshop" in task_id does NOT trigger Layer C (too generic)', () => {
    const r = isInfraSpec({ body: emptyBody, taskId: 'phase-1.10-workshop-tab-css-overhaul' })
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })

  it('Layer C is gated on Layer A returning zero paths', () => {
    // Spec has product paths AND an infra-ish task_id. Layer A finds the
    // product paths → Layer C never runs → result is NOT infra.
    const body = `# Task\n\n- \`src/components/Header.tsx\``
    const r = isInfraSpec({ body, taskId: 'phase-1.4-cockpit-conductor-polish' })
    expect(r.infra).toBe(false)
    expect(r.layer).toBe('none')
  })
})

// ─────────────── Real specs from disk: lock the three priors ───────────────

describe('isInfraSpec — the three real priors must all be blocked', () => {
  // Each spec lives in .agent/tasks/done/ on origin/main. Resolve relative
  // to the repo root; from atlas/src/lib/ that is 3 levels up.
  const repoRoot = resolve(__dirname, '../../..')

  function loadDoneSpec(filename: string): { taskId: string; body: string } {
    const path = resolve(repoRoot, '.agent/tasks/done', filename)
    const raw = readFileSync(path, 'utf-8')
    // Strip YAML frontmatter so we feed only the body to isInfraSpec
    // (mirrors plan-server.ts which calls parseSpec first).
    const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
    const body = m ? m[1] : raw
    const taskId = filename.replace(/\.md$/, '')
    return { taskId, body }
  }

  it('phase-1.0x-requeue-inheritance-fix is blocked', () => {
    const spec = loadDoneSpec('phase-1.0x-requeue-inheritance-fix.md')
    const r = isInfraSpec(spec)
    expect(r.infra).toBe(true)
    // Layer A (atlas/src/lib/plan-server.ts in body) OR Layer C
    // (task_id matches "requeue" + "inheritance" + "plan-server").
    expect(['A', 'C']).toContain(r.layer)
  })

  it('phase-1.0x-verifier-sync-hardening is blocked', () => {
    const spec = loadDoneSpec('phase-1.0x-verifier-sync-hardening.md')
    const r = isInfraSpec(spec)
    expect(r.infra).toBe(true)
  })

  it('phase-1.0x-workshop-preflight-filesrequired is blocked', () => {
    const spec = loadDoneSpec('phase-1.0x-workshop-preflight-filesrequired.md')
    const r = isInfraSpec(spec)
    expect(r.infra).toBe(true)
  })
})

// ─────────────────── buildInfraQuestionStub shape ───────────────────

describe('buildInfraQuestionStub', () => {
  it('includes task_id, layer, evidence, and verifier gaps', () => {
    const detection = isInfraSpec({
      // Real spec bodies have a section header; use one so the parser's
      // section-splitter exercises the path-extraction pass correctly.
      body: '# Task\n\n## Files required\n\n- `atlas/src/lib/foo.ts`\n',
      taskId: 'phase-X-anything',
    })
    expect(detection.infra).toBe(true)
    const stub = buildInfraQuestionStub({
      taskId: 'phase-X-anything',
      detection,
      gaps: [
        { check: 'empty-diff-guard', severity: 'fail', actual: 'no diff', expected: 'real diff', remediation: 'add paths' },
      ],
      remediationAttempt: 2,
    })
    expect(stub).toContain('phase-X-anything')
    expect(stub).toContain('Layer A')
    expect(stub).toContain('atlas/src/lib/foo.ts')
    expect(stub).toContain('empty-diff-guard')
    expect(stub).toContain('Remediation attempt 2')
    expect(stub).toContain('Claude Code')
  })

  it('handles empty gaps array gracefully', () => {
    const detection = isInfraSpec({
      body: '',
      taskId: 'phase-1.0x-conductor-heartbeat-fix',
    })
    expect(detection.infra).toBe(true)
    const stub = buildInfraQuestionStub({
      taskId: 'phase-1.0x-conductor-heartbeat-fix',
      detection,
      gaps: [],
      remediationAttempt: 1,
    })
    expect(stub).toContain('No structured Verifier gaps')
    expect(stub).toContain('Layer C')
  })
})

// ─────────────────────── Module-level constants ───────────────────────

describe('module constants — locked roots and regex', () => {
  it('INFRA_PATH_PREFIXES is exactly the five agreed roots', () => {
    expect([...INFRA_PATH_PREFIXES]).toEqual([
      'atlas/',
      'verifier/',
      'council/',
      'agent/',
      'designer/',
    ])
  })

  it('INFRA_TASKID_PATTERN does not match bare "queue"', () => {
    expect(INFRA_TASKID_PATTERN.test('phase-1.4-queue-tab')).toBe(false)
  })

  it('INFRA_TASKID_PATTERN does not match bare "workshop"', () => {
    expect(INFRA_TASKID_PATTERN.test('phase-1.10-workshop-tab')).toBe(false)
  })

  it('INFRA_TASKID_PATTERN matches the spec\'d tokens', () => {
    expect(INFRA_TASKID_PATTERN.test('phase-X-requeue-foo')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-inheritance-bar')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-plan-server-baz')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-queue-orchestrator-qux')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-conductor-fix')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-verifier-sync-thing')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-workshop-preflight')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-workshop-validator')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-workshop-engine')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-council-fix')).toBe(true)
    expect(INFRA_TASKID_PATTERN.test('phase-X-designer-audit-fix')).toBe(true)
  })
})

// ────────────────── writeInfraRefusalQuestion (hook symmetry) ──────────────────
//
// Both hook A (requeueWithGaps) and hook B (autoRequeueOnVerifierFail) call
// writeInfraRefusalQuestion. The tests below simulate the conductor-path
// (hook B) flow in a temp REPO_ROOT to assert the artifact is written with
// the expected blocking-reason content, and that skip-if-exists prevents
// later cycles from overwriting an earlier write.

describe('writeInfraRefusalQuestion — conductor-path artifact write', () => {
  it('writes .agent/questions/<taskId>-q.md with the expected blocking reason', async () => {
    const tmpRoot = mkdtempSync(resolve(tmpdir(), 'atlas-infra-policy-'))
    try {
      const taskId = 'phase-1.0x-requeue-inheritance-fix'
      const body = '# Task\n\nTitle-only body (no filesRequired).\n'
      const detection = isInfraSpec({ body, taskId })
      expect(detection.infra).toBe(true)
      expect(detection.layer).toBe('C')

      const r = await writeInfraRefusalQuestion({
        taskId,
        detection,
        gaps: [
          { check: 'empty-diff-guard', severity: 'fail', actual: 'no diff', expected: 'real diff', remediation: 'add paths' },
        ],
        remediationAttempt: 2,
        repoRoot: tmpRoot,
      })

      expect(r.written).toBe(true)
      const expectedPath = resolve(tmpRoot, '.agent/questions', `${taskId}-q.md`)
      expect(r.path).toBe(expectedPath)
      expect(existsSync(expectedPath)).toBe(true)

      const contents = readFileSync(expectedPath, 'utf-8')
      // Blocking-reason markers required by the user-facing contract:
      expect(contents).toContain('infra-via-Claude-Code policy')
      expect(contents).toContain('Layer C')
      expect(contents).toContain(taskId)
      // Layer C evidence is the matched task_id token — should appear in
      // the matched-evidence list.
      expect(contents).toMatch(/Matched evidence[\s\S]*requeue/i)
      // Verifier gap context surfaced for the human handler.
      expect(contents).toContain('empty-diff-guard')
      expect(contents).toContain('Remediation attempt 2')
      // Next steps — both options listed.
      expect(contents).toContain('Have Claude Code audit + reauthor')
      expect(contents).toContain('false positive')
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('skip-if-exists — does not overwrite an earlier write (earliest wins)', async () => {
    const tmpRoot = mkdtempSync(resolve(tmpdir(), 'atlas-infra-policy-'))
    try {
      const taskId = 'phase-1.0x-verifier-sync-hardening'
      const body = '# Task\n\n## Files required\n\n- `verifier/src/server.ts`\n'
      const detection = isInfraSpec({ body, taskId })
      expect(detection.infra).toBe(true)
      expect(detection.layer).toBe('A')

      // First write — should land.
      const first = await writeInfraRefusalQuestion({
        taskId,
        detection,
        gaps: [{ check: 'first-write-marker', severity: 'fail' }],
        remediationAttempt: 1,
        repoRoot: tmpRoot,
      })
      expect(first.written).toBe(true)
      const firstContents = readFileSync(first.path, 'utf-8')
      expect(firstContents).toContain('first-write-marker')

      // Second write with different gaps — should SKIP (earliest wins).
      const second = await writeInfraRefusalQuestion({
        taskId,
        detection,
        gaps: [{ check: 'second-write-marker', severity: 'fail' }],
        remediationAttempt: 2,
        repoRoot: tmpRoot,
      })
      expect(second.written).toBe(false)
      expect(second.reason).toBe('already exists')

      // The file content must still be the first write — the second
      // call must NOT have overwritten with less-informative content.
      const finalContents = readFileSync(first.path, 'utf-8')
      expect(finalContents).toContain('first-write-marker')
      expect(finalContents).not.toContain('second-write-marker')
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('creates the .agent/questions/ directory when it does not yet exist', async () => {
    const tmpRoot = mkdtempSync(resolve(tmpdir(), 'atlas-infra-policy-'))
    try {
      // tmpRoot has no .agent/questions/ yet — mkdir({recursive:true}) creates it.
      const taskId = 'phase-1.0x-workshop-preflight-filesrequired'
      const body = '# Task\n\nTitle-only.\n'
      const detection = isInfraSpec({ body, taskId })
      expect(detection.infra).toBe(true)

      const r = await writeInfraRefusalQuestion({
        taskId,
        detection,
        gaps: [],
        remediationAttempt: 1,
        repoRoot: tmpRoot,
      })
      expect(r.written).toBe(true)
      expect(existsSync(resolve(tmpRoot, '.agent/questions'))).toBe(true)
      expect(existsSync(r.path)).toBe(true)
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})

// ──────────────────────── Drift-pin against verifier ────────────────────────
//
// Pins agreement between queue-validator.extractFilesRequired (the second-
// copy parser the guard uses) and verifier.parseTaskSpec (the first-copy
// parser the Verifier itself uses on every audit). A widening of either
// parser without a matching widening of the other will fail one of these
// cases — surfacing the drift instead of silently weakening the guard.
//
// KNOWN DRIFT (documented inline below): the queue-validator's bullet
// regex includes `atlas` in the prefix allowlist; the verifier's does
// NOT. For un-back-ticked bullet paths under `atlas/`, the two parsers
// disagree. This pre-dates the guard. The drift is in the SAFE direction
// for the policy guard (extra `atlas/` paths in bullets → MORE infra
// detection, not less). It still wants surfacing.

describe('drift-pin: queue-validator.extractFilesRequired vs verifier.parseTaskSpec', () => {
  // Helper — compare both parser outputs as sorted arrays of normalized strings.
  function compareParsers(body: string): { atlas: string[]; verifier: string[] } {
    const atlasPaths = [...extractFilesRequired(body)].sort()
    const verifierPaths = [...parseTaskSpec(body, 'drift-pin-test').filesRequired].sort()
    return { atlas: atlasPaths, verifier: verifierPaths }
  }

  it('corpus #1 — backtick paths under atlas/: AGREE', () => {
    const body = '# Task\n\n- `atlas/src/lib/foo.ts`\n- `atlas/src/cron/conductor.ts`\n'
    const r = compareParsers(body)
    expect(r.atlas).toEqual(r.verifier)
  })

  it('corpus #2 — backtick paths under src/ (product): AGREE', () => {
    const body = '# Task\n\n- `src/components/atlas/AtlasCockpit.tsx`\n- `src/lib/atlas-client.ts`\n'
    const r = compareParsers(body)
    expect(r.atlas).toEqual(r.verifier)
  })

  it('corpus #3 — table-cell paths under verifier/: AGREE', () => {
    const body = `# Task

| File | Purpose |
|---|---|
| verifier/src/server.ts | HTTP handler |
| verifier/src/lib/audit.ts | Write rows |
`
    const r = compareParsers(body)
    expect(r.atlas).toEqual(r.verifier)
  })

  it('corpus #4 — bullet paths under each infra prefix: DOCUMENTED DRIFT on atlas/', () => {
    const body = `# Task

- atlas/src/foo.ts
- verifier/src/bar.ts
- agent/agent-loop.sh
`
    const r = compareParsers(body)
    // KNOWN DIVERGENCE: queue-validator's bullet regex allowlists `atlas`
    // (line 84 of queue-validator.ts), verifier's does not (line 69 of
    // verifier/src/lib/spec-parser.ts). For the policy guard this drift
    // is in the safe direction — Atlas catches more infra `atlas/` bullets,
    // not fewer. Asserting current behavior so any future widening of
    // either side that crosses this line trips the test.
    expect(r.atlas).toEqual(['agent/agent-loop.sh', 'atlas/src/foo.ts', 'verifier/src/bar.ts'])
    expect(r.verifier).toEqual(['agent/agent-loop.sh', 'verifier/src/bar.ts'])
    // The difference is exactly `atlas/src/foo.ts`:
    const onlyInAtlas = r.atlas.filter((p) => !r.verifier.includes(p))
    expect(onlyInAtlas).toEqual(['atlas/src/foo.ts'])
  })

  it('corpus #5 — mixed (backtick + table + bullet under src/): AGREE', () => {
    const body = `# Task

## Files required

- \`src/lib/auth.ts\`

| Path | Job |
|---|---|
| src/components/Header.tsx | brand |

- src/pages/index.tsx
`
    const r = compareParsers(body)
    expect(r.atlas).toEqual(r.verifier)
  })

  it('corpus #6 — empty body (title only): AGREE (both return [])', () => {
    const body = '# Task\n\nTitle-only spec with no body paths.\n'
    const r = compareParsers(body)
    expect(r.atlas).toEqual([])
    expect(r.verifier).toEqual([])
    expect(r.atlas).toEqual(r.verifier)
  })
})
