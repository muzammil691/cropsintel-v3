// 1.10bd-queue-pivot Step 3a — deterministic workshop-diff op application.
//
// Pure-function op handlers for the four workshop-diff op kinds. Takes the
// current master-plan.md markdown + an array of ops, returns the new
// markdown + per-op applied/skipped accounting. No AI roundtrip. No file
// I/O. No git. The /queue handler in Step 3b wraps these in the atomic
// write + commit + push flow.
//
// Section model — flat-slice interpretation:
//   A "phase section" runs from its header line through the line BEFORE the
//   next phase header (regardless of depth), or EOF if last. This means
//   conceptual sub-phases (e.g. 1.3a under 1.3) are SIBLING SLICES in
//   document order, not nested. This is the model that lets edit/remove/
//   reorder operate on each phase as a self-contained span without
//   touching neighbours.
//
// Phase-id matching — exact-string only:
//   The regex captures the dotted id up to the next non-id character. We
//   then compare captured ids to op.phase_id with === . "1.3" does NOT
//   match the header for "1.3a"; "1.3a" does NOT match "1.3a-FOO". This is
//   the load-bearing correctness guarantee for the sub-letter pattern
//   (1.3 / 1.3a / 1.3b / 1.3c / 1.3d / 1.4) where a loose match would
//   corrupt the tree.
//
// Out of scope here:
//   - Disk reads/writes (Step 3b does them via writePlanMarkdown).
//   - git commit + push + rollback (Step 3b).
//   - atlas_queue_operations logging (Step 3b).

// ─── Op shape ──────────────────────────────────────────────────────────

export type PlanDiffOp =
  | { op: 'add'; phase_id: string; parent_id?: string | null; title?: string; body?: string; launch_tier?: string }
  | { op: 'edit'; phase_id: string; title?: string; body?: string; launch_tier?: string }
  | { op: 'remove'; phase_id: string; reason?: string }
  | { op: 'reorder'; parent_id: string | null; ordered_phase_ids: string[] }

// Per-op accounting that the /queue handler logs into atlas_queue_operations.meta_json.
export interface OpVerdict {
  op: PlanDiffOp
  applied: boolean
  reason?: string
}

export interface ApplyOpsResult {
  markdown: string
  applied: OpVerdict[]
  skipped: OpVerdict[]
}

// ─── Phase-section parser ──────────────────────────────────────────────
//
// One regex, three forms tolerated:
//   ##  Phase 1.3d-DESIGNER-CREATE — Designer creates...   (depth 2, "Phase " prefix)
//   ### 1.3d-DESIGNER-CREATE Designer creates...           (depth 3, no prefix)
//   #### 1.3a Foo                                          (any depth 2-6)
//
// The /i flag makes the [a-z] character class match A-Z too, so IDs with
// upper-case suffixes (e.g. "-DESIGNER-CREATE") capture correctly. The
// trailing \b ensures "1.3" doesn't swallow part of "1.3a" or vice-versa.

const HEADER_RE = /^(#{2,6})\s+(?:Phase\s+)?([0-9]+(?:\.[0-9a-z-]+)*)\b/i

interface PhaseSection {
  /** Captured id, exact string from the header. */
  id: string
  /** Depth = count of '#' in the header. */
  depth: number
  /** 0-indexed line where the header sits. */
  startLine: number
  /** 0-indexed line ONE PAST the last line of this section's flat slice. */
  endLine: number
  /** Raw header line (preserved for edit-without-title and for round-tripping). */
  headerLine: string
}

function parsePhases(markdown: string): { lines: string[]; phases: PhaseSection[] } {
  const lines = markdown.split('\n')
  const phases: PhaseSection[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER_RE)
    if (!m) continue
    phases.push({
      id: m[2],
      depth: m[1].length,
      startLine: i,
      endLine: lines.length, // filled in below
      headerLine: lines[i],
    })
  }
  // Flat-slice closure: each phase ends one line before the next phase header.
  for (let i = 0; i < phases.length - 1; i++) {
    phases[i].endLine = phases[i + 1].startLine
  }
  // Last phase: ends at EOF (lines.length).
  return { lines, phases }
}

function findPhase(phases: PhaseSection[], phaseId: string): PhaseSection | undefined {
  return phases.find((p) => p.id === phaseId)
}

// ─── Header rendering ──────────────────────────────────────────────────

