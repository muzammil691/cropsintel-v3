// Phase 1.10al — Generate self-contained prompts for the "claude-code" bucket.
//
// When the diagnoser concludes that a fix needs source-file edits Atlas can't
// perform (Atlas runs sandboxed, no write access to src/), we hand the user a
// prompt they can paste directly into Claude Code. The prompt embeds every
// affected file inline (truncated to 3KB each), redacts secrets, includes the
// HEAD sha so the user knows what the diagnosis was based on, and lays out a
// clear WHAT TO DO + CONSTRAINTS section.

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
const FILE_TRUNCATE_BYTES = 3 * 1024

// Lines containing any of these patterns get redacted. We are very aggressive
// here — false positives are fine; leaking a key into a paste-able prompt is
// not.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9_-]{16,}\b/,
  /\bxox[abprs]-[a-zA-Z0-9-]+/,
  /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"`]?[a-zA-Z0-9_\-./+=]{12,}/i,
  /^.*(?:VITE_)?(?:ANTHROPIC|OPENAI|GEMINI|ELEVENLABS|SUPABASE)[_A-Z]*KEY\s*[:=]/i,
  /\bBearer\s+[a-zA-Z0-9_\-./+=]{16,}/,
]

function redactSecrets(content: string, filename: string): string {
  // Refuse env files outright.
  if (/\.env(\..+)?$/.test(filename) || filename.endsWith('.env')) {
    return '[REDACTED — env file contents withheld from generated prompt]'
  }
  return content
    .split('\n')
    .map(line => (SECRET_PATTERNS.some(p => p.test(line)) ? '[REDACTED LINE — possible secret]' : line))
    .join('\n')
}

// Fall back to a fuzzy basename lookup when the audit data hands us a path
// that doesn't exist literally. AI judges sometimes hallucinate intermediate
// directories (e.g. drop `tabs/` from `src/components/atlas/tabs/AtlasPlanTab.tsx`).
// Using `git ls-files` keeps us inside the tracked tree only, so we never
// accidentally embed node_modules or build output.
async function findFileByBasename(relPath: string): Promise<string | null> {
  const basename = relPath.split('/').pop() ?? relPath
  if (!basename || basename.length < 3) return null
  try {
    const { stdout } = await execFileP('git', ['ls-files'], { cwd: REPO_ROOT })
    const candidates = stdout
      .split('\n')
      .filter(p => p.endsWith('/' + basename) || p === basename)
    if (candidates.length === 0) return null
    // Prefer the candidate whose path overlaps the most with the requested
    // relPath (so e.g. components/atlas/tabs/AtlasPlanTab.tsx beats
    // legacy/components/AtlasPlanTab.tsx if both existed).
    candidates.sort((a, b) => overlapScore(b, relPath) - overlapScore(a, relPath))
    return candidates[0]
  } catch {
    return null
  }
}

function overlapScore(candidate: string, requested: string): number {
  const cs = candidate.split('/')
  const rs = requested.split('/')
  let i = cs.length - 1
  let j = rs.length - 1
  let score = 0
  while (i >= 0 && j >= 0 && cs[i] === rs[j]) {
    score++
    i--
    j--
  }
  return score
}

async function readAffectedFile(relPath: string): Promise<string> {
  const directPath = resolve(REPO_ROOT, relPath)
  let buf: string
  let resolvedPath = relPath
  try {
    buf = await readFile(directPath, 'utf-8')
  } catch {
    // Direct read failed — try basename fallback so judges with slightly
    // wrong paths still produce a useful prompt.
    const fuzzy = await findFileByBasename(relPath)
    if (!fuzzy) {
      return `[error reading file: not found at ${relPath} or by basename in tracked tree]`
    }
    try {
      buf = await readFile(resolve(REPO_ROOT, fuzzy), 'utf-8')
      resolvedPath = fuzzy
    } catch (err2) {
      return `[error reading file: ${err2 instanceof Error ? err2.message : String(err2)}]`
    }
  }
  const truncated =
    buf.length > FILE_TRUNCATE_BYTES
      ? buf.slice(0, FILE_TRUNCATE_BYTES) + `\n\n[... truncated, file is ${buf.length} bytes total ...]`
      : buf
  const noteHeader =
    resolvedPath !== relPath
      ? `[note: requested path "${relPath}" not found; resolved to "${resolvedPath}" by basename match]\n\n`
      : ''
  return noteHeader + redactSecrets(truncated, resolvedPath)
}

async function gitHead(): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
    return stdout.trim()
  } catch {
    return 'unknown'
  }
}

export interface ClaudeCodePromptInput {
  problem: string
  affectedFiles: string[]              // repo-relative paths
  evidence: string                     // pretty-printed gap details, etc.
  taskId?: string
  commitMessage?: string               // suggested commit message
}

export async function buildClaudeCodePrompt(input: ClaudeCodePromptInput): Promise<string> {
  const head = await gitHead()
  const headShort = head.slice(0, 8)
  const taskLabel = input.taskId ?? 'unknown-task'
  const commitMsg =
    input.commitMessage ?? `fix(atlas-pd): designer audit follow-up — ${taskLabel}`

  const fileSections: string[] = []
  for (const f of input.affectedFiles) {
    const body = await readAffectedFile(f)
    fileSections.push(`### ${f}\n\n\`\`\`\n${body}\n\`\`\``)
  }

  return `You are working on cropsintel-v3 (TypeScript + React + Vite + Supabase).

This prompt was generated by Atlas at HEAD ${headShort}. If your local repo is on a different sha you may need to git pull before applying.

---

## PROBLEM

${input.problem}

## AFFECTED FILES (read these first)

${input.affectedFiles.map(f => `- ${f}`).join('\n') || '(none listed)'}

## EVIDENCE

${input.evidence}

## FILE CONTENTS

${fileSections.join('\n\n')}

## WHAT TO DO

1. Read the affected files completely.
2. Apply the changes per the evidence — each gap has a \`fix\` or \`remediation\` field; honor it.
3. Run \`npm run build\` and fix any TypeScript errors.
4. Commit with: \`${commitMsg}\`
5. Push to main. CI will trigger redeploys; Designer will re-audit automatically.

## CONSTRAINTS

- Use only shadcn/ui components, lucide-react icons, and Tailwind classes already in use elsewhere in this repo.
- Do not modify any file outside the AFFECTED FILES list.
- Do not add new npm packages.
- Do not add comments, console.logs, or unnecessary refactoring beyond what the gap describes.
- If you discover the gap description is wrong or impossible, write \`.agent/questions/${taskLabel}-q.md\` with a clear question and stop. Do not silently improvise.
`
}
