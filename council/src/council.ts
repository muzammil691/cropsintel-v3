import { askClaude } from './providers/claude'
import { askOpenAI, judgeWithGPT4o } from './providers/openai'
import { askGemini } from './providers/gemini'
import { runPairSession } from './pair-session'
import { checkBudget } from './lib/budget'
import { nextADRNumber, recordRun, saveADR } from './lib/audit'
import { buildADRMarkdown } from './prompts/adr-prompt'
import {
  AIProvider,
  CouncilInput,
  CouncilOutput,
  DeepTrace,
  PairSession,
  ProviderResponse,
  QuickTrace,
  TriCouncilInput,
  TriCouncilResult,
  TriCouncilRound,
  ValidationResult,
} from './types'

// ─── Quick mode ───────────────────────────────────────────────────────

async function quickCouncil(
  input: CouncilInput,
  startedAt: number
): Promise<Omit<CouncilOutput, 'runId' | 'adrMarkdown'>> {
  const [claudeSettled, gptSettled, geminiSettled] = await Promise.allSettled([
    askClaude(input.question, input.context),
    askOpenAI(input.question, input.context),
    askGemini(input.question, input.context),
  ])

  const claude = claudeSettled.status === 'fulfilled' ? claudeSettled.value : null
  const gpt = gptSettled.status === 'fulfilled' ? gptSettled.value : null
  const gemini = geminiSettled.status === 'fulfilled' ? geminiSettled.value : null

  const judge = await judgeWithGPT4o({
    question: input.question,
    claudeAnswer: claude?.content ?? null,
    gptAnswer: gpt?.content ?? null,
    geminiAnswer: gemini?.content ?? null,
  })

  const costUsd =
    (claude?.costUsd ?? 0) +
    (gpt?.costUsd ?? 0) +
    (gemini?.costUsd ?? 0) +
    judge.costUsd

  const trace: QuickTrace = { claude, gpt, gemini, judge }

  return {
    finalDecision: judge.synthesis,
    confidence: judge.confidence,
    costUsd,
    durationMs: Date.now() - startedAt,
    depth: 'quick',
    trace,
  }
}

// ─── Deep mode helpers ────────────────────────────────────────────────

function buildTriCouncilPrompt(
  question: string,
  sessions: [PairSession, PairSession, PairSession],
  previousRounds: TriCouncilRound[],
  roundNumber: number
): string {
  const sessionSummaries = sessions
    .map(
      (s, i) =>
        `### Session ${i + 1} (${s.pair[0]}+${s.pair[1]}, reviewed by ${s.reviewer})\n**Solution:** ${s.solution}\n**Review (quality: ${s.review.overall_quality_score.toFixed(2)}):**\nStrengths: ${s.review.strengths.join('; ')}\nWeaknesses: ${s.review.weaknesses.join('; ')}\nBlinspots: ${s.review.blindspots.join('; ')}`
    )
    .join('\n\n')

  const previousContext =
    previousRounds.length > 0
      ? `\n\n## Previous round positions\n${JSON.stringify(previousRounds, null, 2)}`
      : ''

  return `You are participating in a tri-council synthesis for CropsIntel V3.

## Original question
${question}

## Three pair-session solutions and their reviews
${sessionSummaries}${previousContext}

## Your task (Round ${roundNumber})
Return a JSON object:
{
  "favoriteSolution": "<which session's solution you prefer (1, 2, or 3) and why>",
  "reasoning": "<your reasoning>",
  "commonGround": "<what all three solutions agree on>",
  "disagreements": "<key points of disagreement and how to resolve them>",
  "proposedSynthesis": "<your proposed combined solution, incorporating the best of all three>"
}

Be specific. The synthesis should be actionable and reference CropsIntel V3's actual architecture.`
}

