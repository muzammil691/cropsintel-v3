import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { chunkMarkdown } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

interface AuditDoc {
  label: string
  candidates: string[]
}

const DOCS: AuditDoc[] = [
  {
    label: 'v1-audit',
    candidates: [
      `${process.env.HOME}/Documents/Claude/Projects/Cropsintel/v3-step2-v1-audit.md`,
      '/workspace/cropsintel-v3/.agent/v1-audit.md',
    ],
  },
  {
    label: 'v2-audit',
    candidates: [
      `${process.env.HOME}/Documents/Claude/Projects/Cropsintel/v3-step3-v2-audit.md`,
      '/workspace/cropsintel-v3/.agent/v2-audit.md',
    ],
  },
  {
    label: 'v1-v2-comparative',
    candidates: [
      `${process.env.HOME}/Documents/Claude/Projects/Cropsintel/v3-step4-v1-v2-comparative.md`,
      '/workspace/cropsintel-v3/.agent/v1-v2-comparative.md',
    ],
  },
  {
    label: 'v3-coding-instructions',
    candidates: [
      resolve(__dirname, '../../../../V3-CODING-INSTRUCTIONS.md'),
      '/workspace/cropsintel-v3/V3-CODING-INSTRUCTIONS.md',
    ],
  },
]

export async function ingestAudits(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'audits' as const
  let totalInserted = 0
  let totalSkipped = 0
  let totalCost = 0
  const errors: string[] = []

  for (const doc of DOCS) {
    const filePath = doc.candidates.find(p => existsSync(p))
    if (!filePath) {
      console.warn(`[audits] ${doc.label}: not found at any candidate path`)
      errors.push(`${doc.label}: file not found`)
      continue
    }

    console.log(`[audits] Reading ${doc.label} from ${filePath}`)
    const text = readFileSync(filePath, 'utf-8')
    const mdChunks = chunkMarkdown(text)

    const rawChunks: RawChunk[] = mdChunks.map((c, idx) => ({
      source,
      source_path: doc.label,
      source_section: c.section ?? null,
      content: c.content,
      chunk_index: idx,
      metadata: { doc: doc.label, section: c.section },
    }))

    const { inserted, skipped, costUsd } = await embedAndStore(rawChunks)
    totalInserted += inserted
    totalSkipped += skipped
    totalCost += costUsd
    console.log(`[audits] ${doc.label}: +${inserted} chunks, $${costUsd.toFixed(4)}`)
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
  })

  console.log(`[audits] Done: +${totalInserted} chunks total, $${totalCost.toFixed(4)}`)
  return result
}
