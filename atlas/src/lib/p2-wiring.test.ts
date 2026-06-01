// Phase 1.0x — P2 workshop pre-flight wiring tests.
//
// Verifies validateQueueCandidateBody is correctly hooked into all four
// queue writers in atlas/src/lib/plan-server.ts and atlas/src/lib/
// queue-orchestrator.ts. Each refusal path is exercised end-to-end with
// a temp REPO_ROOT so the test reaches the real validator + question
// file write, not a mock. The git-commit path is never reached because
// every test asserts a refusal (early return / throw before gitCommitAndPush).

// CRITICAL: REPO_ROOT is evaluated at plan-server module-load time. ES
// module hoisting puts top-level `import` statements before any non-
// import code in the file, so plain assignment to process.env at the
// top of the file runs AFTER plan-server has captured the default
// REPO_ROOT. vi.hoisted() runs before any imports, so the env var is
// set in time.
import { vi, describe, it, expect, afterAll, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const TEST_REPO_ROOT = vi.hoisted(() => {
  const fsMod = require('fs') as typeof import('fs')
  const osMod = require('os') as typeof import('os')
  const pathMod = require('path') as typeof import('path')
  const tmp = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'atlas-p2-wiring-'))
  process.env.REPO_ROOT = tmp
  for (const sub of ['failed', 'done', 'queued', 'in-progress', 'cancelled']) {
    fsMod.mkdirSync(pathMod.join(tmp, '.agent/tasks', sub), { recursive: true })
  }
  return tmp
})

import { requeueWithGaps, safeRequeueWithReset, queueSpecFromPlanNode } from './plan-server'
import { validateQueueCandidateBody } from '../workshop/queue-validator'

afterAll(() => {
  rmSync(TEST_REPO_ROOT, { recursive: true, force: true })
})

// Helper — wipe questions/ between tests so file-write assertions are clean.
beforeEach(() => {
  const qDir = join(TEST_REPO_ROOT, '.agent/questions')
  if (existsSync(qDir)) rmSync(qDir, { recursive: true, force: true })
})

function writeFailedSpec(taskId: string, body: string) {
  writeFileSync(join(TEST_REPO_ROOT, '.agent/tasks/failed', `${taskId}.md`), body, 'utf-8')
}

// ───────────────────── requeueWithGaps ─────────────────────

