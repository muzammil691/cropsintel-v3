// Workshop pre-flight — refuses to queue a task spec when its body has no
// `filesRequired` and the frontmatter does not declare the `audit-only: true`
// escape hatch.
//
// Diagnosed in `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
// §3.1: a title-only spec deterministically fails the Verifier's
// `empty-diff-guard` check (three attempts in a row). This module catches
// the upstream contract gap at queue-out time so the Verifier never sees it.
//
// Contract:
//   • Reads a candidate spec from disk via `specPath` (or from an in-memory
//     body via `validateQueueCandidateBody`).
//   • Parses the YAML frontmatter (via `lib/frontmatter.parseSpec`).
//   • Re-runs the same path-extraction logic the Verifier's `parseTaskSpec`
//     uses, so authoring expectations match downstream validation.
//   • If filesRequired is empty AND frontmatter does NOT carry
//     `audit-only: true`, the validator returns `{ ok: false }` and (by
//     default) writes a stub `.agent/questions/<task-id>-q.md` so a human
//     reviews the spec — per the system prompt §6 question contract.
//
// Wiring: `atlas/src/lib/tools.ts:builderQueueSpec` and `builderQueueSpecsBatch`
// call `validateQueueCandidateBody` before writing the spec into
// `.agent/tasks/queued/`. A refusal short-circuits the queue write and the
// stub question file is left for a human to triage.
//
// ─── Quoted from V3-CODING-INSTRUCTIONS.md §8 ("Spec frontmatter flags") ───
// When Atlas drafts a task spec into `.agent/tasks/queued/`, the Workshop
// pre-flight (`atlas/src/workshop/queue-validator.ts`) refuses to queue it
// if the body has no concrete `Files required` paths AND the frontmatter
// does not declare the `audit-only` escape hatch.
//
// `audit-only: true` — Use this flag, and ONLY this flag, when the spec's
// deliverable is a markdown ADR rather than a code diff. Examples:
// cluster-investigation specs that produce `docs/atlas-decisions/ADR-*.md`,
// foundation audit write-ups, or post-incident reviews where no
// `src/`/`supabase/`/`atlas/` files are touched.
//
//   ```yaml
//   ---
//   priority: 2
//   audit-only: true
//   ---
//   # Task: investigate cluster 7da23cc3f830
//   ```
//
// Do NOT use `audit-only: true` to bypass the gate for a real coding task
// whose Files required block was simply left empty by mistake — that
// defeats the purpose. If you find yourself reaching for `audit-only` to
// silence the pre-flight, the right move is almost always to add a
// concrete `## Files required` block to the spec body.
// ─── End quoted block ─────────────────────────────────────────────────────

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseSpec } from '../lib/frontmatter'

/**
 * Verbatim documentation of the `audit-only: true` frontmatter flag, mirrored
 * from `V3-CODING-INSTRUCTIONS.md` §8. Kept here so any reader (human or AI
 * verifier) inspecting `queue-validator.ts` has the contract in front of them.
 * If the canonical doc and this constant ever drift, the canonical doc wins.
 */
export const AUDIT_ONLY_DOCS = `\
audit-only: true — escape hatch for investigation-style specs.

Use this flag, and ONLY this flag, when the spec's deliverable is a
markdown ADR rather than a code diff. Examples:
  • cluster-investigation specs that produce docs/atlas-decisions/ADR-*.md
  • foundation audit write-ups
  • post-incident reviews where no src/, supabase/, or atlas/ files are touched

Frontmatter:
  ---
  priority: 2
  audit-only: true
  ---

Do NOT use audit-only: true to bypass the gate for a real coding task
whose Files required block was simply left empty by mistake — that
defeats the purpose. If you find yourself reaching for audit-only to
silence the pre-flight, the right move is almost always to add a
concrete "## Files required" block to the spec body.

On refusal, the pre-flight writes a stub .agent/questions/<task-id>-q.md
and stops, so a human reviews the spec before queue-out (per the system
prompt §6 question contract).`

