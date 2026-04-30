import { Command } from 'commander'
import { join, resolve } from 'path'
import { readdirSync, existsSync } from 'fs'
import { verify } from './verify'
import { writeVerifierRun } from './lib/audit'
import { notifyWhatsApp } from './lib/notify'
import { createRemediationTask, getCurrentCommitSha } from './lib/git'
import { VerificationResult } from './types'
import { startServer } from './server'

const REPO_ROOT = process.env.REPO_ROOT ?? join(__dirname, '..', '..')
const DONE_DIR = join(REPO_ROOT, '.agent', 'tasks', 'done')
const QUEUED_DIR = join(REPO_ROOT, '.agent', 'tasks', 'queued')

// ── Helpers ──────────────────────────────────────────────────────────────────

function findTaskFile(dir: string, taskId: string): string | null {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
  const exact = files.find(f => f === `${taskId}.md`)
  if (exact) return join(dir, exact)
  const partial = files.find(f => f.startsWith(taskId) && f.endsWith('.md'))
  if (partial) return join(dir, partial)
  return null
}

function printResult(result: VerificationResult): void {
  const status = result.passed ? '✅ PASSED' : '❌ FAILED'
  console.log(`\n${status} — ${result.taskId} (${result.durationMs}ms)`)

  if (result.gaps.length > 0) {
    console.log(`\nGaps (${result.gaps.length}):`)
    for (const gap of result.gaps) {
      const icon = gap.severity === 'fail' ? '  ✗' : '  ⚠'
      console.log(`${icon} [${gap.check}] ${gap.expected}`)
      console.log(`       actual: ${gap.actual}`)
      console.log(`       fix:    ${gap.remediation}`)
    }
  }

  if (result.judgmentCallNotes) {
    console.log(`\nAI Judgment:\n${result.judgmentCallNotes}`)
  }
  console.log()
}

// ── Commands ──────────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('verifier')
  .description('CropsIntel V3 — Verification Agent')
  .version('0.1.0')

// ── audit <task-id> ───────────────────────────────────────────────────────────
program
  .command('audit [taskId]')
  .description('Audit a specific task by ID (reads from .agent/tasks/done/)')
  .action(async (taskId: string | undefined) => {
    if (!taskId) {
      console.error('Usage: verifier audit <task-id>')
      process.exit(1)
    }

    const taskFile = findTaskFile(DONE_DIR, taskId)
    if (!taskFile) {
      console.error(`Task '${taskId}' not found in ${DONE_DIR}`)
      console.error('Available tasks:')
      if (existsSync(DONE_DIR)) {
        readdirSync(DONE_DIR)
          .filter(f => f.endsWith('.md') && !f.startsWith('_'))
          .forEach(f => console.error(`  ${f.replace('.md', '')}`))
      }
      process.exit(1)
    }

    const commitSha = getCurrentCommitSha(REPO_ROOT)
    console.log(`[verifier] Auditing: ${taskId} (${commitSha.slice(0, 8)})`)
    const result = await verify(taskFile, commitSha, 'audit-only')

    printResult(result)
    await writeVerifierRun(result, taskFile, commitSha, 'audit-only')
  })