describe('requeueWithGaps — P2 hook on the auto-requeue path', () => {
  it('refuses empty-paths product spec via P2; writes a P2-flavored question file', async () => {
    const taskId = 'phase-1.4-product-spec-title-only'
    writeFailedSpec(taskId, '# Task: Some product work\n\nNo paths enumerated.\n')

    const result = await requeueWithGaps({
      taskId,
      gaps: [{ check: 'empty-diff-guard', severity: 'fail' }],
      attempt: 1,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('workshop pre-flight refused')
    expect(result.reason).toContain('audit-only: true')

    const qPath = join(TEST_REPO_ROOT, '.agent/questions', `${taskId}-q.md`)
    expect(existsSync(qPath)).toBe(true)
    const stub = readFileSync(qPath, 'utf-8')
    // P2 stub (built by queue-validator.buildQuestionStub) cites the
    // empty-filesRequired refusal explicitly.
    expect(stub).toContain('filesRequired')
  })

  it('infra spec refusal produces ONE infra-flavored stub; P2 never overwrites it', async () => {
    // Empty body + infra task_id token → infra check fires via Layer C
    // BEFORE the P2 check runs. The infra writer uses skip-if-exists,
    // and P2 never executes for infra specs (early-return). Net: one
    // infra-flavored question file with policy language.
    const taskId = 'phase-1.0x-conductor-hardening'
    writeFailedSpec(taskId, '# Task\n\nTitle-only body.\n')

    const result = await requeueWithGaps({
      taskId,
      gaps: [{ check: 'empty-diff-guard', severity: 'fail' }],
      attempt: 1,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('infra spec')
    expect(result.reason).toContain('Layer C')
    // Critically: the reason does NOT mention the P2 escape hatch, proving P2 didn't run.
    expect(result.reason).not.toContain('audit-only: true')

    const qPath = join(TEST_REPO_ROOT, '.agent/questions', `${taskId}-q.md`)
    expect(existsSync(qPath)).toBe(true)
    const stub = readFileSync(qPath, 'utf-8')
    // Infra-policy stub language, not P2 language.
    expect(stub).toContain('infra-via-Claude-Code policy')
    expect(stub).toContain('Layer C')
  })

  it('audit-only: true on a product spec with empty paths PASSES P2 (escape hatch)', async () => {
    // audit-only frontmatter is the explicit escape hatch. With it set
    // and a non-infra task_id, the spec is allowed through. We can't
    // assert success without mocking git, but we can assert that
    // validateQueueCandidateBody returns ok for this content shape —
    // which is the contract requeueWithGaps relies on.
    const content = '---\naudit-only: true\n---\n\n# Investigation: cluster X\n\nMarkdown ADR only.\n'
    const r = validateQueueCandidateBody('phase-1-CLUSTER-investigation-X', content, {
      questionsDir: join(TEST_REPO_ROOT, '.agent/questions'),
      writeQuestion: false,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.auditOnly).toBe(true)
    }
  })
})

// ───────────────────── safeRequeueWithReset ─────────────────────

describe('safeRequeueWithReset — P2 hook on the reset-and-requeue path', () => {
  it('refuses empty body; archive intact; returns {ok:false, archived, reason}', async () => {
    const specId = 'phase-1.4-some-product'
    // Plant a prior copy in failed/ so the archive loop has something
    // to move; we assert it ends up in cancelled/.archive/ regardless
    // of the refusal.
    writeFailedSpec(specId, '# Old\n\nDead.\n')

    const r = await safeRequeueWithReset({
      specId,
      body: '# Task\n\nTitle only — no paths.\n',
    })

    expect(r.ok).toBe(false)
    expect(r.reason).toContain('workshop pre-flight refused')
    // The archived loop ran BEFORE the refusal — archive intent
    // preserved per the locked decision.
    expect(r.archived.length).toBeGreaterThan(0)
    expect(r.archived[0]).toContain(specId)
    // No new file landed in queued/.
    expect(existsSync(join(TEST_REPO_ROOT, '.agent/tasks/queued', `${specId}.md`))).toBe(false)
  })

  it('audit-only: true body passes the gate (contract via validator)', () => {
    const r = validateQueueCandidateBody(
      'phase-1-CLUSTER-investigation-Y',
      '---\naudit-only: true\n---\n\n# Investigation\n\nADR body.\n',
      { questionsDir: join(TEST_REPO_ROOT, '.agent/questions'), writeQuestion: false },
    )
    expect(r.ok).toBe(true)
  })
})

// ───────────────────── queueSpecFromPlanNode ─────────────────────

describe('queueSpecFromPlanNode — P2 hook on the plan-tree path', () => {
  it('refuses plan-node-derived body with empty paths; throws with actionable reason', async () => {
    // The synthesizer in queueSpecFromPlanNode produces a body of:
    //   ---\npriority: 3\nsource: atlas-plan-tree\n---
    //   # Task: <title>
    //   <body>
    //   ## Source plan node
    //   - Phase hint: ...
    //   - Generated: ...
    // No back-ticked paths. P2 must refuse with an actionable error.
    await expect(
      queueSpecFromPlanNode(
        'Add verified-user widget',
        'Build a green panel showing positions on the dashboard.',
        '1.6',
      ),
    ).rejects.toThrow(/workshop pre-flight refused/)
    // The throw must cite the question file path for operator follow-up.
    await expect(
      queueSpecFromPlanNode(
        'Another node',
        'Different body, still no paths.',
        '1.7',
      ),
    ).rejects.toThrow(/See .+-q\.md/)
  })
})

// ───────────────────── queueWorkshopDiff contract ─────────────────────
//
// queueWorkshopDiff has heavy dependencies (Supabase, applyOpsToMasterPlan,
// git, fs ops). Instead of mocking the whole pipeline, we test the
// validator's contract against the EXACT body shape queue-orchestrator's
// synthSpecBody emits. If this contract holds, the wiring inside
// queueWorkshopDiff correctly refuses title-only synth specs and accepts
// specs with a back-ticked Files Required block.
//
// synthSpecBody shape (from queue-orchestrator.ts):
//   # <phase_id>: <title>\n_launch tier: <tier>_\n\n<op.body or fallback>\n

describe('queueWorkshopDiff — synthSpecBody validator contract', () => {
  // Recreated from queue-orchestrator.ts synthSpecBody. Kept in sync via
  // PR review when synthSpecBody changes; not exported from the
  // orchestrator to avoid widening its public surface.
  function synthSpecBodyLike(args: {
    phase_id: string
    title?: string
    body?: string
    launch_tier?: string
  }): string {
    const titleLine = args.title ? `# ${args.phase_id}: ${args.title}` : `# ${args.phase_id}`
    const bodyText = (args.body ?? '').trim()
    const tierLine = args.launch_tier ? `\n_launch tier: ${args.launch_tier}_\n` : ''
    return `${titleLine}\n${tierLine}\n${bodyText || '_(no body provided in diff — fill in before building)_'}\n`
  }

  it('title-only synthesized spec → refused with Workshop-actionable reason', () => {
    const body = synthSpecBodyLike({
      phase_id: '1.6',
      title: 'Verified-user dashboard widget',
      // op.body is empty (user typed only a title in the Workshop diff)
    })
    const r = validateQueueCandidateBody(
      'phase-1.6-verified-user-dashboard-widget',
      body,
      { questionsDir: join(TEST_REPO_ROOT, '.agent/questions'), writeQuestion: false },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // The orchestrator wraps this in a Workshop-specific message:
      // "Workshop spec '<title>' has no enumerable file paths. Add a '##
      // Files required' section with back-ticked paths, or set
      // 'audit-only: true' in the spec frontmatter."
      // We assert here that the underlying validator gives the orchestrator
      // the !ok signal it needs to fire that wrapped message.
      expect(r.reason).toContain('filesRequired')
    }
  })

  it('synthesized spec WITH back-ticked Files required block → queues normally', () => {
    const body = synthSpecBodyLike({
      phase_id: '1.6',
      title: 'Verified-user dashboard widget',
      body: '## Files required\n\n- `src/components/dashboard/VerifiedUserWidget.tsx`\n- `src/lib/positions-client.ts`\n',
    })
    const r = validateQueueCandidateBody(
      'phase-1.6-verified-user-dashboard-widget',
      body,
      { questionsDir: join(TEST_REPO_ROOT, '.agent/questions'), writeQuestion: false },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.filesRequired).toContain('src/components/dashboard/VerifiedUserWidget.tsx')
      expect(r.filesRequired).toContain('src/lib/positions-client.ts')
      expect(r.auditOnly).toBe(false)
    }
  })

  it('audit-only: true synth spec passes (Workshop investigation ADR)', () => {
    // If the user authors a Workshop add-op with `audit-only: true` in
    // the body's frontmatter — wait, synthSpecBody doesn't propagate
    // frontmatter from the op. The orchestrator's synth body lacks any
    // YAML frontmatter, so audit-only at the Workshop layer would need
    // to be set on the SPEC after synthesis. This test documents that
    // limitation: the audit-only escape hatch currently does NOT work
    // for Workshop-drafted specs because synthSpecBody doesn't emit
    // frontmatter. Audit-only would require either a synthSpecBody
    // change or operator post-edit.
    const bodyNoFrontmatter = synthSpecBodyLike({ phase_id: '1.X', title: 'Investigation' })
    const r1 = validateQueueCandidateBody('phase-1-investigation', bodyNoFrontmatter, {
      questionsDir: join(TEST_REPO_ROOT, '.agent/questions'),
      writeQuestion: false,
    })
    expect(r1.ok).toBe(false) // refused — no escape hatch reachable

    // For comparison: if frontmatter is added manually, audit-only does work.
    const bodyWithFrontmatter = '---\naudit-only: true\n---\n' + bodyNoFrontmatter
    const r2 = validateQueueCandidateBody('phase-1-investigation', bodyWithFrontmatter, {
      questionsDir: join(TEST_REPO_ROOT, '.agent/questions'),
      writeQuestion: false,
    })
    expect(r2.ok).toBe(true)
  })
})
