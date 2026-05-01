import { createServer, IncomingMessage, ServerResponse } from 'http'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { reviewSpec, auditCommit } from './review'
import { writeDesignerRun } from './lib/audit'
import { getApiToken, getPort, getRepoRoot } from './lib/env'
import { withGitLock } from './lib/git-mutex'

const execFileP = promisify(execFile)

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

// Pull head_after from origin/main and check out the working tree to it so
// `git diff head_before..head_after` resolves both refs locally. Without this,
// Designer's container often races Builder's push and sees "Invalid revision
// range" because head_after isn't fetched yet (Bug C, 2026-05-01).
//
// Returns the actual diff name list. Throws if fetch/checkout fails so the
// caller surfaces a `verdict: unknown` instead of silently falling back to a
// working-tree diff.
async function syncRepoToCommit(
  headBefore: string,
  headAfter: string,
): Promise<string[]> {
  const repoRoot = getRepoRoot()

  const { stdout: currentHead } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
  const alreadyAt = currentHead.trim().startsWith(headAfter)

  if (!alreadyAt) {
    try {
      await execFileP('git', ['fetch', 'origin', 'main'], { cwd: repoRoot })
      console.log(`[designer-server] git fetch ok`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`fetch failed: ${msg}`)
    }

    try {
      await execFileP('git', ['checkout', headAfter], { cwd: repoRoot })
      console.log(`[designer-server] git checkout ${headAfter} ok`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`checkout failed: ${msg}`)
    }
  } else {
    console.log(`[designer-server] HEAD already at ${headAfter} — skipping fetch`)
  }

  const { stdout: diffOut } = await execFileP(
    'git',
    ['diff', '--name-only', `${headBefore}..${headAfter}`],
    { cwd: repoRoot },
  )
  const files = diffOut
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
  console.log(`[designer-server] diff returned ${files.length} files`)
  return files
}

// Returns the repo to `main` so subsequent agent-loop git pulls aren't fighting
// a detached HEAD.
async function returnToMain(): Promise<void> {
  const repoRoot = getRepoRoot()
  try {
    await execFileP('git', ['checkout', 'main'], { cwd: repoRoot })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[designer-server] return to main failed (non-fatal): ${msg}`)
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
    // Sync the local clone to head_after under the git mutex so concurrent
    // audits / agent-loop pulls don't collide on .git/index.lock. If sync
    // fails, surface as `unknown` rather than silently auditing stale code.
    await withGitLock(`audit-commit:${task_id}`, () =>
      syncRepoToCommit(head_before, head_after),
    )

    const result = await auditCommit({
      taskId: task_id,
      headBefore: head_before,
      headAfter: head_after,
      screenshotUrl: screenshot_url,
    })
    await writeDesignerRun(result)

    // Detached HEAD after `git checkout <sha>` — return to main so the agent
    // loop's regular `git pull` doesn't error on the next tick.
    await withGitLock(`audit-commit-cleanup:${task_id}`, returnToMain)

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

    // Best-effort: log a verdict=unknown row so we have an audit trail of the
    // failure (success criterion: never silently fall back to working tree).
    try {
      await writeDesignerRun({
        taskId: task_id,
        operation: 'audit-commit',
        verdict: 'unknown',
        confidence: 0,
        gaps: [],
        aiJudgment: {},
        costUsd: 0,
        durationMs: 0,
        headBefore: head_before,
        headAfter: head_after,
        screenshotUrl: screenshot_url,
      })
    } catch (logErr) {
      console.warn('[designer-server] failed to log unknown verdict:', logErr)
    }

    // Try to return to main even on failure so the next tick is sane.
    await withGitLock(`audit-commit-cleanup-err:${task_id}`, returnToMain).catch(() => undefined)

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
