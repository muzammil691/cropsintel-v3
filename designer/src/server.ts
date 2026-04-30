import { createServer, IncomingMessage, ServerResponse } from 'http'
import { reviewSpec, auditCommit } from './review'
import { writeDesignerRun } from './lib/audit'
import { getApiToken, getPort } from './lib/env'

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

function authorized(req: IncomingMessage): boolean {
  const token = getApiToken()
  if (!token) return true
  return req.headers['authorization'] === `Bearer ${token}`
}

async function handleReviewSpec(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorized(req)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }

  let payload: { task_id?: string; spec_markdown?: string }
  try {
    payload = JSON.parse(await readBody(req)) as { task_id?: string; spec_markdown?: string }
  } catch {
    send(res, 400, { error: 'invalid JSON' })
    return
  }

  const { task_id, spec_markdown } = payload
  if (!task_id || !spec_markdown) {
    send(res, 400, { error: 'task_id and spec_markdown required' })
    return
  }

  console.log(`[designer-server] review-spec ${task_id}`)

  try {
    const result = await reviewSpec({ taskId: task_id, specMarkdown: spec_markdown })
    await writeDesignerRun(result)

    send(res, 200, {
      verdict: result.verdict,
      confidence: result.confidence,
      gaps: result.gaps,
      ai_judgment: {
        claude: result.aiJudgment.claude
          ? {
              verdict: result.aiJudgment.claude.verdict,
              reasoning: result.aiJudgment.claude.reasoning,
            }
          : null,
        gptVision: result.aiJudgment.gptVision
          ? {
              verdict: result.aiJudgment.gptVision.verdict,
              reasoning: result.aiJudgment.gptVision.reasoning,
            }
          : null,
      },
      cost_usd: Number(result.costUsd.toFixed(4)),
      duration_ms: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[designer-server] review-spec error:', msg)
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      ai_judgment: {},
      cost_usd: 0,
      error: msg,
    })
  }
}

async function handleAuditCommit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorized(req)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }

  let payload: {
    task_id?: string
    head_before?: string
    head_after?: string
    screenshot_url?: string
  }
  try {
    payload = JSON.parse(await readBody(req)) as typeof payload
  } catch {
    send(res, 400, { error: 'invalid JSON' })
    return
  }

  const { task_id, head_before, head_after, screenshot_url } = payload
  if (!task_id || !head_before || !head_after) {
    send(res, 400, { error: 'task_id, head_before, head_after required' })
    return
  }

  console.log(`[designer-server] audit-commit ${task_id} (${head_before}..${head_after})`)

  try {
    const result = await auditCommit({
      taskId: task_id,
      headBefore: head_before,
      headAfter: head_after,
      screenshotUrl: screenshot_url,
    })
    await writeDesignerRun(result)

    send(res, 200, {
      verdict: result.verdict,
      confidence: result.confidence,
      gaps: result.gaps,
      ai_judgment: {
        claude: result.aiJudgment.claude
          ? {
              verdict: result.aiJudgment.claude.verdict,
              reasoning: result.aiJudgment.claude.reasoning,
            }
          : null,
        gptVision: result.aiJudgment.gptVision
          ? {
              verdict: result.aiJudgment.gptVision.verdict,
              reasoning: result.aiJudgment.gptVision.reasoning,
            }
          : null,
      },
      cost_usd: Number(result.costUsd.toFixed(4)),
      duration_ms: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[designer-server] audit-commit error:', msg)
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      ai_judgment: {},
      cost_usd: 0,
      error: msg,
    })
  }
}

export function startServer(): void {
  const port = getPort()
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/designer/review-spec') {
      handleReviewSpec(req, res).catch(err => {
        console.error('[designer-server] unhandled error:', err)
        send(res, 500, { error: 'internal server error' })
      })
    } else if (req.method === 'POST' && req.url === '/designer/audit-commit') {
      handleAuditCommit(req, res).catch(err => {
        console.error('[designer-server] unhandled error:', err)
        send(res, 500, { error: 'internal server error' })
      })
    } else if (req.method === 'GET' && (req.url === '/health' || req.url === '/designer/health')) {
      send(res, 200, { ok: true, service: 'designer', ts: new Date().toISOString() })
    } else {
      send(res, 404, { error: 'not found' })
    }
  })

  server.listen(port, () => {
    console.log(`[designer-server] listening on :${port}`)
  })
}
