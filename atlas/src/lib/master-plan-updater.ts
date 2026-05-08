// Phase 1.10aj — incremental append of cockpit-added phases to master-plan.md.
//
// When a user "Follows" a brand-new phase (one added via Add, not derived
// from an existing master plan node), the master plan must be updated so
// it stays the single source of truth. We append (never rewrite) under a
// dedicated section so the diff is small and reviewable.
//
// Version bumps follow the existing convention: bump the patch in the
// header line `<!-- master plan version: vX.Y -->` if present. The first
// cockpit-added phase bumps to v1.7; subsequent appends roll forward.

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { REPO_ROOT, PLAN_PATH_REL } from './plan-server'

export interface AppendPhaseInput {
  phaseId: string
  title: string
  summary: string
  actorPhone?: string
}

export interface AppendPhaseResult {
  ok: boolean
  reason?: string
  relPath: string
  newVersion?: string
  appendedSection: string
}

const SECTION_MARKER = '<!-- cockpit-added phases (v1.7+) -->'

/**
 * Append a brand-new phase (added via cockpit Add) to master-plan.md. The
 * master plan markdown is the single source of truth; this updates it
 * incrementally so subsequent reads of the plan tree show the new node.
 */
export async function appendCockpitPhaseToMasterPlan(
  input: AppendPhaseInput,
): Promise<AppendPhaseResult> {
  const path = resolve(REPO_ROOT, PLAN_PATH_REL)
  let existing = ''
  try {
    existing = await readFile(path, 'utf-8')
  } catch (err) {
    return {
      ok: false,
      reason: `master plan not readable: ${err instanceof Error ? err.message : String(err)}`,
      relPath: PLAN_PATH_REL,
      appendedSection: '',
    }
  }

  const newVersion = bumpPlanVersion(existing)
  const updatedHeader = updateVersionMarker(existing, newVersion)

  const appendedSection = renderPhaseSection(input)
  const withSection = ensureCockpitMarker(updatedHeader, appendedSection)

  if (withSection === existing) {
    return {
      ok: false,
      reason: 'no_change',
      relPath: PLAN_PATH_REL,
      appendedSection,
    }
  }

  await writeFile(path, withSection, 'utf-8')
  return {
    ok: true,
    relPath: PLAN_PATH_REL,
    newVersion,
    appendedSection,
  }
}

function bumpPlanVersion(content: string): string {
  const match = content.match(/<!--\s*master plan version:\s*v(\d+)\.(\d+)\s*-->/i)
  if (!match) return 'v1.7'
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10) + 1
  return `v${major}.${minor}`
}

function updateVersionMarker(content: string, newVersion: string): string {
  const re = /<!--\s*master plan version:\s*v\d+\.\d+\s*-->/i
  if (re.test(content)) {
    return content.replace(re, `<!-- master plan version: ${newVersion} -->`)
  }
  // No marker present — prepend one at the top of the file.
  return `<!-- master plan version: ${newVersion} -->\n${content}`
}

function renderPhaseSection(input: AppendPhaseInput): string {
  const today = new Date().toISOString().slice(0, 10)
  const summary = input.summary.replace(/\s+/g, ' ').slice(0, 500)
  return `## Phase ${input.phaseId} — ${input.title}

_Added via cockpit wizard on ${today}${input.actorPhone ? ` by ${input.actorPhone}` : ''}_

${summary}

`
}

function ensureCockpitMarker(content: string, appendedSection: string): string {
  if (content.includes(SECTION_MARKER)) {
    // Append after the marker, before the next top-level header.
    const idx = content.indexOf(SECTION_MARKER) + SECTION_MARKER.length
    return content.slice(0, idx) + '\n\n' + appendedSection + content.slice(idx)
  }
  // First time: append marker + section at end.
  const trailing = content.endsWith('\n') ? '' : '\n'
  return `${content}${trailing}\n${SECTION_MARKER}\n\n${appendedSection}`
}

export const __test_only__ = {
  bumpPlanVersion,
  updateVersionMarker,
  renderPhaseSection,
  ensureCockpitMarker,
  SECTION_MARKER,
}
