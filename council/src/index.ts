import * as dotenv from 'dotenv'
dotenv.config()

const mode = process.env.COUNCIL_MODE ?? process.argv[2] ?? 'cron'

async function main(): Promise<void> {
  if (mode === 'cli') {
    const { runCLI } = await import('./modes/cli')
    await runCLI(process.argv)
  } else if (mode === 'cron') {
    const { runAutoTaskWriter } = await import('./modes/auto-task-writer')
    await runAutoTaskWriter()
  } else if (mode === 'server') {
    const { runServer } = await import('./modes/server')
    runServer()
  } else {
    console.error(`Unknown mode: ${mode}. Use: cli | cron | server`)
    process.exit(2)
  }
}

main().catch(err => {
  console.error('[Council] Fatal error:', err instanceof Error ? err.message : err)
  process.exit(2)
})
