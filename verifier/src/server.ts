import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { verify } from './verify'
import { writeVerifierRun } from './lib/audit'

const REPO_ROOT = process.env.REPO_ROOT ?? join(__dirname, '..', '..')
const PORT = parseInt(process.env.PORT ?? '8080', 10)
const API_TOKEN = process.env.VERIFIER_API_TOKEN ?? ''

function findTaskSpec(taskId: string): string | null {
  const searchDirs = [
    join(REPO_ROOT, '.agent', 'tasks', 'in-progress'),
    join(REPO_ROOT, '.agent', 'tasks', 'done'),
    join(REPO_ROOT, '.agent', 'tasks', 'queued'),
  ]
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir)
    const match = files.find(
      f => f === `${taskId}.md` || (f.startsWith(taskId) && f.endsWith('.md')),
    )
    if (match) return join(dir, match)
  }
  return null
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(json)
}

async function handleAudit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = req.headers['authorization'] ?? ''
  if (API_TOKEN && auth !== `Bearer ${API_TOKEN}`) {
    send(res, 401, { error: 'unauthorized' })
    return
  }

  const rawBody = await readBody(req)
  let payload: { task_id?: string; head_before?: string; head_after?: string }
  try {
    payload = JSON.parse(rawBody) as { task_id?: string; head_before?: string; head_after?: string }
  } catch {
    send(res, 400, { error: 'invalid JSON' })
    return
  }

  const { task_id, head_before = 'unknown', head_after = 'unknown' } = payload
  if (!task_id) {
    send(res, 400, { error: 'task_id required' })
    return
  }

  const taskSpecPath = findTaskSpec(task_id)
  if (!taskSpecPath) {
    console.log(`[verifier-server] task_id '${task_id}' not found — returning unknown verdict`)
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      audit_run_id: randomUUID(),
    })
    return
  }

  console.log(`[verifier-server] auditing ${task_id} (${head_before}..${head_after}) spec=${taskSpecPath}`)

  try {
    const result = await verify(taskSpecPath, head_after, 'gate')
    await writeVerifierRun(result, taskSpecPath, head_after, 'gate')

    const hasHardFail = result.gaps.some(g => g.severity === 'fail')
    const verdict = result.passed ? 'pass' : 'fail'

    // Confidence: programmatic hard fails → high confidence (0.85 ≥ threshold)
    // warn-only fails → low confidence (0.55 < threshold, won't block)
    // pass → high confidence (0.95)
    let confidence: number
    if (result.passed) {
      confidence = 0.95
    } else if (hasHardFail) {
      confidence = 0.85
    } else {
      confidence = 0.55
    }

    send(res, 200, {
      verdict,
      confidence,
      gaps: result.gaps.map(g => ({
        description: `${g.check}: ${g.actual}`,
        severity: g.severity === 'fail' ? 'high' : 'medium',
      })),
      audit_run_id: randomUUID(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier-server] verify() error:', msg)
    // Don't block on verifier errors
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      audit_run_id: randomUUID(),
    })
  }
}

export function startServer(): void {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/audit') {
      handleAudit(req, res).catch(err => {
        console.error('[verifier-server] unhandled error:', err)
        send(res, 500, { error: 'internal server error' })
      })
    } else if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true, ts: new Date().toISOString() })
    } else {
      send(res, 404, { error: 'not found' })
    }
  })

  server.listen(PORT, () => {
    console.log(`[verifier-server] listening on :${PORT}`)
  })
}
