#!/usr/bin/env node
// Phase 1.10ai: estimate-vs-actual calibration helper. Diagnostic only —
// does NOT modify any production code path.
//
// What it does:
//   1. Walks `.agent/tasks/done/` for the most recent N specs (default 30).
//   2. Reads each spec's front-matter `estimated_builder_minutes`.
//   3. Looks up Builder's actual run time from the ship commit message
//      (agent-loop.sh writes `feat: <task> (autonomous agent, <duration>s, ...)`).
//   4. Computes ratio actual/estimate per spec, and the median across the set.
//   5. Writes a markdown report to `docs/atlas-decisions/<DATE>-estimate-calibration.md`.
//
// Run via:  npx ts-node atlas/src/scripts/calibrate-estimates.ts
//          (or compile and run: node atlas/dist/scripts/calibrate-estimates.js)

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parseSpec } from '../lib/frontmatter'

const execFileP = promisify(execFile)

export interface CalibrationRow {
  taskId: string
  estimatedMinutes: number | null
  actualSeconds: number | null
  actualMinutes: number | null
  ratio: number | null   // actual / estimate, both in minutes
  bias: number | null    // estimate / actual — "we overestimated by Nx"
  source: 'commit' | 'missing'
}

export interface CalibrationResult {
  reportPath: string
  rows: CalibrationRow[]
  medianRatio: number | null
  medianBias: number | null
}

async function listRecentDoneSpecs(doneDir: string, limit: number): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(doneDir)
  } catch {
    return []
  }
  const md = entries.filter(f => f.endsWith('.md') && f !== '_template.md')
  const withTime = await Promise.all(
    md.map(async f => {
      try {
        const s = await stat(resolve(doneDir, f))
        return { f, mt: s.mtime.getTime() }
      } catch {
        return { f, mt: 0 }
      }
    }),
  )
  withTime.sort((a, b) => b.mt - a.mt)
  return withTime.slice(0, limit).map(x => x.f)
}

async function findCommitDuration(repoRoot: string, taskId: string): Promise<number | null> {
  // agent-loop.sh commits with: `feat: <taskId> (autonomous agent, <N>s, ...)`.
  // We grep the full git log for the most recent matching commit and parse N.
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', '--grep', `feat: ${taskId} (autonomous agent`, '--format=%s', '-n', '1'],
      { cwd: repoRoot },
    )
    const match = stdout.match(/autonomous agent,\s*(\d+)s/)
    if (match) return parseInt(match[1], 10)
  } catch { /* fall through */ }
  // Fallback: try a broader feat: <taskId> commit and extract any "(<N>s," span.
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', '--grep', `feat: ${taskId}`, '--format=%s', '-n', '1'],
      { cwd: repoRoot },
    )
    const match = stdout.match(/\((?:[^)]*?,\s*)?(\d+)s,/)
    if (match) return parseInt(match[1], 10)
  } catch { /* ignore */ }
  return null
}

function readEstimate(content: string): number | null {
  const parsed = parseSpec(content)
  const raw = parsed.frontmatter.extra?.estimated_builder_minutes
  if (!raw) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function median(nums: number[]): number | null {
  const xs = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid]
}

