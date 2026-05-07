// Persistent dedupe gate for the Atlas conductor's verifier-failure-cluster
// detector. Replaces the in-process Set<string> that lived in conductor.ts so
// the gate survives container restarts and consults durable evidence on disk
// (closed ADRs, queued/in-progress cluster specs, shipped remediation tasks)
// before falling back to the in-process snapshot.
//
// Reads filesystem only — no Supabase. The conductor must keep working when
// the DB is down. Pure scanning logic, modeled after verifier/src/lib/spec-parser.

import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'

export interface DedupeGateInput {
  clusterKey: string
  taskIds: string[]
  failTimestamps: string[]
  repoRoot: string
}

export type DedupeOutcome =
  | {
      skip: true
      reason: 'closed-adr' | 'trailing-window' | 'shipped-rem' | 'in-process'
      evidence: string
    }
  | { skip: false }

const TRAILING_WINDOW_MS = 30 * 60 * 1000

const inProcessClusterKeys = new Set<string>()

export function rememberClusterKey(clusterKey: string): void {
  inProcessClusterKeys.add(clusterKey)
}

export function _resetInProcessClusterKeys(): void {
  inProcessClusterKeys.clear()
}

export async function checkClusterDedupe(input: DedupeGateInput): Promise<DedupeOutcome> {
  const { clusterKey, taskIds, failTimestamps, repoRoot } = input

  const adrHit = await scanClosedAdrs(repoRoot, taskIds)
  if (adrHit) return { skip: true, reason: 'closed-adr', evidence: adrHit }

  const trailingHit = await scanTrailingWindow(repoRoot, taskIds)
  if (trailingHit) return { skip: true, reason: 'trailing-window', evidence: trailingHit }

  const remHit = await scanShippedRem(repoRoot, taskIds, failTimestamps)
  if (remHit) return { skip: true, reason: 'shipped-rem', evidence: remHit }

  if (inProcessClusterKeys.has(clusterKey)) {
    return {
      skip: true,
      reason: 'in-process',
      evidence: `in-process clusterKey=${clusterKey.slice(0, 200)}`,
    }
  }

  return { skip: false }
}

async function scanClosedAdrs(repoRoot: string, taskIds: string[]): Promise<string | null> {
  if (taskIds.length === 0) return null
  const adrDir = join(repoRoot, 'docs/atlas-decisions')
  let entries: string[]
  try {
    entries = await readdir(adrDir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.startsWith('ADR-') || !entry.endsWith('.md')) continue
    const path = join(adrDir, entry)
    let body: string
    try {
      body = await readFile(path, 'utf-8')
    } catch {
      continue
    }
    if (taskIds.every(id => body.includes(id))) {
      return `docs/atlas-decisions/${entry}`
    }
  }
  return null
}

async function scanTrailingWindow(repoRoot: string, taskIds: string[]): Promise<string | null> {
  if (taskIds.length === 0) return null
  const dirs = ['.agent/tasks/queued', '.agent/tasks/in-progress']
  const cutoff = Date.now() - TRAILING_WINDOW_MS
  for (const rel of dirs) {
    const dir = join(repoRoot, rel)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('phase-1-CLUSTER-investigation-') || !entry.endsWith('.md')) continue
      const path = join(dir, entry)
      let st
      try {
        st = await stat(path)
      } catch {
        continue
      }
      if (st.mtimeMs < cutoff) continue
      let body: string
      try {
        body = await readFile(path, 'utf-8')
      } catch {
        continue
      }
      if (taskIds.every(id => body.includes(id))) {
        return `${rel}/${entry}`
      }
    }
  }
  return null
}

async function scanShippedRem(
  repoRoot: string,
  taskIds: string[],
  failTimestamps: string[],
): Promise<string | null> {
  if (taskIds.length === 0) return null
  const doneDir = join(repoRoot, '.agent/tasks/done')
  let entries: string[]
  try {
    entries = await readdir(doneDir)
  } catch {
    return null
  }

  const latestFailMs = failTimestamps
    .map(t => Date.parse(t))
    .filter(n => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)

  for (const taskId of taskIds) {
    const base = taskId.replace(/-rem\d*$/, '')
    const remPattern = new RegExp(`^${escapeRegExp(base)}-rem\\d*\\.md$`)
    for (const entry of entries) {
      if (!remPattern.test(entry)) continue
      const path = join(doneDir, entry)
      let st
      try {
        st = await stat(path)
      } catch {
        continue
      }
      if (st.mtimeMs > latestFailMs) {
        return `.agent/tasks/done/${entry}`
      }
    }
  }
  return null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
