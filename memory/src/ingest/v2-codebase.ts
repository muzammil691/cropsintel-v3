import { readFileSync, existsSync } from 'fs'
import { resolve, relative, extname } from 'path'
import { execSync } from 'child_process'
import fg from 'fast-glob'
import { chunkCode, chunkMarkdown, chunkBySize } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.sql', '.md'])
const SKIP_DIRS = ['node_modules', '.git', 'dist', '.next', 'build', 'out', '.cache', 'coverage']

const CANDIDATE_PATHS = [
  process.env.V2_CODEBASE_PATH,
  `${process.env.HOME}/Documents/Claude/Projects/CropsIntelV2`,
  '/tmp/cropsintel-v2',
].filter(Boolean) as string[]

const V2_GITHUB_REPO = 'https://github.com/muzammil691/CropsIntelV2.git'
const V2_CLONE_PATH = '/tmp/cropsintel-v2'

export async function ingestV2Codebase(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'v2-codebase' as const

  let repoPath = CANDIDATE_PATHS.find(p => existsSync(p))

  if (!repoPath) {
    console.log(`[v2-codebase] Not found locally — cloning from ${V2_GITHUB_REPO}...`)
    try {
      execSync(`git clone --depth=1 ${V2_GITHUB_REPO} ${V2_CLONE_PATH}`, { stdio: 'pipe' })
      repoPath = V2_CLONE_PATH
    } catch (err) {
      const msg = `Failed to clone V2 repo: ${String(err)}`
      console.error(`[v2-codebase] ${msg}`)
      return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: [msg] }
    }
  }

  console.log(`[v2-codebase] Scanning ${repoPath}...`)

  const skipPattern = SKIP_DIRS.map(d => `**/${d}/**`).join(',')
  const files = await fg(`**/*.{js,ts,jsx,tsx,sql,md}`, {
    cwd: repoPath,
    ignore: SKIP_DIRS.map(d => `**/${d}/**`),
    absolute: true,
    dot: false,
  })

  console.log(`[v2-codebase] Found ${files.length} files to index`)

  let totalInserted = 0
  let totalSkipped = 0
  let totalCost = 0
  const errors: string[] = []
  let allChunks: RawChunk[] = []

  for (const filePath of files) {
    try {
      const relPath = relative(repoPath, filePath)
      const ext = extname(filePath)
      const text = readFileSync(filePath, 'utf-8')

      if (!text.trim()) continue

      let fileChunks
      if (ext === '.md') {
        fileChunks = chunkMarkdown(text, relPath)
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        fileChunks = chunkCode(text, relPath)
      } else {
        fileChunks = chunkBySize(text, relPath)
      }

      const rawChunks: RawChunk[] = fileChunks.map((c, idx) => ({
        source,
        source_path: relPath,
        source_section: c.section ?? null,
        content: c.content,
        chunk_index: idx,
        metadata: {
          language: ext.slice(1),
          repo: 'v2',
          priority: isHighValueFile(relPath) ? 'high' : 'normal',
        },
      }))

      allChunks.push(...rawChunks)

      // Flush in batches of 500 to avoid memory pressure
      if (allChunks.length >= 500) {
        const { inserted, skipped, costUsd } = await embedAndStore(allChunks)
        totalInserted += inserted
        totalSkipped += skipped
        totalCost += costUsd
        allChunks = []
        process.stdout.write('.')
      }
    } catch (err) {
      errors.push(`${filePath}: ${String(err)}`)
    }
  }

  // Flush remaining
  if (allChunks.length > 0) {
    const { inserted, skipped, costUsd } = await embedAndStore(allChunks)
    totalInserted += inserted
    totalSkipped += skipped
    totalCost += costUsd
  }

  console.log(`\n[v2-codebase] Done: +${totalInserted} chunks, ${totalSkipped} skipped, $${totalCost.toFixed(4)}, ${errors.length} errors`)

  const result: IngestResult = {
    source,
    chunksAdded: totalInserted,
    chunksSkipped: totalSkipped,
    costUsd: totalCost,
    durationMs: Date.now() - start,
    errors,
  }

  await writeMemoryRun({
    operation: 'ingest',
    source,
    chunks_added: totalInserted,
    chunks_skipped: totalSkipped,
    cost_usd: totalCost,
    duration_ms: result.durationMs,
    metadata: { files_scanned: files.length, errors: errors.length },
  })

  return result
}

function isHighValueFile(relPath: string): boolean {
  const highValuePatterns = [
    'runner',
    'zyra',
    'whatsapp',
    'scraper',
    'supabase/functions',
    'auth',
    'intelligence',
    'oracle',
  ]
  const lower = relPath.toLowerCase()
  return highValuePatterns.some(p => lower.includes(p))
}
