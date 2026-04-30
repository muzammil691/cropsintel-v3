import { Command } from 'commander'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { reviewSpec, auditCommit } from './review'
import { writeDesignerRun } from './lib/audit'
import { startServer } from './server'
import { getRepoRoot } from './lib/env'
import { DesignerReview } from './types'

function findTaskFile(taskId: string): string | null {
  const root = getRepoRoot()
  const dirs = [
    join(root, '.agent', 'tasks', 'in-progress'),
    join(root, '.agent', 'tasks', 'queued'),
    join(root, '.agent', 'tasks', 'done'),
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir)
    const exact = files.find(f => f === `${taskId}.md`)
    if (exact) return join(dir, exact)
    const partial = files.find(f => f.startsWith(taskId) && f.endsWith('.md'))
    if (partial) return join(dir, partial)
  }
  return null
}

function printResult(result: DesignerReview): void {
  const icon = result.verdict === 'pass' ? '✅ PASS' : result.verdict === 'fail' ? '❌ FAIL' : '❓ UNKNOWN'
  console.log(`\n${icon} — ${result.taskId} (${result.operation}, ${result.durationMs}ms, $${result.costUsd.toFixed(4)})`)
  console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`)

  if (result.gaps.length > 0) {
    console.log(`\nGaps (${result.gaps.length}):`)
    for (const gap of result.gaps) {
      const sevIcon = gap.severity === 'high' ? '✗' : gap.severity === 'medium' ? '⚠' : '·'
      const loc = gap.file ? ` ${gap.file}${gap.line ? ':' + gap.line : ''}` : ''
      console.log(`  ${sevIcon} [${gap.check}]${loc} ${gap.description}`)
      console.log(`       fix: ${gap.fix}`)
    }
  }

  if (result.aiJudgment.claude) {
    console.log(`\nClaude: ${result.aiJudgment.claude.verdict} — ${result.aiJudgment.claude.reasoning}`)
  }
  if (result.aiJudgment.gptVision) {
    console.log(`\nGPT-4o vision: ${result.aiJudgment.gptVision.verdict} — ${result.aiJudgment.gptVision.reasoning}`)
  }
  console.log()
}

const program = new Command()

program.name('designer').description('CropsIntel V3 — Designer Agent').version('0.1.0')

// review <task-id>
program
  .command('review [taskId]')
  .description('Review a task spec for design intent gaps')
  .action(async (taskId: string | undefined) => {
    if (!taskId) {
      console.error('Usage: designer review <task-id>')
      process.exit(1)
    }
    const path = findTaskFile(taskId)
    if (!path) {
      console.error(`Task '${taskId}' not found in .agent/tasks/*/`)
      process.exit(1)
    }
    const md = readFileSync(path, 'utf-8')
    console.log(`[designer] reviewing spec: ${taskId} (${path})`)
    const result = await reviewSpec({ taskId, specMarkdown: md })
    printResult(result)
    await writeDesignerRun(result)
    process.exit(result.verdict === 'fail' ? 1 : 0)
  })

// audit <task-id> <head-before> <head-after>
program
  .command('audit [taskId] [headBefore] [headAfter]')
  .description('Audit a commit range for design quality on UI changes')
  .action(async (taskId: string | undefined, headBefore: string | undefined, headAfter: string | undefined) => {
    if (!taskId || !headBefore || !headAfter) {
      console.error('Usage: designer audit <task-id> <head-before> <head-after>')
      process.exit(1)
    }
    console.log(`[designer] auditing ${taskId} (${headBefore}..${headAfter})`)
    const result = await auditCommit({ taskId, headBefore, headAfter })
    printResult(result)
    await writeDesignerRun(result)
    process.exit(result.verdict === 'fail' ? 1 : 0)
  })

// server
program
  .command('server')
  .description('Start HTTP server exposing /designer/review-spec, /designer/audit-commit')
  .action(() => {
    startServer()
  })

program.parse()
