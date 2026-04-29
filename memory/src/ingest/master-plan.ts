import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { chunkMarkdown } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

const CANDIDATE_PATHS = [
  process.env.MASTER_PLAN_PATH,
  resolve(__dirname, '../../../..', '.agent/master-plan.md'),
  resolve(__dirname, '../../../..', 'docs/master-plan.md'),
  '/workspace/cropsintel-v3/.agent/master-plan.md',
  `${process.env.HOME}/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md`,
].filter(Boolean) as string[]

export async function ingestMasterPlan(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'master-plan' as const

  const filePath = CANDIDATE_PATHS.find(p => existsSync(p))
  if (!filePath) {
    console.warn('[master-plan] File not found at any candidate path:', CANDIDATE_PATHS)
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: ['File not found'] }
  }

  console.log(`[master-plan] Reading from ${filePath}`)
  const text = readFileSync(filePath, 'utf-8')
  const mdChunks = chunkMarkdown(text)

  const rawChunks: RawChunk[] = mdChunks.map((c, idx) => ({
    source,
    source_path: filePath,
    source_section: c.section ?? null,
    content: c.content,
    chunk_index: idx,
    metadata: extractMasterPlanMeta(c.section ?? ''),
  }))

  console.log(`[master-plan] Embedding ${rawChunks.length} chunks...`)
  const { inserted, skipped, costUsd } = await embedAndStore(rawChunks)

  const result: IngestResult = {
    source,
    chunksAdded: inserted,
    chunksSkipped: skipped,
    costUsd,
    durationMs: Date.now() - start,
    errors: [],
  }

  await writeMemoryRun({
    operation: 'ingest',
    source,
    chunks_added: inserted,
    chunks_skipped: skipped,
    cost_usd: costUsd,
    duration_ms: result.durationMs,
  })

  console.log(`[master-plan] Done: +${inserted} chunks, ${skipped} skipped, $${costUsd.toFixed(4)}`)
  return result
}

function extractMasterPlanMeta(section: string): Record<string, unknown> {
  const meta: Record<string, unknown> = { section }

  // Extract phase references like "1.6", "11.2"
  const phaseMatch = section.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
  if (phaseMatch) meta.phase = phaseMatch[1]

  // Extract agent topics
  const agentKeywords = ['zyra', 'adela', 'atlas', 'council', 'verifier', 'builder', 'memory']
  const lower = section.toLowerCase()
  const topic = agentKeywords.find(k => lower.includes(k))
  if (topic) meta.topic = topic

  return meta
}
