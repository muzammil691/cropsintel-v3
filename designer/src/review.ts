import { DesignGap, DesignerReview, Verdict, ChangedFile } from './types'
import { loadDesignSystem } from './lib/memory-search'
import { listChangedFiles, readUIFiles, getDiff, isUIFile } from './lib/git-diff'
import { checkDesignTokens } from './checks/design-tokens'
import { checkShadcnUsage } from './checks/shadcn-usage'
import { checkAccessibility } from './checks/accessibility'
import { checkMobileResponsive } from './checks/mobile-responsive'
import { checkMotion } from './checks/motion'
import { askClaudeDesign } from './reviewers/claude-design'
import { askGPTVision } from './reviewers/gpt-vision'
import { buildSpecReviewPrompt } from './prompts/spec-review'
import { buildCommitAuditPrompt } from './prompts/commit-audit'

function aggregate(args: {
  staticGaps: DesignGap[]
  claudeVerdict: Verdict
  claudeConfidence: number
  visionVerdict: Verdict
  visionConfidence: number
  hasVision: boolean
}): { verdict: Verdict; confidence: number } {
  const staticHardFail = args.staticGaps.some(g => g.severity === 'high')

  // Quorum: 1-of-2 fail = fail (more strict than other agents — design quality is binary-ish)
  const claudeFail = args.claudeVerdict === 'fail'
  const visionFail = args.visionVerdict === 'fail'

  if (staticHardFail || claudeFail || (args.hasVision && visionFail)) {
    // Confidence-weighted: take the max confidence of the failing brains
    const failConfidences: number[] = []
    if (staticHardFail) failConfidences.push(0.9)
    if (claudeFail) failConfidences.push(args.claudeConfidence || 0.7)
    if (args.hasVision && visionFail) failConfidences.push(args.visionConfidence || 0.7)
    const confidence = failConfidences.length > 0 ? Math.max(...failConfidences) : 0.7
    return { verdict: 'fail', confidence }
  }

  // Both AI brains responded "unknown" (skipped/errored) and no static gaps
  if (
    args.claudeVerdict === 'unknown' &&
    (!args.hasVision || args.visionVerdict === 'unknown')
  ) {
    return { verdict: 'unknown', confidence: 0 }
  }

  // Pass — average of available pass confidences
  const passConfidences: number[] = []
  if (args.claudeVerdict === 'pass') passConfidences.push(args.claudeConfidence || 0.85)
  if (args.hasVision && args.visionVerdict === 'pass')
    passConfidences.push(args.visionConfidence || 0.85)
  const confidence =
    passConfidences.length > 0
      ? passConfidences.reduce((a, b) => a + b, 0) / passConfidences.length
      : 0.85
  return { verdict: 'pass', confidence }
}

function dedupeGaps(gaps: DesignGap[]): DesignGap[] {
  const seen = new Set<string>()
  const out: DesignGap[] = []
  for (const g of gaps) {
    const key = `${g.check}:${g.file ?? ''}:${g.line ?? ''}:${g.description.slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g)
  }
  return out
}

export async function reviewSpec(args: {
  taskId: string
  specMarkdown: string
}): Promise<DesignerReview> {
  const startedAt = Date.now()

  const designSystem = await loadDesignSystem()
  const prompt = buildSpecReviewPrompt({
    taskId: args.taskId,
    specMarkdown: args.specMarkdown,
    designSystem: designSystem.rawMarkdown,
  })

  const claude = await askClaudeDesign(prompt)
  // Spec review does not use vision (no rendered output yet)
  const vision = await askGPTVision({ prompt, screenshotUrl: undefined })

  const allGaps = dedupeGaps(claude.gaps)
  const { verdict, confidence } = aggregate({
    staticGaps: [],
    claudeVerdict: claude.verdict,
    claudeConfidence: claude.confidence,
    visionVerdict: vision.verdict,
    visionConfidence: vision.confidence,
    hasVision: false,
  })

  return {
    taskId: args.taskId,
    operation: 'review-spec',
    verdict,
    confidence,
    gaps: allGaps,
    aiJudgment: { claude, gptVision: undefined },
    costUsd: claude.costUsd + vision.costUsd,
    durationMs: Date.now() - startedAt,
  }
}

export async function auditCommit(args: {
  taskId: string
  headBefore: string
  headAfter: string
  screenshotUrl?: string
}): Promise<DesignerReview> {
  const startedAt = Date.now()

  // 1. Find changed UI files
  const changedPaths = listChangedFiles(args.headBefore, args.headAfter)
  const uiPaths = changedPaths.filter(isUIFile)

  if (uiPaths.length === 0) {
    // Non-UI commit — automatic pass
    return {
      taskId: args.taskId,
      operation: 'audit-commit',
      verdict: 'pass',
      confidence: 1.0,
      gaps: [],
      aiJudgment: {},
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      headBefore: args.headBefore,
      headAfter: args.headAfter,
      screenshotUrl: args.screenshotUrl,
    }
  }

  const changedFiles: ChangedFile[] = readUIFiles(uiPaths)
  const diff = getDiff(args.headBefore, args.headAfter)

  // 2. Static checks
  const staticGaps: DesignGap[] = [
    ...checkDesignTokens(changedFiles),
    ...checkShadcnUsage(changedFiles),
    ...checkAccessibility(changedFiles),
    ...checkMobileResponsive(changedFiles),
    ...checkMotion(changedFiles),
  ]

  // 3. AI review
  const designSystem = await loadDesignSystem()
  const staticGapSummary = staticGaps
    .slice(0, 30)
    .map(g => `- [${g.severity}] ${g.check}: ${g.description}`)
    .join('\n')

  const prompt = buildCommitAuditPrompt({
    taskId: args.taskId,
    diff,
    changedFiles,
    designSystem: designSystem.rawMarkdown,
    staticGapSummary,
  })

  const [claude, vision] = await Promise.all([
    askClaudeDesign(prompt),
    askGPTVision({ prompt, screenshotUrl: args.screenshotUrl }),
  ])

  const allGaps = dedupeGaps([...staticGaps, ...claude.gaps, ...vision.gaps])

  const { verdict, confidence } = aggregate({
    staticGaps,
    claudeVerdict: claude.verdict,
    claudeConfidence: claude.confidence,
    visionVerdict: vision.verdict,
    visionConfidence: vision.confidence,
    hasVision: Boolean(args.screenshotUrl),
  })

  return {
    taskId: args.taskId,
    operation: 'audit-commit',
    verdict,
    confidence,
    gaps: allGaps,
    aiJudgment: {
      claude,
      gptVision: args.screenshotUrl ? vision : undefined,
    },
    costUsd: claude.costUsd + vision.costUsd,
    durationMs: Date.now() - startedAt,
    headBefore: args.headBefore,
    headAfter: args.headAfter,
    screenshotUrl: args.screenshotUrl,
  }
}
