import { GoogleGenerativeAI } from '@google/generative-ai'
import { AIJudgment, Gap, TaskSpec } from '../types'

function buildPrompt(spec: TaskSpec, fullRepoCode: string): string {
  return `You are a strict code quality reviewer for CropsIntel V3 with access to the entire codebase.

TASK SPEC (${spec.id}):
${spec.rawMarkdown.slice(0, 10000)}

CODEBASE CONTEXT:
${fullRepoCode.slice(0, 50000)}

ACCEPTANCE CRITERIA:
${spec.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Review the shipped code holistically against the task spec. Use your large context to spot:
- Inconsistencies between the spec and what was actually shipped
- Files that exist but are stubs (<NotImplemented>, TODO comments, placeholder text)
- Routes in App.tsx pointing to <NotImplemented> instead of real components
- Missing pages/components that the spec required
- Patterns inconsistent with the rest of the codebase

Be RUTHLESSLY HONEST. Respond with ONLY valid JSON (no markdown wrapper):
{
  "passed": true or false,
  "confidence": 0-100,
  "notes": "2-3 sentence assessment",
  "gaps": [
    {
      "check": "gemini-judgment",
      "severity": "fail",
      "expected": "string",
      "actual": "string",
      "remediation": "string"
    }
  ]
}`
}

function parseResponse(text: string): { passed: boolean; confidence: number; notes: string; gaps: Gap[] } {
  // Strip possible markdown code fences
  const cleaned = text.replace(/```(?:json)?\n?/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { passed?: boolean; confidence?: number; notes?: string; gaps?: Gap[] }
    return {
      passed: parsed.passed ?? false,
      confidence: parsed.confidence ?? 0,
      notes: parsed.notes ?? '',
      gaps: parsed.gaps ?? [],
    }
  } catch {
    const jsonMatch = /\{[\s\S]*\}/.exec(cleaned)
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
    return { passed: false, confidence: 0, notes: `Could not parse Gemini response: ${text.slice(0, 200)}`, gaps: [] }
  }
}

export async function askGemini25ProJudgment(
  spec: TaskSpec,
  fullRepoCode: string,
): Promise<AIJudgment> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.warn('[verifier] GEMINI_API_KEY not set — skipping Gemini judgment')
    return { passed: true, gaps: [], notes: 'Gemini judgment skipped — GEMINI_API_KEY not configured', confidence: 0 }
  }

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-pro' })

  try {
    const result = await model.generateContent(buildPrompt(spec, fullRepoCode))
    const text = result.response.text()
    if (!text) throw new Error('Empty response from Gemini 2.5 Pro')

    const parsed = parseResponse(text)
    return { passed: parsed.passed, gaps: parsed.gaps, notes: parsed.notes, confidence: parsed.confidence }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier] Gemini judgment failed:', msg)
    return {
      passed: false,
      gaps: [{
        check: 'gemini-judgment',
        severity: 'warn',
        expected: 'Gemini judgment completes successfully',
        actual: `Gemini API call failed: ${msg}`,
        remediation: 'Check GEMINI_API_KEY and network connectivity',
      }],
      notes: `Gemini call failed: ${msg}`,
      confidence: 0,
    }
  }
}