function buildHeader(opts: { depth: number; phaseId: string; title?: string; usePhasePrefix?: boolean }): string {
  const pounds = '#'.repeat(opts.depth)
  const prefix = opts.usePhasePrefix ? 'Phase ' : ''
  const title = opts.title?.trim() ?? ''
  return title.length > 0
    ? `${pounds} ${prefix}${opts.phaseId} — ${title}`
    : `${pounds} ${prefix}${opts.phaseId}`
}

function renderPhaseSection(opts: {
  depth: number
  phaseId: string
  title?: string
  body?: string
  launchTier?: string
  usePhasePrefix: boolean
}): string[] {
  const header = buildHeader({
    depth: opts.depth,
    phaseId: opts.phaseId,
    title: opts.title,
    usePhasePrefix: opts.usePhasePrefix,
  })
  const lines: string[] = [header, '']
  if (opts.launchTier) {
    lines.push(`_launch tier: ${opts.launchTier}_`, '')
  }
  if (opts.body && opts.body.trim().length > 0) {
    lines.push(opts.body.trim(), '')
  }
  return lines
}

// ─── Child detection ──────────────────────────────────────────────────
//
// A "child" of parent_id is any phase whose id is a conceptual sub-id of
// the parent. We accept two patterns common in this repo:
//   parent="1.3"     child="1.3a", "1.3b", ...   (sub-letter)
//   parent="1.3"     child="1.3.1", "1.3.2", ... (dotted)
// Children must come AFTER the parent in document order; phases with
// matching id prefix that appear before parent are not considered children.

function isChildId(parentId: string, candidateId: string): boolean {
  if (candidateId === parentId) return false
  if (candidateId.startsWith(parentId + '.')) return true
  // Sub-letter: parent="1.3", candidate="1.3a" — strip parent prefix and
  // check the next char is a letter (a-z, case-insensitive after the /i in
  // the regex; we lowercase for the check).
  if (candidateId.toLowerCase().startsWith(parentId.toLowerCase())) {
    const suffix = candidateId.slice(parentId.length)
    if (suffix.length > 0 && /^[a-z]/i.test(suffix)) return true
  }
  return false
}

function findChildrenOf(phases: PhaseSection[], parentId: string): PhaseSection[] {
  const parentIdx = phases.findIndex((p) => p.id === parentId)
  if (parentIdx < 0) return []
  const out: PhaseSection[] = []
  for (let i = parentIdx + 1; i < phases.length; i++) {
    if (isChildId(parentId, phases[i].id)) {
      out.push(phases[i])
    } else {
      // Hit a non-child phase — but a sibling of parent OR a deeper-non-
      // child phase may still be followed by more children if interleaving.
      // Conservative: keep scanning to catch e.g. parent="1.3" with
      // children "1.3a, 1.3b" interleaved with "1.4" — we DO want to find
      // "1.3a" even if it comes after "1.4". This is a corner case;
      // ordinary diffs won't hit it, but we don't want to bail prematurely.
      continue
    }
  }
  return out
}

// ─── Op handlers ──────────────────────────────────────────────────────

export function applyAddOp(
  markdown: string,
  op: Extract<PlanDiffOp, { op: 'add' }>,
): { markdown: string; verdict: OpVerdict } {
  const { lines, phases } = parsePhases(markdown)
  const existing = findPhase(phases, op.phase_id)
  if (existing) {
    return {
      markdown,
      verdict: { op, applied: false, reason: `phase ${op.phase_id} already exists at depth ${existing.depth}` },
    }
  }

  // Decide depth + insertion point.
  let depth = 2
  let usePhasePrefix = true
  let insertAfterLine = lines.length // append at EOF by default

  if (op.parent_id) {
    const parent = findPhase(phases, op.parent_id)
    if (!parent) {
      return {
        markdown,
        verdict: { op, applied: false, reason: `parent_id ${op.parent_id} not found` },
      }
    }
    depth = parent.depth + 1
    // Match the parent's prefix style: if parent header uses "Phase X", we do too.
    usePhasePrefix = /^#{2,6}\s+Phase\s+/i.test(parent.headerLine)
    // Insert after last child if any, else right after parent's body (i.e., at parent.endLine).
    const children = findChildrenOf(phases, op.parent_id)
    insertAfterLine = children.length > 0
      ? children[children.length - 1].endLine
      : parent.endLine
  }

  const newSection = renderPhaseSection({
    depth,
    phaseId: op.phase_id,
    title: op.title,
    body: op.body,
    launchTier: op.launch_tier,
    usePhasePrefix,
  })

  // Splice in. If insertAfterLine is mid-file, ensure a blank line before
  // the new header so markdown rendering doesn't run sections together.
  const before = lines.slice(0, insertAfterLine)
  const after = lines.slice(insertAfterLine)
  const prefixBlank = before.length > 0 && before[before.length - 1].trim().length > 0 ? [''] : []
  const newLines = [...before, ...prefixBlank, ...newSection, ...after]

  return {
    markdown: newLines.join('\n'),
    verdict: { op, applied: true },
  }
}