export function buildReportMarkdown(rows: CalibrationRow[], medianRatio: number | null, medianBias: number | null, today: string): string {
  const lines: string[] = []
  const usable = rows.filter(r => r.ratio !== null)
  lines.push(`# Estimate calibration — ${today}`)
  lines.push('')
  lines.push(`Sample size: ${rows.length} specs (most recent in \`.agent/tasks/done/\`).`)
  lines.push(`Usable rows (estimate + ship-commit duration both present): ${usable.length}.`)
  lines.push('')
  lines.push(`**Median ratio (actual / estimate): ${medianRatio === null ? 'n/a' : medianRatio.toFixed(2)}x**`)
  if (medianBias !== null) {
    lines.push(`**Median bias factor (estimate / actual): ${medianBias.toFixed(1)}x — i.e. estimates are ~${medianBias.toFixed(1)}x too high.**`)
  }
  lines.push('')
  lines.push('Per-spec breakdown (newest first):')
  lines.push('')
  lines.push('| Spec | Est. (min) | Actual (min) | Ratio | Bias |')
  lines.push('| --- | ---:| ---:| ---:| ---:|')
  for (const r of rows) {
    const est = r.estimatedMinutes === null ? '—' : r.estimatedMinutes.toFixed(0)
    const act = r.actualMinutes === null ? '—' : r.actualMinutes.toFixed(1)
    const ratio = r.ratio === null ? '—' : `${r.ratio.toFixed(2)}x`
    const bias = r.bias === null ? '—' : `${r.bias.toFixed(1)}x`
    lines.push(`| \`${r.taskId}\` | ${est} | ${act} | ${ratio} | ${bias} |`)
  }
  lines.push('')
  lines.push('## How Atlas should use this')
  lines.push('')
  lines.push('This report is read-only diagnostic data. The conductor reaper already')
  lines.push('reads `estimated_builder_minutes` directly from each spec\'s front matter')
  lines.push('and uses `dynamicReaperThresholdMin(estimate * 2)` clamped 30–180 min.')
  lines.push('Nothing here changes that.')
  lines.push('')
  lines.push('When Claude Code drafts a *new* spec for this repo, divide the gut-feel')
  lines.push('estimate by the median bias factor above to get a more truthful')
  lines.push('`estimated_builder_minutes`. Once enough samples exist, this script can')
  lines.push('be folded into spec-draft.ts; for now it stays manual.')
  lines.push('')
  return lines.join('\n')
}

export async function runCalibration(opts: {
  repoRoot: string
  sampleSize?: number
}): Promise<CalibrationResult> {
  const repoRoot = opts.repoRoot
  const sampleSize = opts.sampleSize ?? 30
  const doneDir = resolve(repoRoot, '.agent/tasks/done')
  const reportDir = resolve(repoRoot, 'docs/atlas-decisions')

  const specs = await listRecentDoneSpecs(doneDir, sampleSize)
  const rows: CalibrationRow[] = []
  for (const file of specs) {
    const taskId = file.replace(/\.md$/, '')
    let content = ''
    try { content = await readFile(resolve(doneDir, file), 'utf-8') } catch { /* skip */ }
    const estimatedMinutes = readEstimate(content)
    const actualSeconds = await findCommitDuration(repoRoot, taskId)
    const actualMinutes = actualSeconds === null ? null : actualSeconds / 60
    const ratio = (estimatedMinutes && actualMinutes) ? actualMinutes / estimatedMinutes : null
    const bias = (estimatedMinutes && actualMinutes && actualMinutes > 0)
      ? estimatedMinutes / actualMinutes
      : null
    rows.push({
      taskId,
      estimatedMinutes,
      actualSeconds,
      actualMinutes,
      ratio,
      bias,
      source: actualSeconds === null ? 'missing' : 'commit',
    })
  }

  const usableRatios = rows
    .map(r => r.ratio)
    .filter((r): r is number => r !== null && Number.isFinite(r))
  const medianRatio = median(usableRatios)
  const medianBias = (medianRatio !== null && medianRatio > 0) ? 1 / medianRatio : null

  const today = new Date().toISOString().slice(0, 10)
  const reportPath = resolve(reportDir, `${today}-estimate-calibration.md`)
  await mkdir(reportDir, { recursive: true }).catch(() => { /* exists */ })
  await writeFile(reportPath, buildReportMarkdown(rows, medianRatio, medianBias, today), 'utf-8')

  return { reportPath, rows, medianRatio, medianBias }
}

// CLI entry point — only fires when this module is invoked directly.
async function main(): Promise<void> {
  const repoRoot = process.env.REPO_ROOT ?? resolve(__dirname, '../../..')
  const sampleSize = parseInt(process.env.CALIBRATE_SAMPLE_SIZE ?? '30', 10)
  const result = await runCalibration({ repoRoot, sampleSize })
  if (result.rows.length === 0) {
    console.error(`[calibrate] no done specs found in ${repoRoot}/.agent/tasks/done`)
    process.exit(1)
  }
  console.log(`[calibrate] wrote ${result.reportPath}`)
  console.log(`[calibrate] median ratio = ${result.medianRatio === null ? 'n/a' : result.medianRatio.toFixed(2) + 'x'}`)
  if (result.medianBias !== null) {
    console.log(`[calibrate] median bias  = ${result.medianBias.toFixed(1)}x`)
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[calibrate] failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
