// Phase 1.10aq — Cascade analysis for diagnosis gaps.
//
// Given an audit gap (a {check, file} pair on a specific commit), determine
// whether the gap was:
//   - introduced-here          (the audited commit is the first to touch this file)
//   - introduced-by-prior-fix  (a recent fix(atlas-pd) commit on this file
//                               touched the same check, then this audit caught
//                               a follow-on variant — i.e., our fix made it
//                               worse or revealed a near-miss)
//   - pre-existing             (file first touched > 7 days ago and pattern
//                               matches a long-standing condition)
//   - unknown                  (everything else)
//
// Used to render the "Introduced by your last fix abc123" chip on each gap in
// the diagnosis card so the user can answer "is the new audit because of my
// previous change?" with one glance.

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

export type CascadeRelation =
  | { kind: 'introduced-here'; reason: 'first commit to touch this file' }
  | {
      kind: 'introduced-by-prior-fix'
      prior_sha: string
      prior_subject: string
      same_check: boolean
    }
  | { kind: 'pre-existing'; oldest_sha: string; days_old: number }
  | { kind: 'unknown' }

export interface CascadeGapInput {
  check?: string
  file?: string
}

interface FileHistoryEntry {
  sha: string
  subject: string
  authored_at: number // epoch ms
}

interface CacheEntry {
  history: FileHistoryEntry[]
  cachedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const fileHistoryCache = new Map<string, CacheEntry>()

async function getFileHistory(file: string): Promise<FileHistoryEntry[]> {
  const cached = fileHistoryCache.get(file)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.history
  }

  let stdout = ''
  try {
    const result = await execFileP(
      'git',
      [
        '--no-pager',
        'log',
        '--since=14 days ago',
        '--pretty=format:%H%x09%at%x09%s',
        '--',
        file,
      ],
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    )
    stdout = result.stdout
  } catch {
    // File may not exist anymore or git error — treat as empty history.
    stdout = ''
  }

  const history: FileHistoryEntry[] = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ts, ...rest] = line.split('\t')
      return {
        sha,
        authored_at: Number(ts) * 1000,
        subject: rest.join('\t'),
      }
    })
    .filter((e) => e.sha && Number.isFinite(e.authored_at))

  fileHistoryCache.set(file, { history, cachedAt: Date.now() })
  return history
}

// Pull the per-file history older than the 14d window — only used when we
// need to confirm a gap is pre-existing. Cheap one-shot query, separate cache.
const oldestTouchCache = new Map<string, { entry: FileHistoryEntry | null; cachedAt: number }>()

async function getOldestTouch(file: string): Promise<FileHistoryEntry | null> {
  const cached = oldestTouchCache.get(file)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.entry
  }
  let stdout = ''
  try {
    const result = await execFileP(
      'git',
      [
        '--no-pager',
        'log',
        '--reverse',
        '--pretty=format:%H%x09%at%x09%s',
        '--',
        file,
      ],
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    )
    stdout = result.stdout
  } catch {
    stdout = ''
  }
  const firstLine = stdout.split('\n').filter(Boolean)[0] ?? null
  let entry: FileHistoryEntry | null = null
  if (firstLine) {
    const [sha, ts, ...rest] = firstLine.split('\t')
    entry = {
      sha,
      authored_at: Number(ts) * 1000,
      subject: rest.join('\t'),
    }
  }
  oldestTouchCache.set(file, { entry, cachedAt: Date.now() })
  return entry
}

const FIX_SUBJECT_RE = /^fix\(atlas-pd\)/i

function subjectMentionsCheck(subject: string, check: string | undefined): boolean {
  if (!check) return false
  const norm = check.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (norm.length < 3) return false
  const subjectNorm = subject.toLowerCase().replace(/[^a-z0-9]/g, '')
  return subjectNorm.includes(norm)
}

export async function analyzeCascade(
  commitSha: string,
  gap: CascadeGapInput,
): Promise<CascadeRelation> {
  const file = gap.file
  if (!file || !commitSha) return { kind: 'unknown' }

  const history = await getFileHistory(file)
  if (history.length === 0) return { kind: 'unknown' }

  const auditedShort = commitSha.slice(0, 12)
  const auditedEntry =
    history.find((e) => e.sha.startsWith(auditedShort)) ?? history.find((e) => e.sha === commitSha)

  // The audited commit is the one being analyzed. Prior commits are everything
  // strictly older than it (lower in the recency-sorted list = newer; git log
  // returns newest first).
  let auditedIdx = -1
  if (auditedEntry) {
    auditedIdx = history.indexOf(auditedEntry)
  }
  const prior = auditedIdx >= 0 ? history.slice(auditedIdx + 1) : history

  // 1. Was the file created in the audited commit? (no prior history at all)
  if (auditedIdx >= 0 && prior.length === 0) {
    return { kind: 'introduced-here', reason: 'first commit to touch this file' }
  }

  // 2. Did a prior fix(atlas-pd) commit touch this file with the same check?
  for (const p of prior) {
    if (FIX_SUBJECT_RE.test(p.subject)) {
      const sameCheck = subjectMentionsCheck(p.subject, gap.check)
      return {
        kind: 'introduced-by-prior-fix',
        prior_sha: p.sha,
        prior_subject: p.subject,
        same_check: sameCheck,
      }
    }
  }

  // 3. Pre-existing: oldest touch is more than 7 days ago.
  const oldest = await getOldestTouch(file)
  if (oldest) {
    const daysOld = Math.floor((Date.now() - oldest.authored_at) / (24 * 3600 * 1000))
    if (daysOld > 7) {
      return { kind: 'pre-existing', oldest_sha: oldest.sha, days_old: daysOld }
    }
  }

  return { kind: 'unknown' }
}

// Test-only escape hatch.
export function _resetCascadeCachesForTests(): void {
  fileHistoryCache.clear()
  oldestTouchCache.clear()
}
