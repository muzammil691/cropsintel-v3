// Product-first-failure pause guard.
//
// When a non-infra ("product") spec fails the Verifier on the very FIRST
// build attempt (currentAttempt === 0), the conductor pauses instead of
// auto-requeueing. The operator reviews the failure via a question file
// at .agent/questions/<rootTaskId>-q.md and picks one of three options:
// re-queue as-is, edit the spec, or leave the shipped code as-is.
//
// Mirrors the structure of infra-policy.ts:
//   - a pure predicate (shouldPauseForProductFirstFailure)
//   - a markdown stub builder (buildProductFirstFailureQuestionStub)
//   - a skip-if-exists file writer (writeProductFirstFailureQuestion)
//   - a single-line WhatsApp message builder (buildPauseWhatsAppMessage)
//
// The skip-if-exists check on the question file is the dedup contract:
// caller checks `result.written` and only pings WhatsApp on a fresh write.
// On Railway restart, the in-memory autoRequeuedFailures Set is lost but
// the file persists on disk — so the operator still gets exactly one ping
// per spec across restarts within the verifier_runs 1-hour query window.

import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface VerifierGapShape {
  check?: string
  severity?: string
  expected?: string
  actual?: string
  remediation?: string
  [key: string]: unknown
}

// Predicate fires only on first failure of a non-infra spec. Infra=true
// is handled separately by the infra-policy guard (hook B) and is gated
// out here so we don't double-write a question file.
export function shouldPauseForProductFirstFailure(args: {
  currentAttempt: number
  infra: boolean
}): boolean {
  return args.currentAttempt === 0 && !args.infra
}

export function buildProductFirstFailureQuestionStub(args: {
  taskId: string
  gaps: VerifierGapShape[]
  commitSha?: string | null
  ranAt?: string | null
}): string {
  const { taskId, gaps, commitSha, ranAt } = args
  const shortSha = commitSha && commitSha.length > 0 ? commitSha.slice(0, 7) : '<unknown>'
  const ranAtDisplay = ranAt && ranAt.length > 0 ? ranAt : '<unknown>'
  const gapCount = gaps.length

  const gapBlocks =
    gaps.length === 0
      ? '_(The Verifier returned no specific gaps — the failure was a verdict-only fail. Check the verifier_runs table for raw judge output if needed.)_\n'
      : gaps.map((gap, idx) => renderGap(idx + 1, gap)).join('\n')

  return [
    `# Question — ${taskId}`,
    ``,
    `**Status: PAUSED — waiting for your review.**`,
    ``,
    `Atlas built and shipped this work. After the ship, the Verifier reviewed`,
    `the resulting code and flagged a concern. Atlas's normal behavior would`,
    `be to draft a fix automatically and try again — up to 3 times — but per`,
    `policy, the FIRST time a product spec fails the Verifier, Atlas pauses`,
    `and asks you to look first. This is so the auto-fix loop can't grind`,
    `the code into a worse shape across multiple unsupervised attempts.`,
    ``,
    `**The shipped code is currently on \`main\`.** The build was green, the`,
    `tests passed. The Verifier's concern is post-ship audit feedback, not`,
    `a broken build. Whether to act on it is your call.`,
    ``,
    `---`,
    ``,
    `## Spec that paused`,
    ``,
    `- **Spec ID:** \`${taskId}\``,
    `- **Spec file:** \`.agent/tasks/done/${taskId}.md\``,
    `- **Shipped commit:** \`${shortSha}\``,
    `- **Verifier ran at:** \`${ranAtDisplay}\` (UTC)`,
    `- **Verifier verdict:** failed ${gapCount} check(s) — see below`,
    ``,
    `---`,
    ``,
    `## What the Verifier said was wrong`,
    ``,
    gapBlocks,
    `---`,
    ``,
    `## Your three options`,
    ``,
    `Pick whichever fits. None of these is wrong — it depends on whether`,
    `you agree with the Verifier's complaint.`,
    ``,
    `### 1. Re-queue it as-is`,
    ``,
    `Pick this if you think the Verifier is being too strict and the`,
    `shipped code is actually fine, but you want Atlas to take another`,
    `swing at addressing the complaint anyway.`,
    ``,
    `**How:** create a file at \`.agent/tasks/queued/${taskId}-rem.md\``,
    `containing the original spec body PLUS the gaps section above, then`,
    `commit and push. Atlas's auto-fix chain takes over from there — up to`,
    `3 attempts, then it escalates to you via WhatsApp if all three fail.`,
    ``,
    `### 2. Edit the spec first`,
    ``,
    `Pick this if the Verifier's complaint is valid and the original spec`,
    `language led Atlas to build the wrong thing. Fix the spec, then`,
    `re-queue.`,
    ``,
    `**How (two paths, either works):**`,
    `- **(a) Quick edit:** open \`.agent/tasks/done/${taskId}.md\`, fix`,
    `  the spec language to match what you actually want built, move the`,
    `  file back to \`.agent/tasks/queued/\`, commit. Atlas re-builds against`,
    `  the corrected spec on its next cycle.`,
    `- **(b) Fresh draft:** start a new Workshop session (or use Claude`,
    `  Code directly) to author a corrected spec that explicitly addresses`,
    `  the Verifier's concern. Better for substantial rework.`,
    ``,
    `**Before re-queueing:** delete this question file so the pause guard`,
    `treats the re-queue as a fresh first-failure cycle. Otherwise the`,
    `guard would silently skip the next failure (it remembers it already`,
    `asked you about this spec).`,
    ``,
    `### 3. Leave it as-is`,
    ``,
    `Pick this if the shipped code is fine and the Verifier's complaint`,
    `isn't worth acting on. Common reasons: strict-reading nit (the`,
    `Verifier is technically right but the difference doesn't matter),`,
    `transient flake (network blip, judge timeout), or a known-acceptable`,
    `behavior the spec didn't anticipate.`,
    ``,
    `**How:** delete this question file. Deleting it is how Atlas knows`,
    `you've reviewed this — the file's presence is the "still waiting for`,
    `operator" signal, so leaving it would just mean Atlas keeps treating`,
    `this spec as unreviewed. Nothing else to do. The shipped code stays`,
    `on \`main\`. Atlas's dedup tracking already remembers this failure`,
    `within the current cron lifetime, so it won't re-pause on the same`,
    `failure row.`,
    ``,
    `---`,
    ``,
    `_Generated by Atlas's auto-requeue policy guard. This pause fires once`,
    `per spec, on the very first Verifier failure of the base build. If you`,
    `pick option 1 and the manual re-queue ALSO fails the Verifier, Atlas`,
    `will treat that as implicit consent to the full auto-fix chain — up`,
    `to 3 more attempts, then a WhatsApp escalation. No further pauses on`,
    `this spec._`,
    ``,
  ].join('\n')
}