const FILE_EXT_RE = /\.(ts|tsx|js|jsx|json|sql|md|sh|yaml|yml|html|css)$/
const DELETE_SECTION_RE = /delete|remove|uninstall|clean\s*slate|clean-slate|clean_slate/i
// Placeholder/template paths that mustn't be counted as concrete required files.
const PLACEHOLDER_PATTERN_RE = /xxxxxx|<[^>]+>|phase-X\.YY|remediation-NNN|YYYY-MM-DD|[*?]/

function normalizePath(p: string): string {
  return p
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/^cropsintel-v3\//, '')
}

function isPlaceholderPath(p: string): boolean {
  return PLACEHOLDER_PATTERN_RE.test(p)
}

function isQuestionFilePath(p: string): boolean {
  return normalizePath(p).startsWith('.agent/questions/')
}

function splitIntoSections(markdown: string): Array<{ header: string; body: string }> {
  const sections: Array<{ header: string; body: string }> = []
  const parts = markdown.split(/\n(?=##\s)/)
  for (const part of parts) {
    const lines = part.split('\n')
    sections.push({ header: lines[0] ?? '', body: lines.slice(1).join('\n') })
  }
  return sections
}

function extractFilePathsFromText(text: string): Set<string> {
  const filteredText = text
    .split('\n')
    .filter(line => !/\(optional\)/i.test(line))
    .join('\n')

  const paths = new Set<string>()
  let m: RegExpExecArray | null

  // `src/pages/Auth.tsx` in inline code
  const backtickRe = /`([^`\s]+)`/g
  while ((m = backtickRe.exec(filteredText)) !== null) {
    const c = m[1].trim()
    if (FILE_EXT_RE.test(c) && c.includes('/') && !c.includes(' ') && !c.includes('..')) {
      paths.add(c)
    }
  }

  // Table cell: | src/pages/Auth.tsx |
  const tableCellRe = /\|\s*([a-zA-Z0-9._\-/]+\.[a-z]+)\s*[|]/g
  while ((m = tableCellRe.exec(filteredText)) !== null) {
    const c = m[1].trim()
    if (FILE_EXT_RE.test(c) && c.includes('/')) paths.add(c)
  }

  // Bullet path: - src/pages/Auth.tsx
  const bulletRe = /^[\t ]*[-*]\s+`?((?:src|supabase|agent|verifier|adela|atlas)\/[a-zA-Z0-9._\-/]+\.[a-z]+)`?/gm
  while ((m = bulletRe.exec(filteredText)) !== null) {
    paths.add(m[1].trim())
  }

  return paths
}

/**
 * Extract the concrete file paths a spec body claims to touch. Mirrors the
 * extraction used by `verifier/src/lib/spec-parser.parseTaskSpec` so the
 * Workshop's pre-flight agrees with the downstream Verifier on what counts
 * as a "required file".
 */
export function extractFilesRequired(body: string): string[] {
  const sections = splitIntoSections(body)
  const required = new Set<string>()
  const deleted = new Set<string>()

  for (const section of sections) {
    const isDeleteSection = DELETE_SECTION_RE.test(section.header)
    const paths = extractFilePathsFromText(section.body)
    for (const p of paths) {
      if (isDeleteSection) deleted.add(p)
      else required.add(p)
    }
  }

  for (const p of deleted) required.delete(p)

  const normalized = new Set(
    Array.from(required)
      .filter(p => !p.startsWith('//') && p.split('/').length >= 2)
      .map(normalizePath)
      .filter(p => !isPlaceholderPath(p))
      .filter(p => !isQuestionFilePath(p)),
  )
  return Array.from(normalized)
}

export interface QueueValidationOk {
  ok: true
  taskId: string
  filesRequired: string[]
  auditOnly: boolean
}

export interface QueueValidationRefusal {
  ok: false
  taskId: string
  reason: string
  questionFilePath: string
  questionStub: string
}

export type QueueValidationResult = QueueValidationOk | QueueValidationRefusal

export interface ValidateQueueCandidateOptions {
  /**
   * Directory the question-file stub is written to on refusal. Defaults to
   * `<repo>/.agent/questions/` (resolved relative to specPath, assuming the
   * spec lives at `<repo>/.agent/tasks/<bucket>/<id>.md`).
   */
  questionsDir?: string
  /**
   * If false, refusal returns the stub but does NOT write it to disk. Useful
   * for unit tests and dry-runs. Defaults to true.
   */
  writeQuestion?: boolean
}

function defaultQuestionsDir(specPath: string): string {
  // .agent/tasks/<bucket>/<id>.md → .agent/questions/
  return path.resolve(path.dirname(specPath), '..', '..', 'questions')
}

function buildQuestionStub(taskId: string): string {
  return `# Question — ${taskId}

**Blocking:** Spec body has no \`filesRequired\` and frontmatter is missing \`audit-only: true\`.

**Context:**
Workshop pre-flight \`validateQueueCandidate\` refused to queue this spec
because \`parseTaskSpec(body).filesRequired\` returned an empty array, and
the frontmatter did not carry the \`audit-only: true\` escape hatch.

A title-only spec deterministically fails the Verifier's \`empty-diff-guard\`
check — see \`docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md\` §3.1.

**Options I'm considering:**
1. Re-draft the spec with a concrete \`## Files required\` block listing the
   paths that will be touched — pros: closes the authoring gap; cons:
   requires a new draft.
2. Add \`audit-only: true\` to the frontmatter — pros: investigation-style
   specs (cluster ADRs, audit reports) skip the gate cleanly; cons: only
   valid when the deliverable is markdown (an ADR), not code.

**Recommendation:** Option 1 unless this is a pure investigation/ADR task,
in which case Option 2.

**Master plan reference:** §11.2 (Phase 1 scope); \`V3-CODING-INSTRUCTIONS.md\`
section on the \`audit-only\` frontmatter flag.
`
}

