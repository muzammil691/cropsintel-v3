import OpenAI from 'openai'
import { AIJudgment, Gap, TaskSpec } from '../types'

function buildPrompt(spec: TaskSpec, shippedCodeSummary: string): string {
  return `You are a strict code quality reviewer for CropsIntel V3.

TASK SPEC (${spec.id}):
${spec.rawMarkdown.slice(0, 8000)}

SHIPPED CODE:
${shippedCodeSummary.slice(0, 8000)}

ACCEPTANCE CRITERIA:
${spec.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Your job: determine whether the shipped code FULLY satisfies the task spec's acceptance criteria, or is a STUB/incomplete implementation that passes the build but doesn't satisfy the spec.

Be RUTHLESSLY HONEST. A stub passes the build but doesn't satisfy the spec. Specifically look for:
- Components that return <NotImplemented> instead of real UI
- TODO comments where real code should be
- Files that exist but contain only boilerplate or scaffolding
- Missing features the spec explicitly requires
- Routes in App.tsx pointing to <NotImplemented>
- Placeholder text like "coming soon" or "Phase X.Y will..."

Respond with ONLY valid JSON in exactly this format (no markdown, no explanation outside JSON):
{
  "passed": true or false,
  "confidence": 0-100,
  "notes": "string explaining your assessment in 2-3 sentences",
  "gaps": [
    {
      "check": "o3-judgment",
      "severity": "fail",
      "expected": "what should have been implemented",
      "actual": "what was actually found",
      "remediation": "specific fix required"
    }
  ]
}`
}

function parseResponse(content: string): { passed: boolean; confidence: number; notes: string; gaps: Gap[] } {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(content) as { passed?: boolean; confidence?: number; notes?: string; gaps?: Gap[] }
    return {
      passed: parsed.passed ?? false,
      confidence: parsed.confidence ?? 0,
      notes: parsed.notes ?? '',
      gaps: parsed.gaps ?? [],
    }
  } catch {
    // Try to extract JSON block from a response that might have surrounding text
    const jsonMatch = /\{[\s\S]*\}/.exec(content)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { passed?: boolean; confidence?: number; notes?: string; gaps?: Gap[] }
        return {
          passed: parsed.passed ?? false,
          confidence: parsed.confidence ?? 0,
          notes: parsed.notes ?? '',
          gaps: parsed.gaps ?? [],
        }
      } catch {
        // fall through
      }
    }
    return { passed: false, confidence: 0, notes: `Could not parse o3 response: ${content.slice(0, 200)}`, gaps: [] }
  }
}

export async function askO3Judgment(
  spec: TaskSpec,
  shippedCodeSummary: string,
): Promise<AIJudgment> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[verifier] OPENAI_API_KEY not set — skipping o3 judgment')
    return { passed: true, gaps: [], notes: 'o3 judgment skipped — OPENAI_API_KEY not configured', confidence: 0 }
  }

  const client = new OpenAI({ apiKey })

  try {
    const response = await client.chat.completions.create({
      model: 'o3',
      messages: [{ role: 'user', content: buildPrompt(spec, shippedCodeSummary) }],
      max_completion_tokens: 4096,
    })

    const content = response.choices[0]?.message?.content ?? ''
    if (!content) throw new Error('Empty response from o3')

    const parsed = parseResponse(content)
    return { passed: parsed.passed, gaps: parsed.gaps, notes: parsed.notes, confidence: parsed.confidence }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier] o3 judgment failed:', msg)
    return {
      passed: false,
      gaps: [{
        check: 'o3-judgment',
        severity: 'warn',
        expected: 'o3 judgment completes successfully',
        actual: `o3 API call failed: ${msg}`,
        remediation: 'Check OPENAI_API_KEY and network connectivity',
      }],
      notes: `o3 call failed: ${msg}`,
      confidence: 0,
    }
  }
}
