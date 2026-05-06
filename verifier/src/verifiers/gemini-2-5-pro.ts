import { GoogleGenerativeAI } from '@google/generative-ai'
import { AIJudgment, Gap, TaskSpec } from '../types'
import { askGPT4oSecondJudge, isGeminiTransientFailure } from './gpt-4o-second-judge'

function buildPrompt(spec: TaskSpec, fullRepoCode: string): string {
  return `You are a strict code quality reviewer for CropsIntel V3 with access to the entire codebase.

TASK SPEC (${spec.id}):
${spec.rawMarkdown.slice(0, 10000)}

CODEBASE CONTEXT (the actual shipped files — search here before making claims):
${fullRepoCode.slice(0, 50000)}

ACCEPTANCE CRITERIA:
${spec.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Rules you MUST follow

1. BEFORE making any claim about file contents, you MUST quote the relevant lines from the CODEBASE CONTEXT above. If you cannot find the quoted lines in the text provided to you, do NOT make the claim.
2. Do NOT infer missing code from the spec alone. Only report something missing if you searched the codebase context and could not find it.
3. Spec text that mentions placeholder filenames (containing "xxxxxx", "<task-id>", "phase-X.YY", "NNN", or angle-bracket templates) describes a FORMAT, not a required file — ignore these.
4. Paths starting with "~/" are read-only reference paths, not deliverables — ignore them.
5. Files under ".agent/questions/" are optional fallback artifacts — absence is not a gap.

## What to check
- Files that exist but are stubs (<NotImplemented>, TODO comments, placeholder text)
- Routes in App.tsx pointing to <NotImplemented> instead of real components
- Missing pages/components that the spec required (only if you can confirm their absence by searching the codebase context)
- Patterns inconsistent with the rest of the codebase

## Self-check step (REQUIRED before producing your final answer)
After drafting your gap list, go through each gap one more time:
- For each "X is missing" claim: find and quote the lines from CODEBASE CONTEXT that prove X is absent. If you cannot quote evidence of absence, remove the gap from your list.
- For each "file contains stub" claim: quote the exact stub line.

Be RUTHLESSLY HONEST but evidence-based. Respond with ONLY valid JSON (no markdown wrapper):
{
  "passed": true or false,
  "confidence": 0-100,
  "notes": "2-3 sentence assessment",
  "gaps": [
    {
      "check": "gemini-judgment",
      "severity": "fail",
      "expected": "string",
      "actual": "string (include quoted evidence)",
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

const RETRY_DELAYS_MS = [2000, 4000, 8000] // 2s, 4s, 8s exponential backoff
const MAX_RETRIES = 3

export async function askGemini25ProJudgment(
  spec: TaskSpec,
  fullRepoCode: string,
): Promise<AIJudgment> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.warn('[verifier] GEMINI_API_KEY not set — skipping Gemini judgment')
    return { passed: false, gaps: [], notes: 'Gemini judgment skipped — GEMINI_API_KEY not configured (treated as hard FAIL per phase-1.00f)', confidence: 0 }
  }

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: 'gemini-2.5-pro',
    generationConfig: { temperature: 0.0 },
  })

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(buildPrompt(spec, fullRepoCode))
      const text = result.response.text()
      if (!text) throw new Error('Empty response from Gemini 2.5 Pro')

      const parsed = parseResponse(text)
      // Phase 1.00f: null/undefined passed values are hard FAIL, never inconclusive
      if (parsed.passed === null || parsed.passed === undefined) {
        console.warn('[verifier] Gemini returned null/undefined verdict — normalizing to hard FAIL')
        return {
          passed: false,
          gaps: parsed.gaps.length > 0 ? parsed.gaps : [{
            check: 'gemini-judgment',
            severity: 'fail',
            expected: 'Gemini judge returns non-null verdict',
            actual: 'Gemini returned null/undefined for passed field',
            remediation: 'Manual review required — judge returned no verdict',
          }],
          notes: `Gemini returned null/undefined verdict (treated as FAIL). Original notes: ${parsed.notes}`,
          confidence: parsed.confidence,
        }
      }
      return { passed: parsed.passed, gaps: parsed.gaps, notes: parsed.notes, confidence: parsed.confidence }
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)

      // Phase 1.00f: retry with exponential backoff on network/transient errors
      if (isGeminiTransientFailure(err) && attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAYS_MS[attempt]
        console.warn(`[verifier] Gemini attempt ${attempt + 1}/${MAX_RETRIES} failed (${msg.slice(0, 100)}) — retrying in ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      // On final attempt or non-transient error, break and handle below
      console.error(`[verifier] Gemini judgment failed on attempt ${attempt + 1}/${MAX_RETRIES}:`, msg)
      break
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError)

  // Phase 1.00f: after 3 retry attempts, fall back to GPT-4o
  if (isGeminiTransientFailure(lastError)) {
    console.warn('[verifier] All Gemini retry attempts exhausted — falling back to GPT-4o second judge')
    try {
      const fallback = await askGPT4oSecondJudge(spec, fullRepoCode)
      // Phase 1.00f: normalize null/undefined from fallback too
      if (fallback.passed === null || fallback.passed === undefined) {
        console.warn('[verifier] GPT-4o fallback returned null/undefined verdict — normalizing to hard FAIL')
        return {
          passed: false,
          gaps: fallback.gaps.length > 0 ? fallback.gaps : [{
            check: 'gpt-4o-second-judgment',
            severity: 'fail',
            expected: 'Judge returns non-null verdict',
            actual: 'GPT-4o fallback returned null/undefined for passed field',
            remediation: 'Manual review required — judge returned no verdict',
          }],
          notes: `GPT-4o fallback returned null/undefined verdict (treated as FAIL). Original notes: ${fallback.notes}`,
          confidence: fallback.confidence,
        }
      }
      return fallback
    } catch (fbErr) {
      const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr)
      console.error('[verifier] GPT-4o fallback also failed:', fbMsg)
      // Fall through to hard FAIL response below
    }
  }

  // Phase 1.00f: both Gemini (after 3 retries) and GPT-4o fallback failed → hard FAIL
  return {
    passed: false,
    gaps: [{
      check: 'gemini-judgment',
      severity: 'fail',
      expected: 'Gemini judgment completes successfully',
      actual: `Gemini exhausted ${MAX_RETRIES} attempts: ${msg}`,
      remediation: 'Check GEMINI_API_KEY and network connectivity',
    }],
    notes: `Gemini call failed after ${MAX_RETRIES} attempts: ${msg}`,
    confidence: 0,
  }
}