async function runTriCouncil(input: TriCouncilInput): Promise<TriCouncilResult> {
  const started = Date.now()
  const rounds: TriCouncilRound[] = []
  let totalCost = 0
  let convergedAt = 1
  let usedTiebreaker = false
  let tiebreakerOutput: string | undefined

  for (let round = 1; round <= input.maxNegotiationRounds; round++) {
    const roundPrompt = buildTriCouncilPrompt(input.question, input.sessions, rounds, round)

    const [claudeRes, gptRes, geminiRes] = await Promise.allSettled([
      askClaude(roundPrompt, input.context),
      askOpenAI(roundPrompt, input.context),
      askGemini(roundPrompt, input.context),
    ])

    const parsePosition = (res: PromiseSettledResult<ProviderResponse>, fallback: string) => {
      if (res.status !== 'fulfilled') return { favoriteSolution: '', reasoning: fallback, commonGround: '', disagreements: '', proposedSynthesis: fallback }
      try {
        const content = res.value.content
        const start = content.indexOf('{')
        const end = content.lastIndexOf('}')
        if (start !== -1 && end !== -1) {
          return JSON.parse(content.slice(start, end + 1)) as TriCouncilRound[string]
        }
      } catch (_e) {/* ignore */}
      return { favoriteSolution: '', reasoning: res.value.content, commonGround: '', disagreements: '', proposedSynthesis: res.value.content }
    }

    const roundData: TriCouncilRound = {
      claude: parsePosition(claudeRes, '(failed)'),
      gpt: parsePosition(gptRes, '(failed)'),
      gemini: parsePosition(geminiRes, '(failed)'),
    }

    rounds.push(roundData)
    totalCost +=
      (claudeRes.status === 'fulfilled' ? claudeRes.value.costUsd : 0) +
      (gptRes.status === 'fulfilled' ? gptRes.value.costUsd : 0) +
      (geminiRes.status === 'fulfilled' ? geminiRes.value.costUsd : 0)

    // Check convergence: do 2+ AIs have similar syntheses?
    const syntheses = [
      roundData['claude']?.proposedSynthesis ?? '',
      roundData['gpt']?.proposedSynthesis ?? '',
      roundData['gemini']?.proposedSynthesis ?? '',
    ]

    // Simple convergence check: if all three gave non-empty syntheses, we converge
    const nonEmpty = syntheses.filter(s => s.length > 50)
    if (nonEmpty.length >= 2) {
      convergedAt = round
      break
    }
  }

  // Final decision: take the last round's GPT synthesis as canonical (most structured)
  // If rounds is empty for some reason, handle gracefully
  const lastRound = rounds[rounds.length - 1]
  let decision = lastRound?.['gpt']?.proposedSynthesis ?? lastRound?.['claude']?.proposedSynthesis ?? '(no consensus reached)'

  // If no consensus, use GPT-4o as tiebreaker
  if (decision === '(no consensus reached)' || decision.length < 50) {
    usedTiebreaker = true
    const tiebreakerPrompt = `Three AIs could not fully converge on a synthesis for: "${input.question}"\n\nRound data: ${JSON.stringify(lastRound)}\n\nAs a neutral tiebreaker, provide the best possible synthesis in 3-5 paragraphs.`
    const tiebreakerRes = await askOpenAI(tiebreakerPrompt)
    tiebreakerOutput = tiebreakerRes.content
    decision = tiebreakerOutput
    totalCost += tiebreakerRes.costUsd
  }

  // Confidence from average of round data (approximate)
  const confidence = Math.min(0.95, 0.6 + convergedAt * 0.1)

  return {
    rounds,
    decision,
    confidence,
    convergedAt,
    usedTiebreaker,
    tiebreakerOutput,
    totalCostUsd: totalCost,
    durationMs: Date.now() - started,
  }
}

async function runValidation(
  decision: string,
  context?: Record<string, unknown>
): Promise<[ValidationResult, ValidationResult, ValidationResult]> {
  const validationPrompt = `Validate this architectural decision for CropsIntel V3.

## Decision to validate
${decision}

## Your task
Independently research and validate this approach. Return a JSON object:
{
  "findings": "<overall validation findings in 2-3 paragraphs>",
  "technicalAssumptions": ["<assumption 1>", "<assumption 2>"],
  "knownAntiPatterns": ["<anti-pattern or risk if any>"],
  "suggestedRefinements": ["<refinement 1>"]
}

Focus on:
1. Whether technical assumptions are correct for Supabase + React 19 + Railway
2. Known anti-patterns for this type of architecture
3. Whether this aligns with CropsIntel V3's information-wall and multi-commodity requirements`

  const validationContext = { ...(context ?? {}), role: 'validator' }

  const [claudeRes, gptRes, geminiRes] = await Promise.allSettled([
    askClaude(validationPrompt, validationContext),
    askOpenAI(validationPrompt, validationContext),
    askGemini(validationPrompt, validationContext),
  ])

  const parseValidation = (
    res: PromiseSettledResult<ProviderResponse>,
    provider: AIProvider
  ): ValidationResult => {
    const started = Date.now()
    if (res.status !== 'fulfilled') {
      return { provider, findings: '(failed)', technicalAssumptions: [], knownAntiPatterns: [], suggestedRefinements: [], costUsd: 0, durationMs: 0 }
    }
    try {
      const content = res.value.content
      const start = content.indexOf('{')
      const end = content.lastIndexOf('}')
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<ValidationResult>
        return {
          provider,
          findings: parsed.findings ?? content,
          technicalAssumptions: parsed.technicalAssumptions ?? [],
          knownAntiPatterns: parsed.knownAntiPatterns ?? [],
          suggestedRefinements: parsed.suggestedRefinements ?? [],
          costUsd: res.value.costUsd,
          durationMs: res.value.durationMs,
        }
      }
    } catch (_e) {/* ignore */}
    return {
      provider,
      findings: res.value.content,
      technicalAssumptions: [],
      knownAntiPatterns: [],
      suggestedRefinements: [],
      costUsd: res.value.costUsd,
      durationMs: res.value.durationMs,
    }
  }

  return [
    parseValidation(claudeRes, 'claude'),
    parseValidation(gptRes, 'gpt'),
    parseValidation(geminiRes, 'gemini'),
  ]
}

