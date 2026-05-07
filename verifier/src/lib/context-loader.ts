import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { TaskSpec } from '../types'

/**
 * Bug I fix — prioritized file loading for AI judge context.
 *
 * Previously buildShippedCodeSummary() truncated every file to 3KB. Files the
 * spec explicitly named got cut mid-function, causing judges to report
 * "missing implementation" on code that was actually present in the repo.
 *
 * New strategy:
 *   1. Files in spec.filesRequired = "critical" → loaded WHOLE up to ~96KB total.
 *   2. Files in additionalDiffPaths = "secondary" → truncated to 5KB each, ~19KB total.
 *   3. If critical files won't fit, drop the largest secondary files entirely
 *      and emit a `[FILE OMITTED — too long]` marker rather than truncate
 *      critical files mid-function.
 *
 * Total budget assumes ~150KB of context for o3 / Gemini 2.5 Pro after spec
 * markdown (~10-30KB) is accounted for.
 */

// 1.10af §7 — bumped to 180_000 chars (safe ceiling for claude-opus-4-7 at
// 200k tokens after spec markdown overhead). Files ≤ WHOLE_FILE_LINE_LIMIT are
// preferred for whole-load; longer files truncate by line with an explicit log.
const TOTAL_BUDGET_BYTES = 180_000
const CRITICAL_BUDGET_BYTES = Math.floor((TOTAL_BUDGET_BYTES - 30 * 1024) * 0.8) // ~120KB
const SECONDARY_BUDGET_BYTES = Math.floor((TOTAL_BUDGET_BYTES - 30 * 1024) * 0.2) // ~30KB
const SECONDARY_PER_FILE_CAP = 5 * 1024 // 5KB
const WHOLE_FILE_LINE_LIMIT = 2000

export interface LoaderDecision {
  filePath: string
  outcome: 'full' | 'truncated' | 'omitted' | 'missing' | 'error'
  bytesLoaded: number
  bytesTotal: number
}

export interface LoaderResult {
  contextString: string
  decisions: LoaderDecision[]
}

interface LoadOptions {
  spec: TaskSpec
  repoRoot: string
  /**
   * Additional files (e.g. from a diff) that aren't named in the spec but
   * provide useful context. Truncated more aggressively than spec files.
   */
  additionalDiffPaths?: string[]
}

