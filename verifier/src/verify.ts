import { readFileSync, existsSync } from 'fs'
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

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..')
}

function buildShippedCodeSummary(spec: TaskSpec): string {
  const root = getRepoRoot()
  const parts: string[] = []

  // Include up to 20 required files (truncated to fit AI context limits)
  for (const filePath of spec.filesRequired.slice(0, 20)) {
    const fullPath = join(root, filePath)
    if (!existsSync(fullPath)) {
      parts.push(`=== ${filePath} ===\n[FILE MISSING]`)
      continue
    }
    try {
      const content = readFileSync(fullPath, 'utf-8')
      const truncated =
        content.length > 3000 ? content.slice(0, 3000) + '\n...(truncated)' : content
      parts.push(`=== ${filePath} ===\n${truncated}`)
    } catch {
      parts.push(`=== ${filePath} ===\n[READ ERROR]`)
    }
  }

  return parts.join('\n\n')
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
        // Deduplicate gaps from both models before pushing
        const seen = new Set<string>()
        for (const g of [...o3Judgment.gaps, ...geminiJudgment.gaps]) {
          const key = `${g.check}:${g.actual}`
          if (!seen.has(key)) {
            seen.add(key)
            gaps.push(g)
          }
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
        gaps.push(...councilTiebreak.gaps)
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
