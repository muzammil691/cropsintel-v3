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
import { escalateToCouncil } from './verifiers/escalate-to-council'
import { loadShippedCodeContext } from './lib/context-loader'

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
  let judgmentCallNotes = ''

  if (!hasFail(gaps)) {
    const shippedCode = buildShippedCodeSummary(spec)

    const [o3Judgment, geminiJudgment] = await Promise.all([
      askO3Judgment(spec, shippedCode),
      askGemini25ProJudgment(spec, shippedCode),
    ])

    if (o3Judgment.passed === geminiJudgment.passed) {
      // Agreement — high confidence
      judgmentCallNotes =
        `o3 (confidence ${o3Judgment.confidence}%): ${o3Judgment.notes}\n\n` +
        `Gemini 2.5 Pro (confidence ${geminiJudgment.confidence}%): ${geminiJudgment.notes}`

      if (!o3Judgment.passed) {
        // Both AI judges said FAIL. Their gaps must carry severity='fail' so
        // the final passed = !hasFail(gaps) computation actually reflects the
        // judges' verdict. Prior bug: judges sometimes emit severity='warn' or
        // 'medium', and hasFail() only triggers on 'fail' — so verdict=pass
        // shipped despite both judges saying fail (observed on phase-1.10b).
        //
        // We promote ALL judge gaps to severity='fail' under agreement-fail.
        // The judges' own severity field is preserved as `judgeSeverity` in
        // the description so it isn't lost.
        const seen = new Set<string>()
        for (const g of [...o3Judgment.gaps, ...geminiJudgment.gaps]) {
          const key = `${g.check}:${g.actual}`
          if (!seen.has(key)) {
            seen.add(key)
            gaps.push({
              ...g,
              severity: 'fail',
              actual: g.severity && g.severity !== 'fail'
                ? `${g.actual} [judge-severity=${g.severity}]`
                : g.actual,
            })
          }
        }

        // Belt-and-braces: if dedup somehow yielded zero gaps despite both
        // judges saying fail, synthesize one so the run can't accidentally
        // pass. This keeps verdict aligned with judgment even on degenerate
        // judge output (empty gaps array, malformed shape, etc.).
        if (gaps.filter(g => g.severity === 'fail').length === 0) {
          gaps.push({
            check: 'ai-judgment-agreement-fail',
            severity: 'fail',
            expected: 'Both judges PASS or specific gaps to remediate',
            actual: 'Both o3 and Gemini judged FAIL but emitted zero usable gaps',
            remediation: 'Re-run the spec through Builder; if the issue persists, check judge prompt outputs in judgmentCallNotes.',
          })
        }
      }
    } else {
      // Disagreement — escalate to Council
      console.log(`[verifier] o3 and Gemini disagree for ${taskId} — escalating to Council`)
      const councilTiebreak = await escalateToCouncil({
        question: `o3 says ${o3Judgment.passed ? 'PASS' : 'FAIL'}, Gemini 2.5 Pro says ${geminiJudgment.passed ? 'PASS' : 'FAIL'}. Who is right?`,
        context: { spec, o3Judgment, geminiJudgment, shippedCode },
        depth: 'quick',
      })
      judgmentCallNotes = `DISAGREEMENT — escalated to Council.\n${councilTiebreak.finalDecision}`
      if (!councilTiebreak.passes) {
        // Same rule as agreement-fail: promote council tiebreak gaps to fail.
        for (const g of councilTiebreak.gaps) {
          gaps.push({
            ...g,
            severity: 'fail',
            actual: g.severity && g.severity !== 'fail'
              ? `${g.actual} [council-severity=${g.severity}]`
              : g.actual,
          })
        }
        if (gaps.filter(g => g.severity === 'fail').length === 0) {
          gaps.push({
            check: 'council-tiebreak-fail',
            severity: 'fail',
            expected: 'Council to PASS or emit specific gaps',
            actual: 'Council tiebreak ruled FAIL but emitted zero usable gaps',
            remediation: 'Inspect councilTiebreak.finalDecision in judgmentCallNotes.',
          })
        }
      }
    }
  }

  void mode // used by callers for logging context — no check-specific behaviour yet

  return {
    taskId: spec.id,
    passed: !hasFail(gaps),
    gaps,
    durationMs: Date.now() - startedAt,
    judgmentCallNotes,
  }
}
