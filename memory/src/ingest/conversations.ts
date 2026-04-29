import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import fg from 'fast-glob'
import { chunkConversation, ConversationTurn } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

// Keywords that mark a conversation as CropsIntel-relevant
const RELEVANT_KEYWORDS = [
  'cropsintel', 'v3', 'zyra', 'adela', 'atlas', 'almond', 'oracle',
  'maxons', 'workflow', 'supabase', 'railway', 'agent', 'master plan',
  'cropsintell', 'crops intel',
]

const CANDIDATE_ROOTS = [
  process.env.CONVERSATIONS_PATH,
  `${process.env.HOME}/Library/Application Support/Claude/local-agent-mode-sessions`,
  '/workspace/.claude/sessions',
].filter(Boolean) as string[]

export async function ingestConversations(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'conversations' as const

  const root = CANDIDATE_ROOTS.find(r => existsSync(r))
  if (!root) {
    console.warn('[conversations] Session transcripts not found at any candidate path')
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: ['Session root not found'] }
  }

  console.log(`[conversations] Scanning ${root}...`)

  const jsonlFiles = await fg('**/*.jsonl', { cwd: root, absolute: true })
  console.log(`[conversations] Found ${jsonlFiles.length} session files`)

  let totalInserted = 0
  let totalSkipped = 0
  let totalCost = 0
  const errors: string[] = []

  for (const filePath of jsonlFiles) {
    try {
      const text = readFileSync(filePath, 'utf-8')
      const lines = text.trim().split('\n').filter(Boolean)

      // Parse turns
      const turns: ConversationTurn[] = []
      let pendingUser: string | null = null

      for (const line of lines) {
        let entry: Record<string, unknown>
        try {
          entry = JSON.parse(line)
        } catch {
          continue
        }

        const role = String(entry.role ?? entry.type ?? '')
        const content = extractContent(entry)

        if (!content) continue

        if (role === 'user' || role === 'human') {
          pendingUser = content
        } else if ((role === 'assistant' || role === 'ai') && pendingUser) {
          turns.push({ userMessage: pendingUser, assistantMessage: content, turnIndex: turns.length })
          pendingUser = null
        }
      }

      if (turns.length === 0) continue

      // Filter: only include sessions that mention CropsIntel topics
      const fullText = turns.map(t => `${t.userMessage} ${t.assistantMessage}`).join(' ').toLowerCase()
      const isRelevant = RELEVANT_KEYWORDS.some(kw => fullText.includes(kw))
      if (!isRelevant) continue

      const sessionId = filePath.split('/').slice(-3).join('/')
      const textChunks = chunkConversation(turns)

      const rawChunks: RawChunk[] = textChunks.map((c, idx) => ({
        source,
        source_path: sessionId,
        source_section: c.section ?? null,
        content: c.content,
        chunk_index: idx,
        metadata: { session_file: sessionId, turns_total: turns.length },
      }))

      if (rawChunks.length === 0) continue

      const { inserted, skipped, costUsd } = await embedAndStore(rawChunks)
      totalInserted += inserted
      totalSkipped += skipped
      totalCost += costUsd
    } catch (err) {
      errors.push(`${filePath}: ${String(err)}`)
    }
  }

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
    metadata: { files_scanned: jsonlFiles.length, errors: errors.length },
  })

  console.log(`[conversations] Done: +${totalInserted} chunks, $${totalCost.toFixed(4)}`)
  return result
}

function extractContent(entry: Record<string, unknown>): string {
  if (typeof entry.content === 'string') return entry.content
  if (Array.isArray(entry.content)) {
    return entry.content
      .filter((c): c is { type: string; text: string } => typeof c === 'object' && c !== null && 'text' in c)
      .map(c => c.text)
      .join('\n')
  }
  if (typeof entry.text === 'string') return entry.text
  if (typeof entry.message === 'string') return entry.message
  return ''
}