// ── audit-all ─────────────────────────────────────────────────────────────────
program
  .command('audit-all')
  .description('Audit every task in .agent/tasks/done/')
  .action(async () => {
    if (!existsSync(DONE_DIR)) {
      console.error(`Done directory not found: ${DONE_DIR}`)
      process.exit(1)
    }

    const files = readdirSync(DONE_DIR).filter(
      f => f.endsWith('.md') && !f.startsWith('_'),
    )

    if (files.length === 0) {
      console.log('[verifier] No task files found in done/')
      return
    }

    console.log(`\n[verifier] Auditing ${files.length} tasks...\n`)
    const commitSha = getCurrentCommitSha(REPO_ROOT)

    let passed = 0
    let failed = 0

    for (const file of files) {
      const taskFile = join(DONE_DIR, file)
      const taskId = file.replace(/\.md$/, '')
      console.log(`\n${'─'.repeat(60)}`)
      console.log(`Task: ${taskId}`)
      console.log('─'.repeat(60))

      try {
        const result = await verify(taskFile, commitSha, 'audit-only')
        printResult(result)
        await writeVerifierRun(result, taskFile, commitSha, 'audit-only')
        if (result.passed) passed++
        else failed++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[verifier] Error auditing ${taskId}: ${msg}`)
        failed++
      }
    }

    console.log('═'.repeat(60))
    console.log(`[verifier] Summary: ${passed} passed, ${failed} failed out of ${files.length} tasks`)
    console.log('═'.repeat(60))
  })

// ── gate ──────────────────────────────────────────────────────────────────────
program
  .command('gate')
  .description('Gate mode: verify done tasks and queue remediations for gaps')
  .option('--task-spec <path>', 'Path to a specific task spec file to gate')
  .option('--commit-sha <sha>', 'Commit SHA to record (defaults to HEAD)')
  .action(async (opts: { taskSpec?: string; commitSha?: string }) => {
    const commitSha = opts.commitSha ?? getCurrentCommitSha(REPO_ROOT)

    if (opts.taskSpec) {
      // Single-task gate (called from agent-loop.sh before marking task done)
      const taskPath = resolve(opts.taskSpec)
      if (!existsSync(taskPath)) {
        console.error(`Task spec not found: ${taskPath}`)
        process.exit(1)
      }

      const result = await verify(taskPath, commitSha, 'gate')
      printResult(result)
      await writeVerifierRun(result, taskPath, commitSha, 'gate')

      if (!result.passed) {
        const remediationId = await createRemediationTask(result, taskPath, QUEUED_DIR)
        await writeVerifierRun(result, taskPath, commitSha, 'gate', remediationId)
        await notifyWhatsApp(`🔍 Verifier found ${result.gaps.filter(g => g.severity === 'fail').length} gap(s) in ${result.taskId}. Remediation queued.`)
        console.log(`[verifier] Gate REJECTED ${result.taskId} — remediation task created`)
        process.exit(1) // signal failure to agent-loop.sh
      }

      console.log(`[verifier] Gate APPROVED ${result.taskId}`)
      process.exit(0)
    } else {
      // Cron mode: scan done/ for unverified tasks
      await runGateCron(commitSha)
    }
  })

async function runGateCron(commitSha: string): Promise<void> {
  if (!existsSync(DONE_DIR)) {
    console.log('[verifier gate] No done/ directory found — nothing to verify')
    return
  }

  const files = readdirSync(DONE_DIR).filter(
    f => f.endsWith('.md') && !f.startsWith('_'),
  )

  if (files.length === 0) {
    console.log('[verifier gate] No tasks to verify')
    return
  }

  console.log(`[verifier gate] Scanning ${files.length} done tasks...`)

  for (const file of files) {
    const taskFile = join(DONE_DIR, file)
    const taskId = file.replace(/\.md$/, '')

    try {
      const result = await verify(taskFile, commitSha, 'gate')
      await writeVerifierRun(result, taskFile, commitSha, 'gate')

      if (!result.passed) {
        const remediationId = await createRemediationTask(result, taskFile, QUEUED_DIR)
        await writeVerifierRun(result, taskFile, commitSha, 'gate', remediationId)
        await notifyWhatsApp(
          `🔍 Verifier found ${result.gaps.filter(g => g.severity === 'fail').length} gap(s) in ${taskId}. Remediation queued.`,
        )
        console.log(`[verifier gate] ${taskId}: FAILED — remediation queued`)
      } else {
        console.log(`[verifier gate] ${taskId}: PASSED`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[verifier gate] Error on ${taskId}: ${msg}`)
    }
  }
}

// ── server ────────────────────────────────────────────────────────────────────
program
  .command('server')
  .description('Start HTTP server exposing POST /audit for agent-loop gating')
  .action(() => {
    startServer()
  })

program.parse()
