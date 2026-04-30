// Spec template + validator. Atlas drafts CropsIntel V3 task specs whose shape Builder
// can pick up and run. The validator enforces structural rigor; missing sections cause
// the draft pipeline to retry with the gap list as additional context.

export interface ValidationResult {
  ok: boolean
  missing: string[]
}

interface SectionCheck {
  name: string
  pattern: RegExp
}

const REQUIRED_SECTIONS: SectionCheck[] = [
  { name: '# Task: Phase X.Y heading', pattern: /^#\s+Task:\s+Phase\s+\d+\.\d+[a-z0-9]*\s+[—\-]/im },
  { name: '**Master plan reference:** line', pattern: /\*\*Master plan reference:\*\*/i },
  { name: '**Estimated effort:** line', pattern: /\*\*Estimated effort:\*\*/i },
  { name: '**Model:** line', pattern: /\*\*Model:\*\*/i },
  { name: 'model: frontmatter', pattern: /^model:\s*\S+/im },
  { name: '## Goal', pattern: /^##\s+Goal\b/im },
  { name: '## Files or ## Architecture', pattern: /^##\s+(Files|Architecture)\b/im },
  { name: '## Success criteria', pattern: /^##\s+Success criteria\b/im },
  { name: '## Risks + mitigations', pattern: /^##\s+Risks\s*\+\s*mitigations\b/im },
  { name: '## NEVER list', pattern: /^##\s+NEVER list\b/im },
]

export function validate(markdown: string): ValidationResult {
  const missing: string[] = []
  for (const check of REQUIRED_SECTIONS) {
    if (!check.pattern.test(markdown)) missing.push(check.name)
  }
  return { ok: missing.length === 0, missing }
}

export const SPEC_TEMPLATE_SCAFFOLD = `# Task: Phase <X.Y> — <short feature name>

**Master plan reference:** <section number + one-line motivation, e.g. "§4.1 foundation table; §11.2 row 1.7c">
**Context:** <2-3 sentences: what's the problem, why now, who asked for it>
**Estimated effort:** <~N min Builder time>
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

<numbered list of concrete deliverables>

## Architecture

<file tree or component diagram>

## Files

- \`<path>\` (NEW | extend | refactor) — <one-line purpose>

## Schema additions

\`\`\`sql
<DDL if any; omit if no schema change>
\`\`\`

## Success criteria

- \`npm run build\` clean
- <user-visible behavior 1>
- <user-visible behavior 2>
- <test that proves it>

## Risks + mitigations

- **Risk:** <risk>. **Mitigation:** <mitigation>.

## NEVER list

- Never <thing 1>.
- Never <thing 2>.
`
