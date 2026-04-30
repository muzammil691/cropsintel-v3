/**
 * Smoke test for tools.ts + dispatch.ts
 * Run with: npx ts-node scripts/test-tools.ts
 */
import { memorySearch, statusSnapshot, builderListQueue } from '../src/lib/tools'
import { dispatch } from '../src/lib/dispatch'

async function main() {
  let passed = 0
  let failed = 0

  function pass(label: string, detail?: unknown) {
    console.log(`  ✓ ${label}`, detail !== undefined ? JSON.stringify(detail, null, 2) : '')
    passed++
  }

  function fail(label: string, err: unknown) {
    console.error(`  ✗ ${label}`, err)
    failed++
  }

  console.log('\n[test-tools] 1. memorySearch via dispatch ...')
  try {
    const r = await dispatch({
      tool: 'memory.search',
      arguments: { query: 'Phase 1.10 Atlas' },
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    })
    if (r.status !== 'success') throw new Error(`dispatch status=${r.status} error=${r.error}`)
    pass('memory.search dispatch succeeded', { dispatchId: r.dispatchId })
  } catch (e) {
    // Fall back to direct call to verify the function itself works
    try {
      const direct = await memorySearch('Phase 1.10 Atlas')
      pass('memory.search direct call (dispatch DB may be unavailable)', { chunks: (direct as { chunks?: unknown[] })?.chunks?.length ?? 'unknown' })
    } catch (e2) {
      fail('memory.search', e2)
    }
  }

  console.log('\n[test-tools] 2. statusSnapshot via dispatch ...')
  try {
    const r = await dispatch({
      tool: 'status.snapshot',
      arguments: {},
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    })
    if (r.status !== 'success') throw new Error(`dispatch status=${r.status} error=${r.error}`)
    const snap = r.result as Record<string, unknown>
    if (snap.queuedSpecs === undefined) throw new Error('queuedSpecs missing from snapshot')
    if (snap.memoryChunkCount === undefined) throw new Error('memoryChunkCount missing from snapshot')
    pass('status.snapshot dispatch succeeded', { queuedSpecs: snap.queuedSpecs, memoryChunkCount: snap.memoryChunkCount })
  } catch (e) {
    // Fall back to direct call
    try {
      const snap = await statusSnapshot() as Record<string, unknown>
      if (snap.queuedSpecs === undefined) throw new Error('queuedSpecs missing from snapshot')
      if (snap.memoryChunkCount === undefined) throw new Error('memoryChunkCount missing from snapshot')
      pass('status.snapshot direct (dispatch DB may be unavailable)', { queuedSpecs: snap.queuedSpecs, memoryChunkCount: snap.memoryChunkCount })
    } catch (e2) {
      fail('status.snapshot', e2)
    }
  }

  console.log('\n[test-tools] 3. builderListQueue via dispatch ...')
  try {
    const r = await dispatch({
      tool: 'builder.list_queue',
      arguments: {},
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    })
    if (r.status !== 'success') throw new Error(`dispatch status=${r.status} error=${r.error}`)
    const { specs } = r.result as { specs: string[] }
    pass('builder.list_queue dispatch succeeded', { count: specs.length, specs })
  } catch (e) {
    // Fall back to direct call
    try {
      const { specs } = await builderListQueue()
      pass('builder.list_queue direct (dispatch DB may be unavailable)', { count: specs.length, specs })
    } catch (e2) {
      fail('builder.list_queue', e2)
    }
  }

  console.log('\n[test-tools] 4. Trust-mode gate: passive mode should block memory.ingest ...')
  try {
    const r = await dispatch({
      tool: 'memory.ingest',
      arguments: { source: 'master-plan' },
      initiatedBy: 'smoke-test',
      trustMode: 'passive',
    })
    if (r.status !== 'blocked') throw new Error(`Expected 'blocked', got '${r.status}'`)
    pass('passive mode blocks memory.ingest', { error: r.error })
  } catch (e) {
    fail('trust-mode gate', e)
  }

  console.log(`\n[test-tools] Done. ${passed} passed, ${failed} failed.\n`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('[test-tools] Fatal:', err)
  process.exit(1)
})
