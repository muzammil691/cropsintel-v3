import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { chunkMarkdown, chunkBySize } from '../lib/chunker'
import { embedAndStore } from '../embed'
import { writeMemoryRun } from '../lib/audit'
import { IngestResult, RawChunk } from '../types'

const CANDIDATE_PATHS = [
  process.env.WORKFLOW_DOC_PATH,
  resolve(__dirname, '../../../../docs/MAXONS_Workflow_v1.md'),
  '/workspace/cropsintel-v3/docs/MAXONS_Workflow_v1.md',
  `${process.env.HOME}/Documents/Claude/Projects/Cropsintel/MAXONS_Workflow_v1.md`,
].filter(Boolean) as string[]

export async function ingestWorkflowDoc(): Promise<IngestResult> {
  const start = Date.now()
  const source = 'workflow-doc' as const

  const filePath = CANDIDATE_PATHS.find(p => existsSync(p))
  if (!filePath) {
    console.warn('[workflow-doc] File not found at any candidate path:', CANDIDATE_PATHS)
    return { source, chunksAdded: 0, chunksSkipped: 0, costUsd: 0, durationMs: 0, errors: ['File not found'] }
  }

  console.log(`[workflow-doc] Reading from ${filePath}`)
  const text = readFileSync(filePath, 'utf-8')
  const mdChunks = chunkMarkdown(text)

  const rawChunks: RawChunk[] = mdChunks.map((c, idx) => ({
    source,
    source_path: filePath,
    source_section: c.section ?? null,
    content: c.content,
    chunk_index: idx,
    metadata: extractWorkflowMeta(c.section ?? '', c.content),
  }))

  console.log(`[workflow-doc] Embedding ${rawChunks.length} chunks...`)
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

  console.log(`[workflow-doc] Done: +${inserted} chunks, ${skipped} skipped, $${costUsd.toFixed(4)}`)
  return result
}

// Map known workflow names to numbers
const WORKFLOW_MAP: Record<string, string> = {
  'price discovery': '1',
  'enquiry management': '2',
  'offer management': '3',
  'deal conversion': '4',
  'contract management': '5',
  'shipment tracking': '6',
  'document management': '7',
  'payment tracking': '8',
  'quality management': '9',
  'compliance': '10',
  'reporting': '11',
  'customer management': '12',
  'supplier management': '13',
  'market intelligence': '14',
  'analytics': '15',
}

const DEPARTMENT_MAP: Record<string, string> = {
  'trade desk': 'Trade Desk',
  'logistics': 'Logistics',
  'finance': 'Finance',
  'quality': 'Quality',
  'compliance': 'Compliance',
  'customer service': 'Customer Service',
  'management': 'Management',
  'operations': 'Operations',
}

function extractWorkflowMeta(section: string, content: string): Record<string, unknown> {
  const meta: Record<string, unknown> = { section }
  const lower = section.toLowerCase()

  for (const [name, num] of Object.entries(WORKFLOW_MAP)) {
    if (lower.includes(name)) {
      meta.workflow = num
      meta.workflow_name = name
        .split(' ')
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join(' ')
      break
    }
  }

  for (const [key, dept] of Object.entries(DEPARTMENT_MAP)) {
    if (lower.includes(key) || content.toLowerCase().includes(key)) {
      meta.department = dept
      break
    }
  }

  return meta
}
