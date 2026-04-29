import { CouncilOutput, DeepTrace, QuickTrace } from '../types'

function isDeepTrace(trace: QuickTrace | DeepTrace): trace is DeepTrace {
  return 'pairSessions' in trace
}

export function buildADRMarkdown(
  adrNumber: number,
  title: string,
  question: string,
  output: CouncilOutput
): string {
  const date = new Date().toISOString().split('T')[0]
  const mins = Math.floor(output.durationMs / 60_000)
  const secs = Math.floor((output.durationMs % 60_000) / 1000)
  const wallTime = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  const adrNum = String(adrNumber).padStart(3, '0')

  let body = `# ADR-${adrNum}: ${title}

**Status:** Proposed
**Date:** ${date}
**Council depth:** ${output.depth === 'deep' ? 'Deep' : 'Quick'}
**Confidence:** ${output.confidence.toFixed(2)}
**Total cost:** $${output.costUsd.toFixed(4)}
**Wall time:** ${wallTime}

## Context
${question}

## Decision
${output.finalDecision}
`

  if (isDeepTrace(output.trace)) {
    const t = output.trace
    body += `
## Pair session results

### Session 1 (Claude + GPT, reviewed by Gemini)
**Solution summary:** ${t.pairSessions[0].solution.slice(0, 500)}${t.pairSessions[0].solution.length > 500 ? '...' : ''}

**Gemini review score:** ${t.pairSessions[0].review.overall_quality_score.toFixed(2)}
**Strengths:** ${t.pairSessions[0].review.strengths.join('; ')}
**Weaknesses:** ${t.pairSessions[0].review.weaknesses.join('; ')}
**Blindspots:** ${t.pairSessions[0].review.blindspots.join('; ')}

### Session 2 (Claude + Gemini, reviewed by GPT)
**Solution summary:** ${t.pairSessions[1].solution.slice(0, 500)}${t.pairSessions[1].solution.length > 500 ? '...' : ''}

**GPT review score:** ${t.pairSessions[1].review.overall_quality_score.toFixed(2)}
**Strengths:** ${t.pairSessions[1].review.strengths.join('; ')}
**Weaknesses:** ${t.pairSessions[1].review.weaknesses.join('; ')}

### Session 3 (GPT + Gemini, reviewed by Claude)
**Solution summary:** ${t.pairSessions[2].solution.slice(0, 500)}${t.pairSessions[2].solution.length > 500 ? '...' : ''}

**Claude review score:** ${t.pairSessions[2].review.overall_quality_score.toFixed(2)}
**Strengths:** ${t.pairSessions[2].review.strengths.join('; ')}
**Weaknesses:** ${t.pairSessions[2].review.weaknesses.join('; ')}

## Tri-council synthesis
The three pair sessions converged at round ${t.triCouncil.convergedAt} of ${t.triCouncil.rounds.length} negotiation round(s).
${t.triCouncil.usedTiebreaker ? 'A GPT-4o tiebreaker was invoked due to deadlock.' : 'No tiebreaker was needed — two or more AIs converged organically.'}

## Research validation
- **Claude:** ${t.validation[0].findings.slice(0, 400)}${t.validation[0].findings.length > 400 ? '...' : ''}
- **GPT:** ${t.validation[1].findings.slice(0, 400)}${t.validation[1].findings.length > 400 ? '...' : ''}
- **Gemini:** ${t.validation[2].findings.slice(0, 400)}${t.validation[2].findings.length > 400 ? '...' : ''}
`
  } else {
    const t = output.trace as QuickTrace
    body += `
## Synthesis
${t.judge.reasoning}

**Individual answers:**
- **Claude:** ${(t.claude?.content ?? '(none)').slice(0, 300)}
- **GPT:** ${(t.gpt?.content ?? '(none)').slice(0, 300)}
- **Gemini:** ${(t.gemini?.content ?? '(none)').slice(0, 300)}
`
  }

  body += `
## Consequences
This architectural decision should be implemented in the next relevant task. The council has reviewed the question from multiple AI perspectives and reached a consensus.

## Full audit trail
council_runs.id = ${output.runId} in V3 Supabase
`

  return body
}
