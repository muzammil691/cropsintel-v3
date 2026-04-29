import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve, relative, extname } from 'path'
import { execSync } from 'child_process'
import fg from 'fast-glob'
import { chunkCode, chunkMarkdown, chunkBySize } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

const SKIP_DIRS = ['node_modules', '.git', 'dist', '.next', 'build', 'out', '.cache', 'coverage']
const V1_GITLAB_URL = 'https://gitlab.com/muzammil69/almond-oracle.git'
const V1_CLONE_PATH = '/tmp/almond-oracle-v1'
const QUESTION_PATH = resolve(__dirname, '../../../../.agent/questions/phase-1.00c-memory-q.md')

const CANDIDATE_PATHS = [
  process.env.V1_CODEBASE_PATH,
  `${process.env.HOME}/Documents/Claude/Projects/almond-oracle`,
  '/tmp/almond-oracle-v1',
  '/tmp/almond-oracle',
].filter(Boolean) as string[]

export async function ingestV1Codebase(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'v1-codebase' as const

  let repoPath = CANDIDATE_PATHS.find(p => existsSync(p))

  if (!repoPath) {
    console.log(`[v1-codebase] Not found locally — attempting GitLab clone...`)
    try {
      execSync(`git clone --depth=1 ${V1_GITLAB_URL} ${V1_CLONE_PATH} 2>&1`, {
        stdio: 'pipe',
        timeout: 30000,
      })
      repoPath = V1_CLONE_PATH
      console.log('[v1-codebase] Clone succeeded')
    } catch (err) {
      const msg = `GitLab clone failed (no access or SSH key mismatch): ${String(err)}`
      console.warn(`[v1-codebase] ${msg}`)
      writeQuestionFile(msg)
      return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: [msg] }
    }
  }

  console.log(`[v1-codebase] Scanning ${repoPath}...`)

  const files = await fg(`**/*.{js,ts,jsx,tsx,sql,md}`, {
    cwd: repoPath,
    ignore: SKIP_DIRS.map(d => `**/${d}/**`),
    absolute: true,
    dot: false,
  })

  console.log(`[v1-codebase] Found ${files.length} files`)

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
          repo: 'v1',
          priority: isHighValueFile(relPath) ? 'high' : 'normal',
        },
      }))

      allChunks.push(...rawChunks)

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

  if (allChunks.length > 0) {
    const { inserted, skipped, costUsd } = await embedAndStore(allChunks)
    totalInserted += inserted
    totalSkipped += skipped
    totalCost += costUsd
  }

  console.log(`\n[v1-codebase] Done: +${totalInserted} chunks, $${totalCost.toFixed(4)}`)

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
    'zyra',
    'runner',
    'whatsapp',
    'intelligence',
    'oracle',
    'scraper',
    'prompt',
    'defense',
  ]
  const lower = relPath.toLowerCase()
  return highValuePatterns.some(p => lower.includes(p))
}

function writeQuestionFile(error: string): void {
  const content = `# Question — phase-1.00c-memory

**Blocking:** V1 GitLab codebase (almond-oracle) is not accessible

**Context:**
The Memory Agent ingestion tried to clone \`${V1_GITLAB_URL}\` during the v1-codebase ingest step.
The clone failed, most likely because the Railway VPS's SSH key does not have GitLab access.

Error: ${error}

**Options I'm considering:**
1. **Add a GitLab deploy key** — Muzammil grants the VPS's SSH public key read-only access to the \`almond-oracle\` repo in GitLab Settings → Repository → Deploy Keys. No code change needed.
2. **Mirror V1 to GitHub** — Muzammil creates a private GitHub mirror of almond-oracle (or makes it public). The memory agent already knows how to clone from GitHub. Update V1_GITHUB_URL in v1-codebase.ts.
3. **Skip V1 entirely** — Fall back on V1 audit docs (\`v3-step2-v1-audit.md\`) which summarise V1's architecture. V2 codebase is already indexed and covers most of the same patterns.

**Recommendation:** Option 1 (add deploy key) if Muzammil wants the actual V1 source indexed. Option 3 (skip) if the audit docs are sufficient for now.

**Master plan reference:** section 9.2 R1 Zyra — "V1 has the deep zyra orchestration framework that's most valuable to learn from"
`
  try {
    writeFileSync(QUESTION_PATH, content, 'utf-8')
    console.log(`[v1-codebase] Wrote question file: ${QUESTION_PATH}`)
  } catch {
    console.error('[v1-codebase] Failed to write question file')
  }
}
