import { simple } from '../src/lib/multi-brain'

async function main() {
  console.log('[test-multi-brain] Calling simple("What is 2+2?") ...')
  try {
    const result = await simple('What is 2+2?')
    console.log('[test-multi-brain] Result:', JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('[test-multi-brain] Error:', err)
    process.exit(1)
  }
}

main()
