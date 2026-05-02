import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { verify } from './verify'
import { writeVerifierRun, writeUnknownVerifierRun } from './lib/audit'
import { runResearch, type ResearchInput } from './research'
import type { Gap } from './types'

const execFileP = promisify(execFile)

// Verifier's clone of origin/main is static after container boot; without an
// explicit fetch+reset before each audit it will check files-exist against
// whatever HEAD it had when it started. Specs that create new files always
// fail because the new files only exist on the just-pushed commit. Fix:
// fetch + reset --hard to head_after at the start of every audit.
//
// Returns true if the post-sync HEAD matches headAfter, false otherwise.
// A false return means the row should be marked unknown_reason='sync_failed'
// so the workflow-trace checker still sees a row for the commit.
async function syncRepoToHead(repoRoot: string, headAfter: string): Promise<boolean> {
  if (!headAfter || headAfter === 'unknown') return true
  try {
    await execFileP('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: repoRoot })
    await execFileP('git', ['reset', '--hard', headAfter], { cwd: repoRoot })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[verifier-server] sync to ${headAfter.slice(0, 8)} failed: ${msg.slice(0, 200)}`)
    // Fall through to verify — the post-sync HEAD log will reveal the drift.
  }

  let postSyncHead = 'unknown'
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    postSyncHead = stdout.trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[verifier-server] could not read post-sync HEAD: ${msg.slice(0, 200)}`)
  }

  console.log(
    `[verifier-server] post-sync HEAD: ${postSyncHead.slice(0, 8)} (requested ${headAfter.slice(0, 8)})`,
  )
  return postSyncHead === headAfter
}

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

  const auditStartedAt = Date.now()
  const taskSpecPath = findTaskSpec(task_id)
  if (!taskSpecPath) {
    console.log(`[verifier-server] task_id '${task_id}' not found — returning unknown verdict`)
    // Write a row anyway so the workflow-trace invariant checker can confirm
    // the audit happened. passed=NULL signals "no signal" rather than pass/fail.
    try {
      await writeUnknownVerifierRun(
        task_id,
        null,
        head_after,
        'gate',
        'spec_not_found',
        Date.now() - auditStartedAt,
      )
    } catch (writeErr) {
      const wmsg = writeErr instanceof Error ? writeErr.message : String(writeErr)
      console.error(`[verifier-server] CRITICAL: spec_not_found row write failed: ${wmsg}`)
    }
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      audit_run_id: randomUUID(),
    })
    return
  }

  console.log(`[verifier-server] auditing ${task_id} (${head_before}..${head_after}) spec=${taskSpecPath}`)

  // Sync the local clone to the commit Builder just pushed so files-exist
  // and other fs-based checks see the new files. If sync fails (post-sync
  // HEAD ≠ requested), record an unknown row and bail — verifying against
  // a stale tree produces misleading gaps.
  const synced = await syncRepoToHead(REPO_ROOT, head_after)
  if (!synced) {
    try {
      await writeUnknownVerifierRun(
        task_id,
        taskSpecPath,
        head_after,
        'gate',
        'sync_failed',
        Date.now() - auditStartedAt,
      )
    } catch (writeErr) {
      const wmsg = writeErr instanceof Error ? writeErr.message : String(writeErr)
      console.error(`[verifier-server] CRITICAL: sync_failed row write failed: ${wmsg}`)
    }
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      audit_run_id: randomUUID(),
    })
    return
  }

  let result
  try {
    result = await verify(taskSpecPath, head_after, 'gate')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier-server] verify() error:', msg)
    // Recovery write may itself reject (DB down). Don't propagate — log
    // CRITICAL and still respond verdict=unknown so agent-loop isn't blocked
    // by a Verifier that can't even write its own crash row.
    try {
      await writeUnknownVerifierRun(
        task_id,
        taskSpecPath,
        head_after,
        'gate',
        'verify_crashed',
        Date.now() - auditStartedAt,
      )
    } catch (writeErr) {
      const wmsg = writeErr instanceof Error ? writeErr.message : String(writeErr)
      console.error(`[verifier-server] CRITICAL: crash-row write also failed: ${wmsg}`)
    }
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      audit_run_id: randomUUID(),
    })
    return
  }

  // Persist the audit row BEFORE responding. If the write fails, we must
  // NOT reply verdict=pass — that would falsely attest a commit we never
  // recorded. Downgrade to verdict=unknown with unknown_reason='db_write_failed'.
  try {
    await writeVerifierRun(result, taskSpecPath, head_after, 'gate')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[verifier-server] writeVerifierRun rejected — downgrading to verdict=unknown: ${msg}`)
    try {
      await writeUnknownVerifierRun(
        task_id,
        taskSpecPath,
        head_after,
        'gate',
        'db_write_failed',
        Date.now() - auditStartedAt,
      )
    } catch (writeErr) {
      const wmsg = writeErr instanceof Error ? writeErr.message : String(writeErr)
      console.error(`[verifier-server] CRITICAL: db_write_failed recovery row also failed: ${wmsg}`)
    }
    send(res, 200, {
      verdict: 'unknown',
      confidence: 0,
      gaps: [],
      audit_run_id: randomUUID(),
    })
    return
  }

  const hasHardFail = result.gaps.some(g => g.severity === 'fail')
  // Phase 1.10v: forward result.verdict (pass/fail/inconclusive) verbatim so
  // the agent-loop can distinguish "judges disagreed and parser couldn't
  // decide" from "judges said fail". Inconclusive blocks the gate the same
  // way fail does (it is conservative-by-default); see confidence below.
  const verdict = result.verdict

  // Confidence contract — must stay aligned with agent-loop.sh's
  // VERIFIER_FAIL_CONFIDENCE_THRESHOLD (default 0.3). The loop blocks the
  // push when verdict='fail' AND confidence >= threshold. Audit H4 fixed:
  // warn-only used to emit 0.55 which (incorrectly) blocked at threshold
  // 0.3 — the comment said "won't block" but math said otherwise. Now:
  //   pass         → 0.95  (well above threshold; informational)
  //   hard fail    → 0.85  (>= threshold → blocks; deterministic check)
  //   inconclusive → 0.50  (>= threshold → blocks; needs human review)
  //   warn-only    → 0.20  (<  threshold → does NOT block; AI soft signal)
  // research.ts also short-circuits Multi-Brain debate when confidence
  // is < DEBATE_MIN_VERIFIER_CONFIDENCE (0.6) so warn-only fails skip
  // the $0.30 debate spend and are treated as surface bugs by the loop.
  let confidence: number
  if (verdict === 'pass') {
    confidence = 0.95
  } else if (verdict === 'inconclusive') {
    confidence = 0.50
  } else if (hasHardFail) {
    confidence = 0.85
  } else {
    confidence = 0.20
  }

  send(res, 200, {
    verdict,
    confidence,
    gaps: result.gaps.map(g => ({
      check: g.check,
      description: `${g.check}: ${g.actual}`,
      severity: g.severity === 'fail' ? 'high' : 'medium',
      fix: g.remediation,
    })),
    ai_judgment: result.judgmentCallNotes || undefined,
    audit_run_id: randomUUID(),
  })
}

async function handleResearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = req.headers['authorization'] ?? ''
  if (API_TOKEN && auth !== `Bearer ${API_TOKEN}`) {
    send(res, 401, { error: 'unauthorized' })
    return
  }

  const rawBody = await readBody(req)
  let payload: {
    task_id?: string
    head_before?: string
    head_after?: string
    gaps?: Gap[]
    ai_judgment?: string
    verifier_confidence?: number
  }
  try {
    payload = JSON.parse(rawBody) as typeof payload
  } catch {
    send(res, 400, { error: 'invalid JSON' })
    return
  }

  const { task_id, head_before = 'unknown', head_after = 'unknown', gaps = [], ai_judgment, verifier_confidence } = payload
  if (!task_id) {
    send(res, 400, { error: 'task_id required' })
    return
  }

  const taskSpecPath = findTaskSpec(task_id)
  let specBody: string | undefined
  if (taskSpecPath) {
    try {
      specBody = readFileSync(taskSpecPath, 'utf-8')
    } catch {
      specBody = undefined
    }
  }

  const input: ResearchInput = {
    task_id,
    head_before,
    head_after,
    gaps,
    ai_judgment,
    spec_path: taskSpecPath ?? undefined,
    spec_body: specBody,
    verifier_confidence,
  }

  console.log(`[verifier-server] research request for ${task_id} (${gaps.length} gaps, verifier_conf=${verifier_confidence ?? '?'})`)

  try {
    const result = await runResearch(input)
    send(res, 200, { ...result, run_id: randomUUID() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[verifier-server] research error:', msg)
    send(res, 200, {
      root_cause: `Research helper crashed: ${msg}`,
      recommended_fix: 'Builder should retry with the original gap list — research unavailable.',
      related_specs_to_check: [],
      confidence: 0,
      similar_failures: [],
      brains: [],
      run_id: randomUUID(),
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
    } else if (req.method === 'POST' && (req.url === '/research' || req.url === '/verifier/research')) {
      handleResearch(req, res).catch(err => {
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