function safeReadFile(fullPath: string): { content: string; size: number } | null {
  try {
    if (!existsSync(fullPath)) return null
    const size = statSync(fullPath).size
    const content = readFileSync(fullPath, 'utf-8')
    return { content, size }
  } catch {
    return null
  }
}

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`
}

function logDecisions(decisions: LoaderDecision[]): void {
  const full = decisions
    .filter(d => d.outcome === 'full')
    .map(d => `full: ${d.filePath} (${formatKB(d.bytesLoaded)})`)
  const truncated = decisions
    .filter(d => d.outcome === 'truncated')
    .map(d => `truncated: ${d.filePath} (${formatKB(d.bytesLoaded)} of ${formatKB(d.bytesTotal)})`)
  const omitted = decisions
    .filter(d => d.outcome === 'omitted')
    .map(d => `omitted: ${d.filePath} (${formatKB(d.bytesTotal)})`)
  const missing = decisions
    .filter(d => d.outcome === 'missing' || d.outcome === 'error')
    .map(d => `${d.outcome}: ${d.filePath}`)

  const parts: string[] = []
  if (full.length) parts.push(full.join(', '))
  if (truncated.length) parts.push(truncated.join(', '))
  if (omitted.length) parts.push(omitted.join(', '))
  if (missing.length) parts.push(missing.join(', '))

  if (parts.length) {
    console.log(`[ctx-loader] ${parts.join('; ')}`)
  }
}

/**
 * Build a prioritized context string for AI judges:
 *   - Critical files (spec.filesRequired) loaded WHOLE
 *   - Secondary files (additionalDiffPaths) truncated to 5KB each
 *   - If critical budget overflows, omit secondary files first; only as a last
 *     resort drop the largest critical files (with [FILE OMITTED] marker).
 */
export function loadShippedCodeContext(opts: LoadOptions): LoaderResult {
  const { spec, repoRoot, additionalDiffPaths = [] } = opts
  const decisions: LoaderDecision[] = []
  const parts: string[] = []

  let criticalUsed = 0

  // ── Phase 1: critical files (spec.filesRequired) ──────────────────────────
  // Load whole. If a single file is bigger than the entire critical budget,
  // omit it rather than partially truncate (the judge will see [FILE OMITTED]
  // and treat it as "verifier had no view").
  const criticalReads: Array<{ filePath: string; content: string; size: number }> = []
  for (const filePath of spec.filesRequired) {
    const fullPath = join(repoRoot, filePath)
    const read = safeReadFile(fullPath)
    if (!read) {
      decisions.push({ filePath, outcome: 'missing', bytesLoaded: 0, bytesTotal: 0 })
      parts.push(`=== ${filePath} ===\n[FILE MISSING]`)
      continue
    }
    criticalReads.push({ filePath, content: read.content, size: read.size })
  }

  for (const { filePath, content, size } of criticalReads) {
    const lineCount = content.split('\n').length

    // 1.10af §7 — files with ≤ 2000 lines are loaded whole when budget permits.
    // Beyond that, or when the budget would overflow, truncate by line (keep
    // the head — most spec-relevant code is at the top of a file) and emit an
    // explicit log entry so judges can see what they're missing.
    const fitsWhole = criticalUsed + size <= CRITICAL_BUDGET_BYTES
    if (lineCount <= WHOLE_FILE_LINE_LIMIT && fitsWhole) {
      criticalUsed += size
      decisions.push({ filePath, outcome: 'full', bytesLoaded: size, bytesTotal: size })
      parts.push(`=== ${filePath} ===\n${content}`)
      continue
    }

    const remaining = Math.max(0, CRITICAL_BUDGET_BYTES - criticalUsed)
    if (remaining < 1024 && criticalReads.length > 1) {
      // Budget effectively exhausted — omit rather than emit a token-sized
      // sliver; judge sees [FILE OMITTED] and knows verifier had no view.
      decisions.push({ filePath, outcome: 'omitted', bytesLoaded: 0, bytesTotal: size })
      parts.push(`=== ${filePath} ===\n[FILE OMITTED — too long for context budget (${formatKB(size)})]`)
      continue
    }

    // Truncate by line. Greedy: keep adding head lines until we'd exceed the
    // remaining budget. The judge sees the head + a truncation marker.
    const lines = content.split('\n')
    let used = 0
    let kept = 0
    const keptLines: string[] = []
    for (const line of lines) {
      const lineSize = line.length + 1 // +1 for the newline
      if (used + lineSize > remaining) break
      keptLines.push(line)
      used += lineSize
      kept++
    }
    const truncatedContent = keptLines.join('\n') +
      `\n\n[... truncated, kept ${kept} of ${lineCount} lines (${formatKB(used)} of ${formatKB(size)}) ...]`
    criticalUsed += used
    decisions.push({ filePath, outcome: 'truncated', bytesLoaded: used, bytesTotal: size })
    parts.push(`=== ${filePath} ===\n${truncatedContent}`)
    console.log(
      `[verifier-context] truncated ${filePath} (${lineCount} → ${kept} lines) to fit model context`,
    )
  }

  // ── Phase 2: secondary files (diff context) ──────────────────────────────
  let secondaryUsed = 0
  for (const filePath of additionalDiffPaths) {
    if (spec.filesRequired.includes(filePath)) continue // already loaded as critical
    if (secondaryUsed >= SECONDARY_BUDGET_BYTES) {
      const fullPath = join(repoRoot, filePath)
      const size = existsSync(fullPath) ? statSync(fullPath).size : 0
      decisions.push({ filePath, outcome: 'omitted', bytesLoaded: 0, bytesTotal: size })
      parts.push(`=== ${filePath} ===\n[FILE OMITTED — secondary budget exhausted]`)
      continue
    }

    const fullPath = join(repoRoot, filePath)
    const read = safeReadFile(fullPath)
    if (!read) {
      decisions.push({ filePath, outcome: 'missing', bytesLoaded: 0, bytesTotal: 0 })
      continue
    }

    if (read.size <= SECONDARY_PER_FILE_CAP) {
      secondaryUsed += read.size
      decisions.push({ filePath, outcome: 'full', bytesLoaded: read.size, bytesTotal: read.size })
      parts.push(`=== ${filePath} ===\n${read.content}`)
    } else {
      const slice = read.content.slice(0, SECONDARY_PER_FILE_CAP)
      secondaryUsed += SECONDARY_PER_FILE_CAP
      decisions.push({
        filePath,
        outcome: 'truncated',
        bytesLoaded: SECONDARY_PER_FILE_CAP,
        bytesTotal: read.size,
      })
      parts.push(
        `=== ${filePath} ===\n${slice}\n...(truncated, ${formatKB(read.size - SECONDARY_PER_FILE_CAP)} more)`,
      )
    }
  }

  logDecisions(decisions)

  return {
    contextString: parts.join('\n\n'),
    decisions,
  }
}
