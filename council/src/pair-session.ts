import { pairTurnClaude } from './providers/claude'
import { pairTurnGPT } from './providers/openai'
import { pairTurnGemini } from './providers/gemini'
import { askClaude } from './providers/claude'
import { askOpenAI } from './providers/openai'
import { askGemini } from './providers/gemini'
import {
  AIProvider,
  PairSession,
  PairSessionInput,
  PairTurn,
  ReviewerOutput,
} from './types'

// ─── Pair turn dispatcher ─────────────────────────────────────────────

type ChatHistory = Array<{ role: 'user' | 'assistant'; content: string }>
type GeminiHistory = Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>

async function takeTurn(
  provider: AIProvider,
  systemPrompt: string,
  history: ChatHistory,
  message: string
): Promise<PairTurn> {
  if (provider === 'claude') {
    return pairTurnClaude(systemPrompt, history, message)
  }
  if (provider === 'gpt') {
    return pairTurnGPT(systemPrompt, history, message)
  }
  // gemini needs its own history format
  const geminiHistory: GeminiHistory = history.map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }))
  return pairTurnGemini(systemPrompt, geminiHistory, message)
}

function buildPairSystemPrompt(
  myName: string,
  partnerName: string,
  question: string,
  context?: Record<string, unknown>
): string {
  const contextNote = context ? `\n\nAdditional context: ${JSON.stringify(context)}` : ''
  return `You are ${myName}, an expert software architect collaborating with ${partnerName} on the following architectural question for CropsIntel V3 — a multi-commodity agricultural intelligence platform.

Question: ${question}${contextNote}

Your job is to work WITH ${partnerName} to reach the BEST possible solution through dialogue. Be direct. Challenge assumptions. Build on your partner's ideas. After several turns, you should converge on a joint solution.

Rules:
- Be specific and practical (file names, function signatures, SQL schemas where relevant)
- Reference CropsIntel V3's architecture (Supabase, React 19, TypeScript, Railway)
- Don't pad — say what matters
- When you finalize in your last turn, begin with "FINAL SOLUTION:"`
}

function buildReviewerPrompt(
  reviewerName: string,
  question: string,
  solution: string,
  pairNames: [AIProvider, AIProvider]
): string {
  return `You are ${reviewerName}, an expert software architect reviewing a solution produced by ${pairNames[0]} and ${pairNames[1]} for CropsIntel V3.

## Original question
${question}

## Their joint solution
${solution}

## Your task
Review this solution critically. Return a JSON object:
{
  "strengths": ["..."],
  "weaknesses": ["..."],
  "blindspots": ["..."],
  "alternatives_to_consider": ["..."],
  "overall_quality_score": 0.0,
  "detailed_critique": "..."
}

Do NOT propose your own competing solution. Your role is to identify what the pair missed or got wrong.`
}

async function extractFinalSolution(dialogue: PairTurn[]): Promise<string> {
  // Find last turn that contains "FINAL SOLUTION:"
  for (let i = dialogue.length - 1; i >= 0; i--) {
    const turn = dialogue[i]
    if (turn.content.includes('FINAL SOLUTION:')) {
      return turn.content.split('FINAL SOLUTION:')[1].trim()
    }
  }
  // Fall back to last turn content
  return dialogue[dialogue.length - 1]?.content ?? '(no solution produced)'
}

