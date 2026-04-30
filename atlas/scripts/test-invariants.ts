/**
 * Smoke tests for the master plan invariants engine (invariants.ts).
 * Run with: npx ts-node scripts/test-invariants.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'
import { checkInvariants } from '../src/lib/invariants'
import type { DispatchRequest } from '../src/lib/dispatch'

async function main() {
  let passed = 0
  let failed = 0

  function pass(label: string, detail?: unknown) {
    console.log(`  ✓ ${label}`, detail !== undefined ? JSON.stringify(detail) : '')
    passed++
  }

  function fail(label: string, err: unknown) {
    console.error(`  ✗ ${label}`, err instanceof Error ? err.message : err)
    failed++
  }

  // ── Rule 1: phase order ───────────────────────────────────────────────────
  console.log('\n[test-invariants] 1. Rule 1 (phase_order): phase-1.6 blocked by phase-1.3 queued ...')

  const tempRoot = mkdtempSync(join(tmpdir(), 'atlas-inv-test-'))
  mkdirSync(resolve(tempRoot, '.agent/tasks/queued'), { recursive: true })
  mkdirSync(resolve(tempRoot, '.agent/tasks/in-progress'), { recursive: true })
  writeFileSync(resolve(tempRoot, '.agent/tasks/queued/phase-1.3-something.md'), '# Pending lower-phase task')

  const origRepoRoot = process.env.REPO_ROOT
  process.env.REPO_ROOT = tempRoot
  try {
    const req: DispatchRequest = {
      tool: 'builder.queue_spec',
      arguments: { filename: 'phase-1.6-test.md', body: '# New spec' },
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    }
    const result = await checkInvariants(req)
    if (result.allow) throw new Error('Expected allow=false but got allow=true')
    const v = result.violations.find(x => x.rule_id === 'phase_order')
    if (!v) throw new Error(`No phase_order violation found. Violations: ${JSON.stringify(result.violations)}`)
    pass('phase_order violation detected', { description: v.description })
  } catch (e) {
    fail('rule 1 (phase_order)', e)
  } finally {
    if (origRepoRoot !== undefined) process.env.REPO_ROOT = origRepoRoot
    else delete process.env.REPO_ROOT
    rmSync(tempRoot, { recursive: true, force: true })
  }

  // ── Rule 2: named layers stable ───────────────────────────────────────────
  console.log('\n[test-invariants] 2. Rule 2 (named_layers): rename Atlas blocked ...')
  try {
    const req: DispatchRequest = {
      tool: 'builder.queue_spec',
      arguments: {
        filename: 'phase-2.0-rebrand.md',
        body: 'We should rename Atlas to Prometheus for better branding in V4',
      },
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    }
    const result = await checkInvariants(req)
    if (result.allow) throw new Error('Expected allow=false but got allow=true')
    const v = result.violations.find(x => x.rule_id === 'named_layers')
    if (!v) throw new Error(`No named_layers violation found. Violations: ${JSON.stringify(result.violations)}`)
    pass('named_layers violation detected', { description: v.description })
  } catch (e) {
    fail('rule 2 (named_layers)', e)
  }

  // ── Rule 4: NEVER list ────────────────────────────────────────────────────
  console.log('\n[test-invariants] 3. Rule 4 (scope_never): Sale Contract issuance blocked ...')
  try {
    const req: DispatchRequest = {
      tool: 'builder.queue_spec',
      arguments: {
        filename: 'phase-2.5-contracts.md',
        body: 'Implement Sale Contract issuance from the order management screen',
      },
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    }
    const result = await checkInvariants(req)
    if (result.allow) throw new Error('Expected allow=false but got allow=true')
    const v = result.violations.find(x => x.rule_id === 'scope_never')
    if (!v) throw new Error(`No scope_never violation found. Violations: ${JSON.stringify(result.violations)}`)
    pass('scope_never violation detected', { description: v.description })
  } catch (e) {
    fail('rule 4 (scope_never)', e)
  }

  // ── Rule 7: client-side AI keys ───────────────────────────────────────────
  console.log('\n[test-invariants] 4. Rule 7 (no_client_keys): VITE_ANTHROPIC_API_KEY blocked ...')
  try {
    const req: DispatchRequest = {
      tool: 'builder.queue_spec',
      arguments: {
        filename: 'phase-1.5-zyra.md',
        body: 'Set VITE_ANTHROPIC_API_KEY=sk-ant-xxx in .env so Zyra chat can call Claude directly',
      },
      initiatedBy: 'smoke-test',
      trustMode: 'auto',
    }
    const result = await checkInvariants(req)
    if (result.allow) throw new Error('Expected allow=false but got allow=true')
    const v = result.violations.find(x => x.rule_id === 'no_client_keys')
    if (!v) throw new Error(`No no_client_keys violation found. Violations: ${JSON.stringify(result.violations)}`)
    pass('no_client_keys violation detected', { description: v.description })
  } catch (e) {
    fail('rule 7 (no_client_keys)', e)
  }

  console.log(`\n[test-invariants] Done. ${passed} passed, ${failed} failed.\n`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('[test-invariants] Fatal:', err)
  process.exit(1)
})
