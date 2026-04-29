export interface PhaseInfo {
  id: string
  name: string
  description: string
  masterPlanSection: string
}

export function buildTaskSpecPrompt(phase: PhaseInfo, masterPlanExcerpt: string): string {
  return `You are writing a task specification for the CropsIntel V3 autonomous coding agent.

The agent reads task specs from \`.agent/tasks/queued/\` and implements them. Task specs must be detailed enough that the agent can implement the feature without additional questions.

## Phase to implement
- Phase ID: ${phase.id}
- Phase name: ${phase.name}
- Description: ${phase.description}
- Master plan section: ${phase.masterPlanSection}

## Relevant master plan excerpt
${masterPlanExcerpt}

## Task spec format (REQUIRED — follow exactly)

\`\`\`markdown
# Task: ${phase.id} — ${phase.name}

**Master plan reference:** ${phase.masterPlanSection}
**Estimated effort:** <X hours>
**Model:** claude-opus-4-7

---

## Goal
<2-3 sentence summary of what this task accomplishes and why it matters>

## In scope
<detailed bullet list of everything to build — be specific about file names, function names, DB table names>

## Repo structure
<file tree of new files to create>

## Schema additions (if any)
<SQL migration if new tables are needed>

## Implementation details
<step-by-step implementation notes, API shapes, key design decisions>

## Acceptance criteria
<numbered testable conditions — things a reviewer can verify>

## Foundation check
<what must exist before this task can start>

## Out of scope
<explicit list of things NOT to do in this task — deferred to future phases>
\`\`\`

Now write the complete task spec for Phase ${phase.id}. Be specific. Include file paths, function signatures, and SQL. The agent should be able to implement this without follow-up questions.`
}

export function buildArchitecturalCheckPrompt(taskSpec: string): string {
  return `Review this CropsIntel V3 task spec and identify any architectural decisions that require a Deep Council run.

An architectural decision is one where:
1. There are two or more valid approaches and the choice has long-term consequences
2. The spec assumes a library or pattern that may have alternatives worth comparing
3. There's a design trade-off that isn't obvious from the spec

## Task spec to review
${taskSpec}

## Your response
Return JSON:
{
  "hasArchitecturalDecision": boolean,
  "decisions": [
    {
      "question": "<the architectural question to put to the council>",
      "context": "<why this matters + what approaches exist>",
      "urgency": "blocking" | "advisory"
    }
  ]
}

If hasArchitecturalDecision is false, return empty decisions array.`
}
