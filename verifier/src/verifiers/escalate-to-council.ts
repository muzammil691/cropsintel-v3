import OpenAI from 'openai'
import { CouncilTiebreak, Gap, AIJudgment, TaskSpec } from '../types'

interface CouncilInput {
  question: string
  context: {
    spec: TaskSpec
    o3Judgment: AIJudgment
    geminiJudgment: AIJudgment
    shippedCode: string
  }
  depth: 'quick' | 'deep'
}

export async function escalateToCouncil(input: CouncilInput): Promise<CouncilTiebreak> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    // Conservative fallback: if we can't resolve the disagreement, default to FAIL
    return {
      finalDecision: 'Council unavailable (OPENAI_API_KEY not set) — defaulting to FAIL per conservative policy',
      passes: false,
      gaps: [{
        check: 'council-tiebreak',
        severity: 'warn',
        expected: 'Council tiebreak resolves disagreement',
        actual: 'Council unavailable',
        remediation: 'Set OPENAI_API_KEY to enable the GPT-4o tiebreak judge',
      }],
    }
  }

  const client = new OpenAI({ apiKey })

  // GPT-4o judges the disagreement — deliberately not Claude (builder = Claude)
  const prompt = `You are GPT-4o, the impartial judge of the CropsIntel V3 AI Council.

Two independent AI reviewers disagreed on whether a shipped task passes quality review.

REVIEWER 1 (OpenAI o3): ${input.context.o3Judgment.passed ? 'PASS' : 'FAIL'} (confidence: ${input.context.o3Judgment.confidence}%)
o3 reasoning: ${input.context.o3Judgment.notes}
o3 gaps: ${JSON.stringify(input.context.o3Judgment.gaps)}

REVIEWER 2 (Gemini 2.5 Pro): ${input.context.geminiJudgment.passed ? 'PASS' : 'FAIL'} (confidence: ${input.context.geminiJudgment.confidence}%)
Gemini reasoning: ${input.context.geminiJudgment.notes}
Gemini gaps: ${JSON.stringify(input.context.geminiJudgment.gaps)}

TASK SPEC (${input.context.spec.id}):
${input.context.spec.rawMarkdown.slice(0, 4000)}

QUESTION: ${input.question}

As the judge, analyze both verdicts, consider the confidence scores, and make the final call.
Respond with ONLY valid JSON:
{
  "passes": true or false,
  "finalDecision": "2-3 sentence explanation of your ruling",
  "gaps": []
}`

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 2048,
    })

    const content = response.choices[0]?.message?.content ?? ''
    if (!content) throw new Error('Empty response from GPT-4o council judge')

    const parsed = JSON.parse(content) as { passes?: boolean; finalDecision?: string; gaps?: Gap[] }
    return {
      passes: parsed.passes ?? false,
      finalDecision: parsed.finalDecision ?? 'Council judgment unclear',
      gaps: parsed.gaps ?? [],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier] Council tiebreak failed:', msg)
    return {
      finalDecision: `Council tiebreak failed: ${msg}. Defaulting to FAIL per conservative policy.`,
      passes: false,
      gaps: [{
        check: 'council-tiebreak',
        severity: 'warn',
        expected: 'Council tiebreak successful',
        actual: `Council API call failed: ${msg}`,
        remediation: 'Check API keys and network connectivity',
      }],
    }
  }
}
