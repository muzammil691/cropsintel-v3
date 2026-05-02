// Deterministic structural-section injector. Acts as a safety net when Council is
// unavailable (404) and Claude's fallback draft drops one or more required spec
// sections. The injector detects each missing section by header pattern and
// inserts a content-aware placeholder so the structural validator can pass.
//
// Hard rules:
//   * No LLM / external calls — pure string transformation, deterministic.
//   * Never duplicates a section that already exists.
//   * Header levels and exact section names match spec-template.REQUIRED_SECTIONS.
//   * Phase X.Y heading is prepended; all other missing sections are appended.
//
// Used by spec-draft.ts after the Council-fallback Claude draft, before the
// structural validator runs.

import { validate } from './spec-template'

export interface InjectionResult {
  markdown: string
  injected: string[]
}

interface InjectorRule {
  // Display name (matches REQUIRED_SECTIONS[i].name in spec-template.ts).
  name: string
  // Detects whether the section is already present.
  present: (md: string) => boolean
  // Returns the new markdown with the placeholder inserted.
  inject: (md: string, ctx: { phase: string }) => string
}

const PLACEHOLDER_NOTE =
  '<!-- auto-injected by section-injector — Council was unavailable; please review and refine before merge -->'

// Append a section to the end of the markdown, separated by a blank line.
function appendSection(md: string, body: string): string {
  const trimmed = md.replace(/\s+$/, '')
  return `${trimmed}\n\n${body}\n`
}

// Insert a header-level metadata line (e.g. **Master plan reference:**) directly
// after the first `# Task:` heading if one exists, otherwise prepend it.
function insertMetadataLine(md: string, line: string): string {
  const headingRe = /^(#\s+Task:[^\n]*\n)/im
  const m = md.match(headingRe)
  if (!m) return `${line}\n\n${md}`
  const idx = m.index! + m[0].length
  return `${md.slice(0, idx)}\n${line}\n${md.slice(idx)}`
}

const RULES: InjectorRule[] = [
  // 1. # Task: Phase X.Y heading — prepended if absent.
  {
    name: '# Task: Phase X.Y heading',
    present: md => /^#\s+Task:\s+Phase\s+\d+\.\d+[a-z0-9]*\s+[—\-]/im.test(md),
    inject: (md, { phase }) =>
      `# Task: Phase ${phase} — Auto-injected fallback spec ${PLACEHOLDER_NOTE}\n\n${md.replace(/^\s+/, '')}`,
  },
  // 2. **Master plan reference:** metadata line.
  {
    name: '**Master plan reference:** line',
    present: md => /\*\*Master plan reference:\*\*/i.test(md),
    inject: md =>
      insertMetadataLine(
        md,
        `**Master plan reference:** TBD ${PLACEHOLDER_NOTE} — confirm against master-plan section before merge.`,
      ),
  },
  // 3. **Estimated effort:** metadata line.
  {
    name: '**Estimated effort:** line',
    present: md => /\*\*Estimated effort:\*\*/i.test(md),
    inject: md =>
      insertMetadataLine(md, `**Estimated effort:** ~30 min Builder time ${PLACEHOLDER_NOTE}`),
  },
  // 4. **Model:** metadata line.
  {
    name: '**Model:** line',
    present: md => /\*\*Model:\*\*/i.test(md),
    inject: md => insertMetadataLine(md, `**Model:** claude-opus-4-7 ${PLACEHOLDER_NOTE}`),
  },
  // 5. model: frontmatter line (lowercase, separate from **Model:** display line).
  {
    name: 'model: frontmatter',
    present: md => /^model:\s*\S+/im.test(md),
    inject: md => insertMetadataLine(md, `model: claude-opus-4-7`),
  },
  // 6. ## Goal section.
  {
    name: '## Goal',
    present: md => /^##\s+Goal\b/im.test(md),
    inject: md =>
      appendSection(
        md,
        `## Goal\n\n${PLACEHOLDER_NOTE}\n\n- Restate the deliverables here. Council was unavailable when this draft was produced; refine before queueing.`,
      ),
  },
  // 7. ## Files OR ## Architecture — only inject Files if neither is present.
  {
    name: '## Files or ## Architecture',
    present: md => /^##\s+(Files|Architecture)\b/im.test(md),
    inject: md =>
      appendSection(
        md,
        `## Files\n\n${PLACEHOLDER_NOTE}\n\n- \`<path>\` (NEW | extend) — <one-line purpose>`,
      ),
  },
  // 8. ## Success criteria — required by task spec.
  {
    name: '## Success criteria',
    present: md => /^##\s+Success criteria\b/im.test(md),
    inject: md =>
      appendSection(
        md,
        `## Success criteria\n\n${PLACEHOLDER_NOTE}\n\n- \`npm run build\` clean\n- <user-visible behavior 1>\n- <test that proves it>`,
      ),
  },
  // 9. ## Risks + mitigations — required by task spec.
  {
    name: '## Risks + mitigations',
    present: md => /^##\s+Risks\s*\+\s*mitigations\b/im.test(md),
    inject: md =>
      appendSection(
        md,
        `## Risks + mitigations\n\n${PLACEHOLDER_NOTE}\n\n- **Risk:** Council was unavailable, so draft may have gaps. **Mitigation:** review the spec carefully before queueing; refine ambiguous items.`,
      ),
  },
  // 10. ## NEVER list — required by task spec.
  {
    name: '## NEVER list',
    present: md => /^##\s+NEVER list\b/im.test(md),
    inject: md =>
      appendSection(
        md,
        `## NEVER list\n\n${PLACEHOLDER_NOTE}\n\n- Never violate master plan §11.6 invariants.\n- Never ship without verifying \`npm run build\` is clean.`,
      ),
  },
]

// Detects which required sections are missing and injects placeholders for each.
// Pure: same input always yields the same output. Never duplicates an existing
// section. Phase argument is used only for the heading injection placeholder.
export function injectMissingSections(markdown: string, phase: string): InjectionResult {
  const injected: string[] = []
  let md = markdown ?? ''
  const ctx = { phase }
  for (const rule of RULES) {
    if (!rule.present(md)) {
      md = rule.inject(md, ctx)
      injected.push(rule.name)
    }
  }
  return { markdown: md, injected }
}

// Convenience helper: inject + validate in one call.
export function injectAndValidate(markdown: string, phase: string) {
  const { markdown: md, injected } = injectMissingSections(markdown, phase)
  const validation = validate(md)
  return { markdown: md, injected, validation }
}
