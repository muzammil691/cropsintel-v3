import { readFileSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec, VerificationResult } from './types'
import { parseTaskSpec } from './lib/spec-parser'
import { checkFilesExist } from './checks/files-exist'
import { checkStubDetector } from './checks/stub-detector'
import { checkMigrationsApplied } from './checks/migrations-applied'
import { checkRoutesWired } from './checks/routes-wired'
import { checkTestsExist } from './checks/tests-exist'
import { checkDepsInstalled } from './checks/deps-installed'
import { checkComponentsImplemented } from './checks/components-implemented'
import { checkE2ESmoke } from './checks/e2e-smoke'
import { askO3Judgment } from './verifiers/openai-o3'
import { askGemini25ProJudgment } from './verifiers/gemini-2-5-pro'
import { loadShippedCodeContext } from './lib/context-loader'
import { resolveVerdict } from './lib/verdict-resolver'
import type { JudgeOutput } from './types/verdict'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..')
}

function buildShippedCodeSummary(spec: TaskSpec): string {
  // Bug I fix — files explicitly named in the spec's "Files" section get
  // loaded WHOLE; only secondary files (none today, but plumbing is here) get
  // truncated. Logged via [ctx-loader] for visibility.
  const { contextString } = loadShippedCodeContext({
    spec,
    repoRoot: getRepoRoot(),
    additionalDiffPaths: [],
  })
  return contextString
}

function hasFail(gaps: Gap[]): boolean {
  return gaps.some(g => g.severity === 'fail')
}

export async function verify(
  taskSpecPath: string,
  commitSha: string,
  mode: 'audit-only' | 'gate',
): Promise<VerificationResult> {
  const startedAt = Date.now()

  // Phase 1.00f: wrap entire verify function in try-catch to prevent crashes.
  // Unhandled exceptions must never propagate — return a clean FAIL result
  // with logged error instead of leaving server.ts to write verify_crashed rows.
  try {
    // Task ID derived from filename: 'phase-1.04-rbac.md' → 'phase-1.04-rbac'
    const taskId = taskSpecPath.replace(/.*[/\\]/, '').replace(/\.md$/, '')

    const markdown = readFileSync(taskSpecPath, 'utf-8')
    const spec = parseTaskSpec(markdown, taskId)

    const gaps: Gap[] = []

    // ── 1. Programmatic checks ──────────────────────────────────────────────────
    gaps.push(...checkFilesExist(spec))
    gaps.push(...checkStubDetector(spec))
    gaps.push(...checkMigrationsApplied(spec))
    gaps.push(...checkRoutesWired(spec))
    gaps.push(...checkTestsExist(spec))
    gaps.push(...checkDepsInstalled(spec))
    gaps.push(...checkComponentsImplemented(spec))

    // ── 2. e2e smoke (skip if hard failures already found — would fail for other reasons) ──
    if (!hasFail(gaps)) {
      gaps.push(...checkE2ESmoke(spec))
    }

    // ── 3. AI judgment (skip if hard failures already found — save API costs) ───
    // Phase 1.10v: replaced inline aggregation with resolveVerdict().
    // The resolver is deterministic — no LLM tiebreak — and closes three holes
    // observed on phase-1.10b:
    //   1. passed=null silently coerced to pass
    //   2. boolean `passed=true` while judgment notes said "fail decision"
    //   3. agreement-fail with gaps:[] producing verdict=pass
    let judgmentCallNotes = ''
    let aiVerdict: 'pass' | 'fail' | 'inconclusive' | null = null
    let subjectMatterHits = 0

    if (!hasFail(gaps)) {
      const shippedCode = buildShippedCodeSummary(spec)

      // Phase 1.00f: empty-diff guard — if shipped code summary is empty or
      // whitespace-only, return clean FAIL immediately without calling judges.
      // Prevents judge crash on empty context and eliminates undefined behaviour.
      const trimmed = shippedCode.trim()
      if (trimmed.length === 0) {
        console.warn('[verifier] Empty diff detected — no code to audit. Returning clean FAIL.')
        return {
          taskId: spec.id,
          passed: false,
          verdict: 'fail',
          gaps: [{
            check: 'empty-diff-guard',
            severity: 'fail',
            expected: 'Non-empty code diff to audit',
            actual: 'Shipped code summary is empty or whitespace-only',
            remediation: 'Verify that spec.filesRequired is populated and files exist in the repo',
          }],
          durationMs: Date.now() - startedAt,
          judgmentCallNotes: 'Skipped — empty diff',
        }
      }

      const [o3Judgment, geminiJudgment] = await Promise.all([
        askO3Judgment(spec, shippedCode),
        askGemini25ProJudgment(spec, shippedCode),
      ])

      const resolution = resolveVerdict(
        o3Judgment as JudgeOutput,
        geminiJudgment as JudgeOutput,
      )

      judgmentCallNotes =
        `o3 (confidence ${o3Judgment.confidence}%): ${o3Judgment.notes}\n\n` +
        `Gemini 2.5 Pro (confidence ${geminiJudgment.confidence}%): ${geminiJudgment.notes}\n\n` +
        `Resolver: ${resolution.verdict.toUpperCase()} — ${resolution.reason}`

      aiVerdict = resolution.verdict
      subjectMatterHits = resolution.subjectMatterHits
      if (resolution.verdict !== 'pass') {
        gaps.push(...resolution.gaps)
      }
    }

    void mode // used by callers for logging context — no check-specific behaviour yet

    // Final verdict aggregation:
    //   programmatic-fail OR resolver-fail → fail
    //   resolver-inconclusive             → inconclusive (gate blocks; passed=false)
    //   everything else                   → pass
    const programmaticFail = hasFail(gaps)
    const verdict: 'pass' | 'fail' | 'inconclusive' = programmaticFail
      ? 'fail'
      : aiVerdict === 'inconclusive'
        ? 'inconclusive'
        : aiVerdict === 'fail'
          ? 'fail'
          : 'pass'

    return {
      taskId: spec.id,
      passed: verdict === 'pass',
      verdict,
      gaps,
      durationMs: Date.now() - startedAt,
      judgmentCallNotes,
      subjectMatterHits,
    }
  } catch (err) {
    // Phase 1.00f: catch-all for unhandled exceptions. Log with full stack
    // trace then return clean FAIL result. This prevents verify_crashed rows
    // in the DB — the caller (server.ts) will get a proper VerificationResult
    // with passed=false instead of a throw that triggers its crash handler.
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[verifier] UNHANDLED EXCEPTION in verify():', msg)
    if (stack) {
      console.error('[verifier] Stack trace:', stack)
    }

    // Extract task ID for the error result (best-effort — if path parsing
    // failed we won't have it, but the catch block itself can't fail).
    const taskId = taskSpecPath.replace(/.*[/\\]/, '').replace(/\.md$/, '')

    return {
      taskId,
      passed: false,
      verdict: 'fail',
      gaps: [{
        check: 'verifier-unhandled-exception',
        severity: 'fail',
        expected: 'Verifier completes without throwing',
        actual: `Unhandled exception: ${msg}`,
        remediation: 'Check verifier logs for stack trace. Manual review required.',
      }],
      durationMs: Date.now() - startedAt,
      judgmentCallNotes: `Verifier crashed: ${msg}`,
    }
  }
}
