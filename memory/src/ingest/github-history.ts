import { execSync, execFile } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'
import { chunkBySize } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

const execFileP = promisify(execFile)

const REPO_PATH = process.env.REPO_ROOT ?? resolve(__dirname, '../../../..')

interface GitCommit {
  hash: string
  date: string
  author: string
  message: string
  files: string
}

// Memory's clone of origin/main is otherwise static after container boot —
// the entrypoint pulls once, then the cron polls forever against the stale
// HEAD. That makes every post-boot ship invisible to memory.ingest, which
// surfaces in Atlas as `memory_ingest_missing` workflow-trace gaps. Same
// pattern Designer + Verifier already use: hard-reset to origin/main before
// touching the working tree. If the sync fails we proceed with the stale
// clone (better than skipping ingest entirely) but log loudly so it's
// visible in container logs.
async function syncRepoBeforeIngest(repoRoot: string): Promise<void> {
  try {
    await execFileP('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: repoRoot })
    await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: repoRoot })
    console.log('[memory-ingest] synced clone to origin/main')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[memory-ingest] sync failed: ${msg.slice(0, 200)} — continuing with stale clone`)
  }
}

export async function ingestGithubHistory(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'github-history' as const

  await syncRepoBeforeIngest(REPO_PATH)

  let commits: GitCommit[]
  try {
    commits = parseGitLog(REPO_PATH)
  } catch (err) {
    const msg = `Failed to read git log: ${String(err)}`
    console.error(`[github-history] ${msg}`)
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: [msg] }
  }

  console.log(`[github-history] Found ${commits.length} commits`)

  // Group commits into chunks of ~10 commits to keep chunk sizes in range
  const COMMITS_PER_CHUNK = 10
  const rawChunks: RawChunk[] = []

  for (let i = 0; i < commits.length; i += COMMITS_PER_CHUNK) {
    const batch = commits.slice(i, i + COMMITS_PER_CHUNK)
    const content = batch
      .map(
        c =>
          `commit ${c.hash}\nDate: ${c.date}\nAuthor: ${c.author}\n\n${c.message}${c.files ? `\n\nFiles changed:\n${c.files}` : ''}`,
      )
      .join('\n\n' + '─'.repeat(40) + '\n\n')

    rawChunks.push({
      source,
      source_path: 'git-log',
      source_section: `commits-${i}-${i + batch.length - 1}`,
      content,
      chunk_index: Math.floor(i / COMMITS_PER_CHUNK),
      metadata: {
        commit_count: batch.length,
        earliest: batch[batch.length - 1]?.date,
        latest: batch[0]?.date,
      },
    })
  }

  const { inserted, skipped, costUsd } = await embedAndStore(rawChunks)

  const result: IngestResult = {
    source,
    chunksAdded: inserted,
    chunksSkipped: skipped,
    costUsd,
    durationMs: Date.now() - start,
    errors: [],
  }

  // commit_shas powers Atlas's workflow-trace invariant checker — without it,
  // Atlas can't tell whether a freshly-shipped commit actually made it into
  // memory. Cap to the most recent shas to keep the row small.
  const COMMIT_SHA_CAP = 200
  const commitShas = commits.slice(0, COMMIT_SHA_CAP).map(c => c.hash)

  await writeMemoryRun({
    operation: 'ingest',
    source,
    chunks_added: inserted,
    chunks_skipped: skipped,
    cost_usd: costUsd,
    duration_ms: result.durationMs,
    metadata: {
      total_commits: commits.length,
      commit_shas: commitShas,
    },
  })

  console.log(`[github-history] Done: +${inserted} chunks, $${costUsd.toFixed(4)}`)
  return result
}

function parseGitLog(repoPath: string): GitCommit[] {
  const SEP = '||COMMIT_SEP||'
  const FIELD_SEP = '||FIELD_SEP||'

  const format = `--format=${SEP}%H${FIELD_SEP}%ai${FIELD_SEP}%an${FIELD_SEP}%s%n%b`

  const output = execSync(
    `git -C "${repoPath}" log ${format} --stat --no-merges`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  )

  return output
    .split(SEP)
    .slice(1) // drop empty first element
    .map(block => {
      const firstLine = block.split('\n')[0]
      const rest = block.split('\n').slice(1).join('\n')
      const [hash, date, author, ...messageParts] = firstLine.split(FIELD_SEP)
      const message = messageParts.join(FIELD_SEP).trim()

      // Extract file stats from the stat block
      const statLines = rest
        .split('\n')
        .filter(l => l.includes('|') || (l.includes('changed') && l.includes('insertion')))
        .slice(0, 20)
        .join('\n')
        .trim()

      return { hash: hash.trim(), date: date.trim(), author: author.trim(), message, files: statLines }
    })
    .filter(c => c.hash && c.message)
}