export interface ValidateQueueCandidateBodyOptions extends ValidateQueueCandidateOptions {
  /**
   * Required when calling the body-based variant: where the stub question
   * file should be written on refusal. The path-based `validateQueueCandidate`
   * resolves this automatically from `specPath`; in-memory callers must
   * supply it explicitly.
   */
  questionsDir: string
}

/**
 * Body-based variant. Used by `atlas/src/lib/tools.ts:builderQueueSpec` and
 * `builderQueueSpecsBatch` to gate the queue write BEFORE the spec is ever
 * persisted to `.agent/tasks/queued/`. Pure function — does no disk I/O
 * unless `writeQuestion: true` (default) and validation refuses.
 */
export function validateQueueCandidateBody(
  taskId: string,
  content: string,
  options: ValidateQueueCandidateBodyOptions,
): QueueValidationResult {
  const writeQuestion = options.writeQuestion ?? true
  const parsed = parseSpec(content)
  const auditOnlyRaw = parsed.frontmatter.extra?.['audit-only']
  const auditOnly = auditOnlyRaw === 'true' || auditOnlyRaw === 'yes' || auditOnlyRaw === '1'
  const filesRequired = extractFilesRequired(parsed.body)

  if (filesRequired.length > 0 || auditOnly) {
    return { ok: true, taskId, filesRequired, auditOnly }
  }

  const questionFilePath = path.join(options.questionsDir, `${taskId}-q.md`)
  const questionStub = buildQuestionStub(taskId)

  if (writeQuestion) {
    fs.mkdirSync(options.questionsDir, { recursive: true })
    fs.writeFileSync(questionFilePath, questionStub, 'utf-8')
  }

  return {
    ok: false,
    taskId,
    reason:
      'spec body has no filesRequired and frontmatter does not declare audit-only: true',
    questionFilePath,
    questionStub,
  }
}

/**
 * Pre-flight a candidate task spec before it is moved into
 * `.agent/tasks/queued/`. See module-level comment for the contract.
 */
export function validateQueueCandidate(
  specPath: string,
  options: ValidateQueueCandidateOptions = {},
): QueueValidationResult {
  const content = fs.readFileSync(specPath, 'utf-8')
  const taskId = path.basename(specPath, '.md')
  return validateQueueCandidateBody(taskId, content, {
    ...options,
    questionsDir: options.questionsDir ?? defaultQuestionsDir(specPath),
  })
}
