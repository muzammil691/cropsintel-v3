import { Command } from 'commander'
import { IngestResult, SourceName } from './types'

// ─── Ingest dispatching ──────────────────────────────────────────────────────

export async function ingestSource(source: SourceName | 'all'): Promise<IngestResult[]> {
  const { ingestMasterPlan } = await import('./ingest/master-plan')
  const { ingestWorkflowDoc } = await import('./ingest/workflow-doc')
  const { ingestAudits } = await import('./ingest/audits')
  const { ingestV2Codebase } = await import('./ingest/v2-codebase')
  const { ingestV1Codebase } = await import('./ingest/v1-codebase')
  const { ingestConversations } = await import('./ingest/conversations')
  const { ingestAdrs } = await import('./ingest/adrs')
  const { ingestGithubHistory } = await import('./ingest/github-history')

  const ALL: Record<SourceName, () => Promise<IngestResult>> = {
    'master-plan': ingestMasterPlan,
    'workflow-doc': ingestWorkflowDoc,
    'audits': ingestAudits,
    'v2-codebase': ingestV2Codebase,
    'v1-codebase': ingestV1Codebase,
    'conversations': ingestConversations,
    'adrs': ingestAdrs,
    'github-history': ingestGithubHistory,
  }

  const PRIORITY_ORDER: SourceName[] = [
    'master-plan',
    'workflow-doc',
    'audits',
    'github-history',
    'adrs',
    'conversations',
    'v2-codebase',
    'v1-codebase',
  ]

  const toRun: SourceName[] = source === 'all' ? PRIORITY_ORDER : [source as SourceName]
  const results: IngestResult[] = []

  for (const s of toRun) {
    if (!ALL[s]) {
      console.error(`Unknown source: ${s}`)
      continue
    }
    try {
      console.log(`\n${'='.repeat(60)}\nIngesting: ${s}\n${'='.repeat(60)}`)
      const result = await ALL[s]()
      results.push(result)
      printIngestResult(result)
    } catch (err) {
      console.error(`[ingest] Error ingesting ${s}:`, err)
    }
  }

  return results
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const program = new Command()
program.name('memory').description('CropsIntel V3 Memory Agent').version('0.1.0')

program
  .command('server')
  .description('Start the HTTP search server')
  .action(() => {
    const { startServer } = require('./server')
    startServer()
  })

program
  .command('ingest')
  .description('Ingest a knowledge source into memory_chunks')
  .requiredOption('--source <source>', 'Source name or "all"')
  .action(async (opts: { source: string }) => {
    const source = opts.source as SourceName | 'all'
    const start = Date.now()
    const results = await ingestSource(source)
    const totalAdded = results.reduce((sum, r) => sum + r.chunksAdded, 0)
    const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(
      `\n✅ Ingested ${totalAdded} chunks across ${results.length} source(s) in ${elapsed}s. Cost: $${totalCost.toFixed(4)}`,
    )
    process.exit(0)
  })

program
  .command('search [query...]')
  .description('Search the knowledge base')
  .option('--sources <sources>', 'Comma-separated source filter')
  .option('--limit <n>', 'Number of results', '10')
  .option('--rerank', 'Use Claude reranking', false)
  .action(async (queryParts: string[], opts: { sources?: string; limit: string; rerank: boolean }) => {
    const query = queryParts.join(' ')
    if (!query) {
      console.error('Usage: memory search "your question here"')
      process.exit(1)
    }

    const { search } = await import('./search')
    const { printSearchResult } = await import('./search')

    const sources = opts.sources
      ? (opts.sources.split(',').map(s => s.trim()) as SourceName[])
      : undefined

    const result = await search({ query, sources, limit: parseInt(opts.limit, 10), rerank: opts.rerank })
    printSearchResult(result)
    process.exit(0)
  })

program
  .command('reindex')
  .description('Delete all chunks for a source and re-ingest')
  .requiredOption('--source <source>', 'Source name to reindex')
  .action(async (opts: { source: string }) => {
    const { getSupabaseClient } = await import('./lib/supabase')
    const sb = getSupabaseClient()

    if (opts.source !== 'all') {
      console.log(`[reindex] Deleting chunks for source: ${opts.source}`)
      const { error } = await sb.from('memory_chunks').delete().eq('source', opts.source)
      if (error) {
        console.error('[reindex] Delete error:', error.message)
        process.exit(1)
      }
    } else {
      console.log('[reindex] Deleting ALL chunks')
      const { error } = await sb.from('memory_chunks').delete().neq('source', '')
      if (error) {
        console.error('[reindex] Delete error:', error.message)
        process.exit(1)
      }
    }

    console.log('[reindex] Re-ingesting...')
    await ingestSource(opts.source as SourceName | 'all')
    process.exit(0)
  })

program.parse(process.argv)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printIngestResult(r: IngestResult): void {
  const status = r.errors.length > 0 ? '⚠' : '✓'
  console.log(`${status} ${r.source}: +${r.chunksAdded} added, ${r.chunksSkipped} skipped, $${r.costUsd.toFixed(4)}, ${r.durationMs}ms`)
  if (r.errors.length > 0) {
    for (const e of r.errors.slice(0, 3)) console.log(`  ✗ ${e}`)
  }
}