async function runReviewer(
  reviewer: AIProvider,
  question: string,
  solution: string,
  pair: [AIProvider, AIProvider]
): Promise<ReviewerOutput> {
  const prompt = buildReviewerPrompt(reviewer, question, solution, pair)
  const started = Date.now()

  let rawContent = ''
  let costUsd = 0

  if (reviewer === 'claude') {
    const res = await askClaude(prompt)
    rawContent = res.content
    costUsd = res.costUsd
  } else if (reviewer === 'gpt') {
    const res = await askOpenAI(prompt)
    rawContent = res.content
    costUsd = res.costUsd
  } else {
    const res = await askGemini(prompt)
    rawContent = res.content
    costUsd = res.costUsd
  }

  // Parse JSON — be lenient
  try {
    const jsonStart = rawContent.indexOf('{')
    const jsonEnd = rawContent.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const parsed = JSON.parse(rawContent.slice(jsonStart, jsonEnd + 1)) as Partial<ReviewerOutput>
      return {
        strengths: parsed.strengths ?? [],
        weaknesses: parsed.weaknesses ?? [],
        blindspots: parsed.blindspots ?? [],
        alternatives_to_consider: parsed.alternatives_to_consider ?? [],
        overall_quality_score: parsed.overall_quality_score ?? 0.5,
        detailed_critique: parsed.detailed_critique ?? rawContent,
        costUsd,
        durationMs: Date.now() - started,
      }
    }
  } catch (_e) {
    // Fallback
  }

  return {
    strengths: [],
    weaknesses: ['Could not parse structured review'],
    blindspots: [],
    alternatives_to_consider: [],
    overall_quality_score: 0.5,
    detailed_critique: rawContent,
    costUsd,
    durationMs: Date.now() - started,
  }
}

// ─── Public: run a pair session ───────────────────────────────────────

export async function runPairSession(input: PairSessionInput): Promise<PairSession> {
  const started = Date.now()
  const [aiA, aiB] = input.pair
  const dialogue: PairTurn[] = []

  const systemA = buildPairSystemPrompt(aiA, aiB, input.question, input.context)
  const systemB = buildPairSystemPrompt(aiB, aiA, input.question, input.context)

  // Shared history for reference (not sent — each AI gets its own system prompt)
  const sharedHistory: ChatHistory = []

  // Turn 1: AI-A proposes initial solution
  const turn1 = await takeTurn(aiA, systemA, [], `Please propose an initial solution to this question: ${input.question}`)
  dialogue.push(turn1)
  sharedHistory.push({ role: 'assistant', content: turn1.content })

  for (let turn = 2; turn <= input.maxTurns; turn++) {
    const isEven = turn % 2 === 0
    const speaker = isEven ? aiB : aiA
    const systemPrompt = isEven ? systemB : systemA
    const isFinal = turn === input.maxTurns

    // Build the context message for this speaker
    const prevContent = dialogue[dialogue.length - 1].content
    const prompt = isFinal
      ? `Please give your final assessment. Start with "FINAL SOLUTION:" and write the complete joint solution.\n\nPrevious message: ${prevContent}`
      : `Please respond to this:\n\n${prevContent}`

    // History from this speaker's perspective (they see the dialogue as alternating user/assistant)
    const historyForSpeaker: ChatHistory = []
    for (let i = 0; i < dialogue.length; i++) {
      const d = dialogue[i]
      // From the current speaker's view: their own turns = 'assistant', partner's turns = 'user'
      historyForSpeaker.push({
        role: d.speaker === speaker ? 'assistant' : 'user',
        content: d.content,
      })
    }

    const newTurn = await takeTurn(speaker, systemPrompt, historyForSpeaker, prompt)
    dialogue.push(newTurn)
    sharedHistory.push({ role: 'user', content: prompt })
    sharedHistory.push({ role: 'assistant', content: newTurn.content })

    // If AI confirmed FINAL SOLUTION, stop early
    if (newTurn.content.includes('FINAL SOLUTION:') && turn >= 5) break
  }

  const solution = await extractFinalSolution(dialogue)
  const totalDialogueCost = dialogue.reduce((sum, t) => sum + t.costUsd, 0)

  const review = await runReviewer(input.reviewer, input.question, solution, input.pair)
  const totalCostUsd = totalDialogueCost + review.costUsd

  return {
    pair: input.pair,
    reviewer: input.reviewer,
    dialogue,
    solution,
    review,
    totalCostUsd,
    durationMs: Date.now() - started,
  }
}
