import { council } from '../council'
import { CouncilInput } from '../types'

export async function runCLI(argv: string[]): Promise<void> {
  // Find the question (first non-flag arg after 'cli')
  const args = argv.slice(argv.indexOf('cli') + 1)
  const isDeep = args.includes('--deep')
  const question = args.filter(a => !a.startsWith('--')).join(' ').trim()

  if (!question) {
    console.error('Usage: npm run council "<your question>" [--deep]')
    console.error('  Quick: npm run council "Should we use Tailwind v4 or v3?"')
    console.error('  Deep:  npm run council "How should we architect Zyra\'s 13 modules?" --deep')
    process.exit(2)
  }

  const input: CouncilInput = {
    question,
    mode: 'cli',
    depth: isDeep ? 'deep' : 'quick',
    invokedBy: `cli:${process.env.USER ?? 'agent'}`,
  }

  console.log(`\n[Council] Mode: ${input.depth.toUpperCase()} | Question: ${question.slice(0, 80)}${question.length > 80 ? '...' : ''}\n`)

  const onProgress = (msg: string) => process.stdout.write(msg + '\n')

  let exitCode = 0
  try {
    const output = await council(input, onProgress)

    console.log('\n' + '─'.repeat(80))
    console.log(output.adrMarkdown)
    console.log('─'.repeat(80))
    console.log(`\nTotal cost: $${output.costUsd.toFixed(4)} | Confidence: ${(output.confidence * 100).toFixed(0)}% | Run ID: ${output.runId}`)

    // Also write ADR to file for git history
    const fs = await import('fs')
    const path = await import('path')
    const adrDir = path.join(process.cwd(), '..', 'docs', 'adrs')
    if (!fs.existsSync(adrDir)) fs.mkdirSync(adrDir, { recursive: true })
    const adrNum = output.runId.slice(0, 8)
    const safeTitle = question.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const adrFile = path.join(adrDir, `${adrNum}-${safeTitle}.md`)
    fs.writeFileSync(adrFile, output.adrMarkdown, 'utf8')
    console.log(`\nADR saved to: ${adrFile}`)
  } catch (err) {
    console.error('\n[Council] Error:', err instanceof Error ? err.message : String(err))
    exitCode = 2
  }

  process.exit(exitCode)
}
