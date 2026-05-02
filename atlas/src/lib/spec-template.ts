// Spec template + validator. Atlas drafts CropsIntel V3 task specs whose shape Builder
// can pick up and run. The validator enforces structural rigor; missing sections cause
// the draft pipeline to retry with the gap list as additional context.

export interface ValidationResult {
  ok: boolean
  missing: string[]
  // Verbatim, header-exact strings naming each missing section so callers can
  // surface a precise diagnostic instead of a generic "validation failed".
  errors: string[]
}

interface SectionCheck {
  name: string
  pattern: RegExp
  // Header text the validator expects to see literally — quoted in error
  // messages so the failure clearly names what to add.
  expected: string
}

const REQUIRED_SECTIONS: SectionCheck[] = [
  { name: '# Task: Phase X.Y heading', pattern: /^#\s+Task:\s+Phase\s+\d+\.\d+[a-z0-9]*\s+[—\-]/im, expected: '# Task: Phase <X.Y> — <name>' },
  { name: '**Master plan reference:** line', pattern: /\*\*Master plan reference:\*\*/i, expected: '**Master plan reference:**' },
  { name: '**Estimated effort:** line', pattern: /\*\*Estimated effort:\*\*/i, expected: '**Estimated effort:**' },
  { name: '**Model:** line', pattern: /\*\*Model:\*\*/i, expected: '**Model:**' },
  { name: 'model: frontmatter', pattern: /^model:\s*\S+/im, expected: 'model: <model-id>' },
  { name: '## Goal', pattern: /^##\s+Goal\b/im, expected: '## Goal' },
  { name: '## Files or ## Architecture', pattern: /^##\s+(Files|Architecture)\b/im, expected: '## Files (or ## Architecture)' },
  { name: '## Success criteria', pattern: /^##\s+Success criteria\b/im, expected: '## Success criteria' },
  { name: '## Risks + mitigations', pattern: /^##\s+Risks\s*\+\s*mitigations\b/im, expected: '## Risks + mitigations' },
  { name: '## NEVER list', pattern: /^##\s+NEVER list\b/im, expected: '## NEVER list' },
]

export function validate(markdown: string): ValidationResult {
  const missing: string[] = []
  const errors: string[] = []
  for (const check of REQUIRED_SECTIONS) {
    if (!check.pattern.test(markdown)) {
      missing.push(check.name)
      errors.push(
        `Missing required section: ${check.name} — spec must contain a literal "${check.expected}" header/line.`,
      )
    }
  }
  return { ok: missing.length === 0, missing, errors }
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