function renderGap(n: number, gap: VerifierGapShape): string {
  const check =
    typeof gap.check === 'string' && gap.check.length > 0 ? gap.check : '(unspecified check)'
  const severity =
    typeof gap.severity === 'string' && gap.severity.length > 0
      ? gap.severity
      : '(unspecified)'
  const expected =
    typeof gap.expected === 'string' && gap.expected.length > 0
      ? gap.expected
      : '_(not provided)_'
  const actual =
    typeof gap.actual === 'string' && gap.actual.length > 0
      ? gap.actual
      : '_(not provided)_'
  const remediation =
    typeof gap.remediation === 'string' && gap.remediation.length > 0
      ? gap.remediation
      : '_(not provided)_'

  return [
    `### Gap ${n} — \`${check}\``,
    ``,
    `*Severity: ${severity}*`,
    ``,
    `**The Verifier expected:** ${expected}`,
    ``,
    `**What it actually found:** ${actual}`,
    ``,
    `**Suggested fix (from the Verifier):** ${remediation}`,
    ``,
  ].join('\n')
}

// Builds the single-line WhatsApp ping. Strips backticks from the gap
// summary (WhatsApp clients render code spans inconsistently). Truncates
// the gap summary to keep the full message under ~200 chars where
// possible. Newlines forbidden — WhatsApp preview shows the first line only.
export function buildPauseWhatsAppMessage(args: {
  taskId: string
  firstGap: VerifierGapShape | undefined
}): string {
  const { taskId, firstGap } = args
  const gapSummary = summarizeGapForWhatsApp(firstGap)
  const prefix = `⏸ Atlas paused ${taskId} after first Verifier failure.`
  const suffix = `Review options in .agent/questions/${taskId}-q.md`

  const overhead = prefix.length + suffix.length + 4 // 2 separating spaces + period + buffer
  const TARGET = 200
  const gapBudget = Math.max(20, TARGET - overhead)

  const trimmedGap =
    gapSummary.length > gapBudget
      ? gapSummary.slice(0, Math.max(1, gapBudget - 1)).trimEnd() + '…'
      : gapSummary

  return `${prefix} ${trimmedGap}. ${suffix}`
}

function summarizeGapForWhatsApp(gap: VerifierGapShape | undefined): string {
  if (!gap) return 'Verifier flagged this spec (no detail)'
  const checkRaw =
    typeof gap.check === 'string' && gap.check.length > 0 ? gap.check : 'unspecified check'
  const detailRaw =
    typeof gap.actual === 'string' && gap.actual.length > 0
      ? gap.actual
      : typeof gap.expected === 'string' && gap.expected.length > 0
        ? gap.expected
        : ''
  const clean = (s: string) => s.replace(/`/g, '').replace(/\s+/g, ' ').trim()
  const check = clean(checkRaw)
  const detail = clean(detailRaw)
  if (detail.length === 0) return check
  return `${check}: ${detail}`
}

// Skip-if-exists file writer. Returns { written: false } when the file
// already exists on disk; caller MUST gate the WhatsApp ping on
// result.written === true so the operator gets exactly one ping per spec.
export async function writeProductFirstFailureQuestion(args: {
  taskId: string
  gaps: VerifierGapShape[]
  commitSha?: string | null
  ranAt?: string | null
  repoRoot: string
}): Promise<{ written: boolean; path: string; reason?: string }> {
  const questionsDir = resolve(args.repoRoot, '.agent/questions')
  const path = resolve(questionsDir, `${args.taskId}-q.md`)

  try {
    await access(path)
    return { written: false, path, reason: 'already exists' }
  } catch {
    /* not present → fall through to write */
  }

  const stub = buildProductFirstFailureQuestionStub({
    taskId: args.taskId,
    gaps: args.gaps,
    commitSha: args.commitSha,
    ranAt: args.ranAt,
  })
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, stub, 'utf-8')
  return { written: true, path }
}