export function applyEditOp(
  markdown: string,
  op: Extract<PlanDiffOp, { op: 'edit' }>,
): { markdown: string; verdict: OpVerdict } {
  const { lines, phases } = parsePhases(markdown)
  const target = findPhase(phases, op.phase_id)
  if (!target) {
    return {
      markdown,
      verdict: { op, applied: false, reason: `phase ${op.phase_id} not found` },
    }
  }

  // Preserve depth + prefix style; only mutate title (if provided) and body (if provided).
  const usePhasePrefix = /^#{2,6}\s+Phase\s+/i.test(target.headerLine)
  const nextHeader = op.title !== undefined
    ? buildHeader({ depth: target.depth, phaseId: target.id, title: op.title, usePhasePrefix })
    : target.headerLine

  // If body is provided, replace the section's body (everything between
  // header and next-phase boundary). If body is undefined, keep existing
  // body intact and only update title.
  let newSection: string[]
  if (op.body !== undefined) {
    newSection = renderPhaseSection({
      depth: target.depth,
      phaseId: target.id,
      title: op.title ?? extractExistingTitle(target.headerLine, target.id),
      body: op.body,
      launchTier: op.launch_tier,
      usePhasePrefix,
    })
  } else {
    // Title-only edit: swap just the header line, leave body lines alone.
    newSection = [nextHeader, ...lines.slice(target.startLine + 1, target.endLine)]
  }

  const newLines = [
    ...lines.slice(0, target.startLine),
    ...newSection,
    ...lines.slice(target.endLine),
  ]
  return {
    markdown: newLines.join('\n'),
    verdict: { op, applied: true },
  }
}

