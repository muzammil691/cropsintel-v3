import { readdir } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getSupabaseClient } from './supabase'
import { ToolName } from './tools'

const execFileP = promisify(execFile)
const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'

export interface VerificationOutcome {
  verified: boolean
  evidence: Record<string, unknown>
  error?: string
}

export interface VerifyContext {
  tool: ToolName
  arguments: Record<string, unknown>
  result: unknown
  initiatedAt: Date
}

const RETRIES = 3
const BACKOFF_MS = 200

async function withRetry(fn: () => Promise<VerificationOutcome>): Promise<VerificationOutcome> {
  let last: VerificationOutcome = { verified: false, evidence: {}, error: 'no attempts' }
  for (let i = 0; i < RETRIES; i++) {
    try {
      const r = await fn()
      if (r.verified) return r
      last = r
    } catch (err) {
      last = { verified: false, evidence: {}, error: err instanceof Error ? err.message : String(err) }
    }
    if (i < RETRIES - 1) {
      await new Promise(res => setTimeout(res, BACKOFF_MS))
    }
  }
  return last
}

async function verifyQueueSpec(ctx: VerifyContext): Promise<VerificationOutcome> {
  return withRetry(async () => {
    const filename = ctx.arguments.filename as string | undefined
    const result = ctx.result as { path?: string; sha?: string; pushed?: boolean } | null
    if (!filename) return { verified: false, evidence: {}, error: 'no filename argument' }
    if (!result) return { verified: false, evidence: {}, error: 'no tool result' }

    const queuedDir = resolve(REPO_ROOT, '.agent/tasks/queued')
    const files = await readdir(queuedDir)
    const fileExists = files.includes(filename)

    let actualHead = ''
    try {
      const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
      actualHead = stdout.trim()
    } catch (err) {
      return {
        verified: false,
        evidence: { fileInQueue: fileExists, filename },
        error: `git rev-parse failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    const shaMatches = !!result.sha && (result.sha === actualHead || result.sha === 'no-changes')
    const verified = fileExists && (result.pushed === false || shaMatches)

    return {
      verified,
      evidence: {
        fileInQueue: fileExists,
        filename,
        reportedSha: result.sha ?? null,
        actualHead,
        shaMatches,
        pushed: result.pushed ?? false,
      },
      error: verified ? undefined : `fileInQueue=${fileExists}, shaMatches=${shaMatches}`,
    }
  })
}

async function verifyCancelTask(ctx: VerifyContext): Promise<VerificationOutcome> {
  return withRetry(async () => {
    const taskId = ctx.arguments.taskId as string | undefined
    if (!taskId) return { verified: false, evidence: {}, error: 'no taskId argument' }
    const queuedDir = resolve(REPO_ROOT, '.agent/tasks/queued')
    const cancelledDir = resolve(REPO_ROOT, '.agent/tasks/cancelled')
    const queuedFiles = await readdir(queuedDir).catch(() => [] as string[])
    const cancelledFiles = await readdir(cancelledDir).catch(() => [] as string[])
    const filename = `${taskId}.md`
    const notInQueued = !queuedFiles.includes(filename)
    const inCancelled = cancelledFiles.includes(filename)
    const verified = notInQueued && inCancelled
    return {
      verified,
      evidence: { taskId, notInQueued, inCancelled },
      error: verified ? undefined : `notInQueued=${notInQueued}, inCancelled=${inCancelled}`,
    }
  })
}

async function verifyMemoryIngest(ctx: VerifyContext): Promise<VerificationOutcome> {
  return withRetry(async () => {
    const sb = getSupabaseClient()
    if (!sb) return { verified: false, evidence: {}, error: 'no supabase client' }
    const { data, error } = await sb
      .from('memory_runs')
      .select('id, ran_at, source, operation')
      .gte('ran_at', ctx.initiatedAt.toISOString())
      .order('ran_at', { ascending: false })
      .limit(1)
    if (error) return { verified: false, evidence: {}, error: error.message }
    const row = data?.[0]
    const verified = !!row
    return {
      verified,
      evidence: { runRow: row ?? null, sinceIso: ctx.initiatedAt.toISOString() },
      error: verified ? undefined : 'no memory_runs row found since dispatch initiated_at',
    }
  })
}

async function verifyAdelaTriggerScrape(ctx: VerifyContext): Promise<VerificationOutcome> {
  return withRetry(async () => {
    const sb = getSupabaseClient()
    if (!sb) return { verified: false, evidence: {}, error: 'no supabase client' }
    const { data, error } = await sb
      .from('adela_runs')
      .select('id, started_at, source')
      .gte('started_at', ctx.initiatedAt.toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
    if (error) return { verified: false, evidence: {}, error: error.message }
    const row = data?.[0]
    const verified = !!row
    return {
      verified,
      evidence: { runRow: row ?? null, sinceIso: ctx.initiatedAt.toISOString() },
      error: verified ? undefined : 'no adela_runs row found since dispatch initiated_at',
    }
  })
}

async function verifyWhatsappSend(ctx: VerifyContext): Promise<VerificationOutcome> {
  const result = ctx.result as { sid?: string; status?: string } | null
  if (!result) return { verified: false, evidence: {}, error: 'no tool result' }
  const sid = result.sid
  const status = result.status
  const acceptableStatus = !status || status === 'queued' || status === 'sent' || status === 'accepted'
  const verified = !!sid && acceptableStatus
  return {
    verified,
    evidence: { sid: sid ?? null, status: status ?? null },
    error: verified ? undefined : `sid=${sid ?? 'missing'}, status=${status ?? 'missing'}`,
  }
}

async function verifyDesignerAuditCommit(ctx: VerifyContext): Promise<VerificationOutcome> {
  const result = ctx.result as { verdict?: string } | null
  if (!result) return { verified: false, evidence: {}, error: 'no tool result' }
  const hasVerdict = typeof result.verdict === 'string' && result.verdict.length > 0
  return {
    verified: hasVerdict,
    evidence: { verdict: result.verdict ?? null },
    error: hasVerdict ? undefined : 'designer audit returned no verdict field',
  }
}

const VERIFIERS: Partial<Record<ToolName, (ctx: VerifyContext) => Promise<VerificationOutcome>>> = {
  'builder.queue_spec':    verifyQueueSpec,
  'builder.cancel_task':   verifyCancelTask,
  'memory.ingest':         verifyMemoryIngest,
  'adela.trigger_scrape':  verifyAdelaTriggerScrape,
  'whatsapp.send':         verifyWhatsappSend,
  'designer.audit_commit': verifyDesignerAuditCommit,
}

export function hasVerifier(tool: ToolName): boolean {
  return tool in VERIFIERS
}

export async function verifySideEffect(ctx: VerifyContext): Promise<VerificationOutcome | null> {
  const verifier = VERIFIERS[ctx.tool]
  if (!verifier) return null
  try {
    return await verifier(ctx)
  } catch (err) {
    return {
      verified: false,
      evidence: {},
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

