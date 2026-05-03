// Fallback "second judge" when the primary Gemini-2.5-Pro judge is unavailable
// (503, network timeout, etc). Uses GPT-4o with a slightly different prompt so
// it doesn't perfectly mirror o3's first judgment — we want orthogonal review,
// not a rubber stamp.
//
// Only invoked from gemini-2-5-pro.ts on transient failure. NOT a permanent
// replacement — when Gemini recovers, the primary path resumes.

import OpenAI from 'openai'
import { AIJudgment, Gap, TaskSpec } from '../types'

function buildPrompt(spec: TaskSpec, fullRepoCode: string): string {
  return `You are the SECOND code-quality reviewer on CropsIntel V3, brought in because the primary peer reviewer (Gemini 2.5 Pro) is unavailable. The o3 reviewer has already weighed in; your job is to give an INDEPENDENT view focused on what o3 might miss.

TASK SPEC (${spec.id}):
${spec.rawMarkdown.slice(0, 8000)}

CODEBASE CONTEXT (the actual shipped files — search here before claiming anything is missing):
${fullRepoCode.slice(0, 40000)}

ACCEPTANCE CRITERIA:
${spec.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## What you focus on (different from o3 — pattern + integration concerns)

- Cross-file consistency: does the new code match patterns already in the codebase?
- Database / schema integrity: are migrations + RLS + indexes proper?
- Side effects: any silent data loss, missing error handling, swallowed exceptions?
- Security: AI keys leaked client-side, missing RLS, info-wall violations
- Foundation-first: does the change depend on something not yet shipped?

## Rules
1. BEFORE claiming a file is missing, quote the relevant lines from CODEBASE CONTEXT proving absence. If you can't quote evidence, drop the claim.
2. Spec text mentioning placeholder filenames ("xxxxxx", "<task-id>", "phase-X.YY") describes a FORMAT, not a deliverable.
3. Files under .agent/questions/ are optional — absence is not a gap.
4. Be ruthless on real issues; do NOT invent issues to look thorough.

## Self-check (REQUIRED before final answer)
For each gap claim, find quoted evidence in CODEBASE CONTEXT. Drop unsupported claims.

Respond with ONLY valid JSON (no markdown wrapper):
{
  "passed": true or false,
  "confidence": 0-100,
  "notes": "2-3 sentence assessment focused on cross-file consistency, schema integrity, and security",
  "gaps": [
    {
      "check": "gpt-4o-second-judgment",
      "severity": "fail",
      "expected": "string",
      "actual": "string (include quoted evidence)",
      "remediation": "string"
    }
  ]
}`
}

function parseResponse(text: string): { passed: boolean; confidence: number; notes: string; gaps: Gap[] } {
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
    return { passed: false, confidence: 0, notes: `Could not parse GPT-4o second-judge response: ${text.slice(0, 200)}`, gaps: [] }
  }
}

export async function askGPT4oSecondJudge(
  spec: TaskSpec,
  fullRepoCode: string,
): Promise<AIJudgment> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[verifier] OPENAI_API_KEY not set — second judge fallback unavailable')
    return {
      passed: true,
      gaps: [],
      notes: 'GPT-4o second judge skipped — OPENAI_API_KEY not configured',
      confidence: 0,
    }
  }

  const client = new OpenAI({ apiKey })

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: buildPrompt(spec, fullRepoCode) }],
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      temperature: 0.0,
    })

    const content = response.choices[0]?.message?.content ?? ''
    if (!content) throw new Error('Empty response from GPT-4o second judge')

    const parsed = parseResponse(content)
    return {
      passed: parsed.passed,
      gaps: parsed.gaps,
      notes: `[GPT-4o fallback — Gemini was unavailable] ${parsed.notes}`,
      confidence: parsed.confidence,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier] GPT-4o second-judge failed:', msg)
    return {
      passed: false,
      gaps: [{
        check: 'second-judge-fallback',
        severity: 'warn',
        expected: 'Second-opinion judge completes successfully',
        actual: `Both Gemini AND GPT-4o failed. GPT-4o error: ${msg}`,
        remediation: 'Manual review needed — automated second-opinion unavailable.',
      }],
      notes: `Second-judge fallback failed: ${msg}`,
      confidence: 0,
    }
  }
}

/**
 * Heuristic: did the Gemini call fail with a transient error worth retrying
 * via GPT-4o, or is it a real judgment of "fail"?
 */
export function isGeminiTransientFailure(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('service unavailable') ||
    msg.includes('experiencing high demand') ||
    msg.includes('overloaded') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('empty response')
  )
}