// Extract just the title text from a header line for the case where edit
// provides a new body but no new title — we need to preserve the title.
function extractExistingTitle(headerLine: string, phaseId: string): string {
  // Strip leading #s, optional "Phase " prefix, then the id, then any
  // separator (space, em-dash, hyphen). What remains is the title.
  let s = headerLine.replace(/^#+\s+/, '')
  s = s.replace(/^Phase\s+/i, '')
  if (s.startsWith(phaseId)) s = s.slice(phaseId.length)
  s = s.replace(/^\s*[—–-]\s*/, '').replace(/^\s+/, '')
  return s
}

export function applyRemoveOp(
  markdown: string,
  op: Extract<PlanDiffOp, { op: 'remove' }>,
): { markdown: string; verdict: OpVerdict } {
  const { lines, phases } = parsePhases(markdown)
  const target = findPhase(phases, op.phase_id)
  if (!target) {
    return {
      markdown,
      verdict: { op, applied: false, reason: `phase ${op.phase_id} not found` },
    }
  }

  // Defensive cascade default: refuse to remove a phase that has children.
  // The flat-slice model only deletes the parent's own slice, which would
  // leave its conceptual children (e.g., 1.3a, 1.3b when removing 1.3)
  // present in the document but orphaned — no parent header above them,
  // breaking the plan tree's logical hierarchy. Force the user to be
  // explicit about cascade by removing children first (separate ops in
  // the same diff) or rejecting the removal entirely.
  const children = findChildrenOf(phases, op.phase_id)
  if (children.length > 0) {
    const childIds = children.map((c) => c.id).join(', ')
    return {
      markdown,
      verdict: {
        op,
        applied: false,
        reason: `phase ${op.phase_id} has children (${childIds}) — remove children first, or remove them as separate ops in this diff`,
      },
    }
  }

  const newLines = [
    ...lines.slice(0, target.startLine),
    ...lines.slice(target.endLine),
  ]
  return {
    markdown: newLines.join('\n'),
    verdict: { op, applied: true },
  }
}

export function applyReorderOp(
  markdown: string,
  op: Extract<PlanDiffOp, { op: 'reorder' }>,
): { markdown: string; verdict: OpVerdict } {
  const { lines, phases } = parsePhases(markdown)
  const ordered = op.ordered_phase_ids
  if (ordered.length < 2) {
    return {
      markdown,
      verdict: { op, applied: false, reason: 'reorder requires at least 2 phase ids' },
    }
  }

  // Locate each phase. Skip the whole op if any is missing — partial
  // reorder is more dangerous than no reorder.
  const targets = ordered.map((id) => ({ id, section: findPhase(phases, id) }))
  const missing = targets.filter((t) => !t.section).map((t) => t.id)
  if (missing.length > 0) {
    return {
      markdown,
      verdict: { op, applied: false, reason: `phases not found: ${missing.join(', ')}` },
    }
  }

  // Already in the requested order? No-op (still counted as applied so the
  // /queue handler reports it; the markdown is unchanged).
  const docOrder = targets.map((t) => t.section!).slice().sort((a, b) => a.startLine - b.startLine)
  const docOrderIds = docOrder.map((s) => s.id)
  if (docOrderIds.join('|') === ordered.join('|')) {
    return {
      markdown,
      verdict: { op, applied: true, reason: 'already in target order (no-op)' },
    }
  }

  // Splice region = from the earliest target's startLine to the latest
  // target's endLine. Anything inside this region that isn't part of a
  // listed phase stays IN PLACE relative to the original document — by
  // way of the slice-and-concatenate below, sections between listed
  // phases get re-emitted with their associated parent phase. We define
  // each listed phase's section as: its header through the line before
  // the NEXT LISTED phase's header (or, for the last listed phase, its
  // own endLine from the flat-slice parser).
  //
  // Concretely for fixture (1.3 / 1.3a / 1.3b / 1.3c / 1.3d / 1.4) when
  // reordering [1.3a, 1.3c, 1.3b, 1.3d]:
  //   region starts at line of "### 1.3a"
  //   region ends at endLine of "### 1.3d"
  //   each listed phase's "block" = its header through line-before-next-
  //   listed-phase-header. So 1.3a's block = [1.3a header .. 1.3b-1],
  //   1.3c's block = [1.3c header .. 1.3d-1], etc.
  //   Re-emit blocks in new order, splice back into [region].
  //
  // Phase 1.3 stays before the region, phase 1.4 stays after.

  // Build the list of listed-phase entries sorted by original doc order
  // (for slicing) AND the desired order (for re-emission).
  const sortedTargets = docOrder.slice()
  const regionStart = sortedTargets[0].startLine
  const regionEnd = sortedTargets[sortedTargets.length - 1].endLine

  // Compute each target's block: header through line-before-next-LISTED-
  // phase's header (or regionEnd for the final one).
  const blocksById = new Map<string, string[]>()
  for (let i = 0; i < sortedTargets.length; i++) {
    const s = sortedTargets[i]
    const blockEnd = i < sortedTargets.length - 1
      ? sortedTargets[i + 1].startLine
      : regionEnd
    blocksById.set(s.id, lines.slice(s.startLine, blockEnd))
  }

  // Re-emit in requested order.
  const reorderedBlock: string[] = []
  for (const id of ordered) {
    const block = blocksById.get(id)
    if (block) reorderedBlock.push(...block)
  }

  const newLines = [
    ...lines.slice(0, regionStart),
    ...reorderedBlock,
    ...lines.slice(regionEnd),
  ]
  return {
    markdown: newLines.join('\n'),
    verdict: { op, applied: true },
  }
}

// ─── Top-level orchestrator ───────────────────────────────────────────

export function applyOpsToMasterPlan(markdown: string, ops: PlanDiffOp[]): ApplyOpsResult {
  let cur = markdown
  const applied: OpVerdict[] = []
  const skipped: OpVerdict[] = []
  for (const op of ops) {
    let result: { markdown: string; verdict: OpVerdict }
    switch (op.op) {
      case 'add':
        result = applyAddOp(cur, op)
        break
      case 'edit':
        result = applyEditOp(cur, op)
        break
      case 'remove':
        result = applyRemoveOp(cur, op)
        break
      case 'reorder':
        result = applyReorderOp(cur, op)
        break
    }
    cur = result.markdown
    if (result.verdict.applied) applied.push(result.verdict)
    else skipped.push(result.verdict)
  }
  return { markdown: cur, applied, skipped }
}