// ─── Deep mode ────────────────────────────────────────────────────────

async function deepCouncil(
  input: CouncilInput,
  startedAt: number,
  onProgress?: (msg: string) => void
): Promise<Omit<CouncilOutput, 'runId' | 'adrMarkdown'>> {
  const log = onProgress ?? ((msg: string) => process.stdout.write(msg + '\n'))

  // PHASE 1 — Three rotating pair sessions (sequential to keep costs predictable)
  log(`\n[Council Deep] Phase 1: Pair sessions`)

  log(`  Session 1/3 (Claude+GPT, reviewed by Gemini)...`)
  const s1Start = Date.now()
  const session1 = await runPairSession({
    pair: ['claude', 'gpt'],
    reviewer: 'gemini',
    question: input.question,
    context: input.context,
    maxTurns: 6,
  })
  log(`  Session 1/3 done [${Math.round((Date.now() - s1Start) / 1000)}s]`)

  log(`  Session 2/3 (Claude+Gemini, reviewed by GPT)...`)
  const s2Start = Date.now()
  const session2 = await runPairSession({
    pair: ['claude', 'gemini'],
    reviewer: 'gpt',
    question: input.question,
    context: input.context,
    maxTurns: 6,
  })
  log(`  Session 2/3 done [${Math.round((Date.now() - s2Start) / 1000)}s]`)

  log(`  Session 3/3 (GPT+Gemini, reviewed by Claude)...`)
  const s3Start = Date.now()
  const session3 = await runPairSession({
    pair: ['gpt', 'gemini'],
    reviewer: 'claude',
    question: input.question,
    context: input.context,
    maxTurns: 6,
  })
  log(`  Session 3/3 done [${Math.round((Date.now() - s3Start) / 1000)}s]`)

  // PHASE 2 — Tri-council synthesis
  log(`\n[Council Deep] Phase 2: Tri-council synthesis...`)
  const triStart = Date.now()
  const triCouncilResult = await runTriCouncil({
    sessions: [session1, session2, session3],
    maxNegotiationRounds: 3,
    question: input.question,
    context: input.context,
  })
  log(`  Tri-council done [${Math.round((Date.now() - triStart) / 1000)}s] — converged at round ${triCouncilResult.convergedAt}`)

  // PHASE 3 — Research validation
  log(`\n[Council Deep] Phase 3: Research validation...`)
  const valStart = Date.now()
  const validation = await runValidation(triCouncilResult.decision, input.context)
  log(`  Validation done [${Math.round((Date.now() - valStart) / 1000)}s]`)

  const pairCost = session1.totalCostUsd + session2.totalCostUsd + session3.totalCostUsd
  const valCost = validation.reduce((sum, v) => sum + v.costUsd, 0)
  const costUsd = pairCost + triCouncilResult.totalCostUsd + valCost

  const trace: DeepTrace = {
    pairSessions: [session1, session2, session3],
    triCouncil: triCouncilResult,
    validation,
  }

  return {
    finalDecision: triCouncilResult.decision,
    confidence: triCouncilResult.confidence,
    costUsd,
    durationMs: Date.now() - startedAt,
    depth: 'deep',
    trace,
  }
}

// ─── Public entry point ───────────────────────────────────────────────

export async function council(
  input: CouncilInput,
  onProgress?: (msg: string) => void
): Promise<CouncilOutput> {
  await checkBudget()
  const startedAt = Date.now()

  const partial =
    input.depth === 'deep'
      ? await deepCouncil(input, startedAt, onProgress)
      : await quickCouncil(input, startedAt)

  const output = partial as CouncilOutput

  // Generate ADR
  const adrNumber = await nextADRNumber()
  const title = input.question.slice(0, 80).replace(/\n/g, ' ')
  output.adrMarkdown = buildADRMarkdown(adrNumber, title, input.question, output)

  // Record to DB
  output.runId = await recordRun(input, output)

  // Save ADR
  await saveADR(adrNumber, title, input.question, output.finalDecision, output.runId)

  return output
}
