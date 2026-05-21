import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws'
import Anthropic from '@anthropic-ai/sdk'
import { validateEnv } from './lib/env'
import { dispatch } from './lib/dispatch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { TOOLS, ToolName, builderQueueOrder, builderSetPriority, builderCancelTask, builderForceCancelTask, builderMovePosition, builderPauseTask, builderResumeTask, builderQueueSpecsBatch, verifierAudit, designerAuditCommit } from './lib/tools'
import { getSupabaseClient } from './lib/supabase'
import { getBurnRate } from './lib/cost-gate'
import {
  sendWhatsAppReply,
  sendWhatsAppReplyAutoSplit,
  sendWhatsAppMedia,
  downloadTwilioMedia,
  validateTwilioSignature,
} from './lib/twilio'
import { parseSlash, dispatchSlashCommand } from './lib/slash-commands-server'
import {
  isPhoneAllowed,
  generateOtpCode,
  insertOtp,
  countRecentOtpRequests,
  findActiveOtp,
  compareOtp,
  incrementOtpAttempts,
  markOtpUsed,
  burnAllOtpsForPhone,
  createSession,
  findSessionByToken,
  touchSessionLastSeen,
  touchMemberLogin,
  revokeSession,
  revokeAllSessionsForMember,
  listSessionsForPhone,
  consumeInviteAndCreateMember,
  sendOtpViaWhatsApp,
  roleAtLeast,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_MAX,
  type Role,
} from './lib/auth'
import {
  listMembers,
  listPendingInvites,
  createOrRefreshInvite,
  revokeInvite,
  getMember,
  getInvite,
  updateMember,
  recordTeamAudit,
  listTeamAudit,
  sendInviteWhatsApp,
  sendInviteRevokedWhatsApp,
  sendElevationRequestWhatsApp,
} from './lib/team'
import { uploadVoiceNote, VOICE_OUT_MAX_BYTES } from './lib/voice-note-storage'
import {
  uploadAttachment,
  isMimeAllowed,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_MESSAGE_MAX,
  IMAGES_PER_MESSAGE_MAX,
  downloadAttachment,
  type AttachmentRecord,
} from './lib/storage'
import { randomUUID } from 'crypto'
import { startSnapshotCron } from './cron/snapshot'
import { startConductorLoop } from './cron/conductor'
import { getCurrentMode, getModeMetadata, setMode, loadTrustModeFromDb, verifyTrustModePersistence } from './lib/trust-mode'
import { buildHonestyPrompt } from './lib/system-prompt'
import { detectIntent, buildIntentHint } from './lib/intent-detect'
import {
  streamTts,
  listVoices,
  truncateForTts,
  VOICE_DEFAULT,
  estimateTtsCostUsd,
  buildElevenLabsStreamInputUrl,
  getElevenLabsApiKey,
  generateVoiceNote,
  VOICE_NOTE_MAX_CHARS,
} from './lib/elevenlabs'
import { recordElevenLabsTtsCost, recordWhisperSttCost, getMonthlyProviderSpendUsd } from './lib/cost-log'
import {
  transcribe,
  ACCEPTED_MIME_TYPES,
  WHISPER_MAX_BYTES,
  estimateAudioSeconds,
  estimateWhisperCostUsd,
} from './lib/whisper'
import { TrustMode } from './types'
import {
  getPlanResponse,
  writePlanMarkdown,
  reorderPlanNode,
  moveItemsToDiscussion,
  listDiscussionQueue,
  resolveDiscussionItem,
  findRelatedSpecs,
  amendPlanWithClaude,
  draftPlanAmendment,
  applyPendingPlanAmendment,
  draftNewPlan,
  queueSpecFromPlanNode,
} from './lib/plan-server'
import { getWorkflowGraph, clearWorkflowCache } from './lib/workflow-parser'
import { setPlanNodeState, clearPlanNodeState } from './lib/plan-state'
import { startAddWizard, startModifyWizard, followPhase, toggleRevisit } from './lib/plan-action-handler'
// 1.10bb-c (Plan Workshop migration, Session 3): the spec-from-wizard +
// wizard-session modules were deleted. The plan-action-handler exports
// above are kept as stubs that throw — server-side wizard routes below
// return 410 Gone. Session 4 replaces the cockpit Add/Modify UI; Session 6
// ships the new /atlas/workshop/* endpoints.
import { preflight as buildRunnerPreflight, runBuild as buildRunnerRun, type BuildRunnerNode } from './lib/build-runner'
import { routeApproval, parseKeywordDecision, isApprovedWhatsAppSender } from './lib/approval-router'
import { diagnose, type ArtifactInput, type ArtifactKind as DiagnoseArtifactKind, type DiagnosisBucket } from './lib/diagnose'
import { traceArtifact, formatTraceForChat } from './lib/workflow-trace'
import { buildClaudeCodePrompt } from './lib/claude-code-prompt-builder'
import { analyzeCascade, type CascadeRelation, type CascadeGapInput } from './lib/cascade'
import { builderQueueSpec } from './lib/tools'
import {
  maybeSummarize,
  recallSummariesForQuery,
  shouldRecall,
  formatRecallSystemMessage,
} from './lib/chat-summarizer'
import {
  resolveProjectForRequest,
  setSessionLastProject,
  listProjectsForMember,
  getProjectBySlug,
  createProject,
  addProjectMember,
  removeProjectMember,
  listProjectMembers,
  getMembership,
  namespaceThreadId,
  CROPSINTEL_PROJECT_SLUG,
  type ProjectRow,
} from './lib/project-context'
import { getRepoIndex, refreshRepoIndex, startRepoIndexLoop } from './lib/repo-index'
import { getFileContent } from './lib/github-client'
import {
  queueWorkshopDiff,
  bootGitRecovery,
  getGitState,
  isQueueFrozen,
  getQueueFreezeReason,
} from './lib/queue-orchestrator'

const ELEVENLABS_BUDGET_GATE_USD = parseFloat(process.env.ATLAS_BUDGET_ELEVENLABS_GATE ?? '90')
const OPENAI_BUDGET_GATE_USD = parseFloat(process.env.ATLAS_BUDGET_OPENAI_GATE ?? '45')

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const ATLAS_API_TOKEN = process.env.ATLAS_API_TOKEN

// Railway redeploy / log-proxy config (Phase 1.10ax)
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID
const AGENT_SERVICE_IDS: Record<string, string | undefined> = {
  builder: process.env.RAILWAY_BUILDER_SERVICE_ID,
  atlas: process.env.RAILWAY_ATLAS_SERVICE_ID,
  verifier: process.env.RAILWAY_VERIFIER_SERVICE_ID,
  designer: process.env.RAILWAY_DESIGNER_SERVICE_ID,
  council: process.env.RAILWAY_COUNCIL_SERVICE_ID,
  memory: process.env.RAILWAY_MEMORY_SERVICE_ID,
  adela: process.env.RAILWAY_ADELA_SERVICE_ID,
}

// Heartbeat receiver rate-limit: max one POST per agent per 30s.
const heartbeatLastWrite = new Map<string, number>()
const HEARTBEAT_MIN_INTERVAL_MS = 30_000

// Phase 1.10ag: read atlas_config.builder_heartbeat (mirrored from the receiver
// above) and surface { spec_id, beat_at, age_seconds } in the shape the cockpit
// + reaper consume. Returns the empty shape rather than throwing if the row is
// missing — first deploy after migration may have no row yet.
interface BuilderHeartbeat {
  spec_id: string | null
  beat_at: string | null
  state: string | null
  elapsed_s: number | null
  age_seconds: number | null
}
async function readBuilderHeartbeat(): Promise<BuilderHeartbeat> {
  const empty: BuilderHeartbeat = { spec_id: null, beat_at: null, state: null, elapsed_s: null, age_seconds: null }
  const sb = getSupabaseClient()
  if (!sb) return empty
  const { data, error } = await sb.from('atlas_config').select('value, updated_at').eq('key', 'builder_heartbeat').maybeSingle()
  if (error || !data) return empty
  let parsed: Partial<BuilderHeartbeat> = {}
  try { parsed = JSON.parse(String(data.value ?? '{}')) as Partial<BuilderHeartbeat> } catch { return empty }
  const beat_at = (parsed.beat_at as string | null | undefined) ?? null
  const age_seconds = beat_at ? Math.max(0, Math.floor((Date.now() - new Date(beat_at).getTime()) / 1000)) : null
  return {
    spec_id: parsed.spec_id ?? null,
    beat_at,
    state: parsed.state ?? null,
    elapsed_s: typeof parsed.elapsed_s === 'number' ? parsed.elapsed_s : null,
    age_seconds,
  }
}

// Phase 1.10ag: cleanup-ghosts — scans .agent/tasks/in-progress/ for files that
// also exist in cancelled/, failed/, or done/. The terminal-state copy is
// canonical; the in-progress copy is the ghost (typically left by a redeploy
// that re-created the spec from a stale auto-requeue Set). Deletes the ghosts,
// commits + pushes. Returns counts so the caller can ack via cockpit.
async function cleanupGhostDuplicates(): Promise<{ pruned: number; ghosts: Array<{ file: string; also_in: string }>; pushed: boolean; sha?: string }> {
  const fs = await import('fs/promises')
  const path = await import('path')
  const repoRoot = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
  const inProgressDir = path.resolve(repoRoot, '.agent/tasks/in-progress')
  const terminalDirs = ['cancelled', 'failed', 'done'] as const

  let inProgressFiles: string[] = []
  try { inProgressFiles = await fs.readdir(inProgressDir) } catch { return { pruned: 0, ghosts: [], pushed: false } }

  const ghosts: Array<{ file: string; also_in: string }> = []
  const removedRel: string[] = []
  for (const file of inProgressFiles) {
    if (!file.endsWith('.md') || file === '_template.md') continue
    for (const dir of terminalDirs) {
      const terminalPath = path.resolve(repoRoot, `.agent/tasks/${dir}`, file)
      try {
        await fs.access(terminalPath)
        const inProgressRel = `.agent/tasks/in-progress/${file}`
        const inProgressFull = path.resolve(repoRoot, inProgressRel)
        await fs.unlink(inProgressFull)
        ghosts.push({ file, also_in: dir })
        removedRel.push(inProgressRel)
        break
      } catch { /* not in this terminal bucket */ }
    }
  }

  if (ghosts.length === 0) return { pruned: 0, ghosts: [], pushed: false }

  // Commit + push. Wrapped in withGitLock through plan-server's helper so the
  // conductor cron / chat tools never collide on .git/index.lock.
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileP = promisify(execFile)
  const { withGitLock } = await import('./lib/git-mutex.js')
  let sha: string | undefined
  let pushed = false
  await withGitLock('atlas:cleanup-ghosts', async () => {
    try { await execFileP('git', ['pull', '--rebase', 'origin', 'main'], { cwd: repoRoot }) } catch { /* keep going */ }
    for (const rel of removedRel) {
      try { await execFileP('git', ['add', rel], { cwd: repoRoot }) } catch { /* ignore */ }
    }
    try {
      await execFileP(
        'git',
        ['-c', 'user.name=Atlas', '-c', 'user.email=atlas@cropsintel.local', 'commit', '-m', `atlas: pruned ${ghosts.length} ghost duplicate${ghosts.length === 1 ? '' : 's'} from in-progress/`],
        { cwd: repoRoot },
      )
    } catch { /* nothing to commit */ }
    try {
      const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
      sha = stdout.trim()
    } catch { /* ignore */ }
    try {
      await execFileP('git', ['push', 'origin', 'main'], { cwd: repoRoot })
      pushed = true
    } catch (err) {
      console.warn('[atlas-cleanup-ghosts] push failed:', err instanceof Error ? err.message : err)
    }
  })
  return { pruned: ghosts.length, ghosts, pushed, sha }
}

// Railway logs cache (10s) — keyed by serviceId.
interface LogCacheEntry { fetchedAt: number; lines: Array<{ ts: string; line: string }> }
const railwayLogsCache = new Map<string, LogCacheEntry>()
const RAILWAY_LOGS_TTL_MS = 10_000

async function fetchRailwayLogs(serviceId: string, limit: number): Promise<Array<{ ts: string; line: string }>> {
  const cached = railwayLogsCache.get(serviceId)
  if (cached && Date.now() - cached.fetchedAt < RAILWAY_LOGS_TTL_MS) {
    return cached.lines.slice(-limit)
  }
  if (!RAILWAY_API_TOKEN || !RAILWAY_ENVIRONMENT_ID) {
    throw new Error('RAILWAY_API_TOKEN or RAILWAY_ENVIRONMENT_ID not set')
  }
  // Find the latest deployment for the service, then pull its logs.
  const deploymentsQuery = `query Deployments($serviceId: String!, $environmentId: String!) {
    deployments(input: { serviceId: $serviceId, environmentId: $environmentId }, first: 1) {
      edges { node { id status } }
    }
  }`
  const depRes = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RAILWAY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: deploymentsQuery, variables: { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID } }),
  })
  if (!depRes.ok) throw new Error(`Railway deployments ${depRes.status}: ${await depRes.text()}`)
  const depJson = (await depRes.json()) as {
    data?: { deployments?: { edges?: Array<{ node: { id: string } }> } }
    errors?: Array<{ message: string }>
  }
  if (depJson.errors?.length) throw new Error(depJson.errors.map(e => e.message).join('; '))
  const deploymentId = depJson.data?.deployments?.edges?.[0]?.node?.id
  if (!deploymentId) {
    railwayLogsCache.set(serviceId, { fetchedAt: Date.now(), lines: [] })
    return []
  }

  const logsQuery = `query DeploymentLogs($deploymentId: String!, $limit: Int!) {
    deploymentLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message }
  }`
  const logsRes = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RAILWAY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: logsQuery, variables: { deploymentId, limit: Math.min(500, Math.max(10, limit)) } }),
  })
  if (!logsRes.ok) throw new Error(`Railway logs ${logsRes.status}: ${await logsRes.text()}`)
  const logsJson = (await logsRes.json()) as {
    data?: { deploymentLogs?: Array<{ timestamp: string; message: string }> }
    errors?: Array<{ message: string }>
  }
  if (logsJson.errors?.length) throw new Error(logsJson.errors.map(e => e.message).join('; '))
  const lines = (logsJson.data?.deploymentLogs ?? []).map(l => ({ ts: l.timestamp, line: l.message }))
  railwayLogsCache.set(serviceId, { fetchedAt: Date.now(), lines })
  return lines.slice(-limit)
}

async function railwayRedeployAgent(serviceId: string): Promise<void> {
  if (!RAILWAY_API_TOKEN) throw new Error('RAILWAY_API_TOKEN not set')
  if (!RAILWAY_ENVIRONMENT_ID) throw new Error('RAILWAY_ENVIRONMENT_ID not set')
  const query = `mutation ServiceRestart($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RAILWAY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID } }),
  })
  if (!res.ok) throw new Error(`Railway API ${res.status}: ${await res.text()}`)
  const j = (await res.json()) as { errors?: Array<{ message: string }> }
  if (j.errors?.length) throw new Error(j.errors.map(e => e.message).join('; '))
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOL_DEFINITIONS = Object.entries(TOOLS).map(([name, t]) => ({
  name: name.replace('.', '_'),
  description: t.description,
  input_schema: { type: 'object' as const, properties: {}, additionalProperties: true },
}))

function getSystemPrompt(): string {
  return buildHonestyPrompt({ trustMode: getCurrentMode() })
}

// Authenticated principal — either a real user session (phone+role) or the
// service-to-service legacy bearer (Builder, conductor cron). Retains a
// `sessionId === 'service'` sentinel so the rest of the server can branch.
// Phase 1.10ao: role is carried for tool-dispatch authorization.
// Phase 1.10av: every authenticated request now resolves to exactly one
// project — projectId / projectSlug / projectRole are the per-project view of
// access. Per-project tables MUST scope every read/write by `projectId`.
export interface AuthPrincipal {
  phone: string
  sessionId: string
  role: Role
  memberId: string | null
  projectId: string
  projectSlug: string
  projectRole: Role
}

// Phase 1.10aj — Atlas now requires either a user session token (issued via
// /atlas/auth/verify-otp) OR the service bearer (ATLAS_API_TOKEN, used by
// Builder + conductor cron). User-issued tokens are 64-hex-char opaque random
// strings; only the sha256 hash is persisted. The legacy ATLAS_API_TOKEN path
// is kept exactly for the in-cluster service caller and nothing else.
async function authenticate(req: IncomingMessage): Promise<AuthPrincipal | null> {
  const auth = (req.headers['authorization'] as string | undefined) ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null

  // Service bearer — used by Builder and conductor cron. Only this exact
  // value, never anything user-derivable. Treated as 'owner' for role checks
  // so existing in-cluster paths keep working unchanged.
  if (ATLAS_API_TOKEN && token === ATLAS_API_TOKEN) {
    const project = await resolveProjectForRequest({
      req,
      sessionId: 'service',
      memberId: null,
    })
    if (!project) {
      // Service path always has access; only the bootstrap window can hit
      // this branch (no projects seeded yet). Fall back to a sentinel so the
      // legacy paths keep working.
      return {
        phone: 'service',
        sessionId: 'service',
        role: 'owner',
        memberId: null,
        projectId: '',
        projectSlug: CROPSINTEL_PROJECT_SLUG,
        projectRole: 'owner',
      }
    }
    return {
      phone: 'service',
      sessionId: 'service',
      role: 'owner',
      memberId: null,
      projectId: project.id,
      projectSlug: project.slug,
      projectRole: 'owner',
    }
  }

  // User session token — look up sha256(token) in atlas_sessions.
  const session = await findSessionByToken(token)
  if (!session) return null

  // Fire-and-forget last_seen touch so /atlas/auth/sessions reflects activity.
  touchSessionLastSeen(session.id).catch(() => {})

  // Pre-1.10ao sessions stored no role on the row (the column didn't exist).
  // Rather than force every existing session to re-auth, self-heal by looking
  // up the canonical role from atlas_members by phone. Falls closed to viewer
  // only if no member row exists at all.
  let role: Role = (session.role as Role | null) ?? 'viewer'
  let memberId = session.member_id
  if (!session.role) {
    const sb = getSupabaseClient()
    if (sb) {
      const { data: m } = await sb
        .from('atlas_members')
        .select('id, role, status')
        .eq('phone', session.phone)
        .eq('status', 'active')
        .maybeSingle()
      if (m) {
        const member = m as { id: string; role: Role; status: string }
        role = member.role
        memberId = member.id
        // Backfill the session row so the next request hits the fast path.
        sb.from('atlas_sessions')
          .update({ role: member.role, member_id: member.id })
          .eq('id', session.id)
          .then(() => {})
      }
    }
  }

  const project = await resolveProjectForRequest({
    req,
    sessionId: session.id,
    memberId,
  })
  if (!project) {
    // Authenticated but no project access → treat as 401-equivalent at the
    // wrapper layer (requireAuth surfaces 403). Returning null here keeps
    // the unauthenticated path intact for non-project-scoped endpoints.
    return null
  }

  return {
    phone: session.phone,
    sessionId: session.id,
    role,
    memberId,
    projectId: project.id,
    projectSlug: project.slug,
    projectRole: project.role,
  }
}

// Convenience: return 401 + null when unauthenticated, principal when ok.
async function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<AuthPrincipal | null> {
  const principal = await authenticate(req)
  if (!principal) {
    json(res, 401, { error: 'Unauthorized' })
    return null
  }
  return principal
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

// Audit-tab feed dedup: rows are pre-sorted DESC by time, so the first row
// per task_id is the latest. Drop tasks whose latest run passed — those are
// resolved and shouldn't generate new fix-prompts. NULL passed (verifier
// 'unknown' rows from db_write_failed / sync_failed) are kept so operators
// can see they need attention.
function collapseLatestPerTask<T extends { task_id?: string | null }>(
  rows: T[],
  taskKey: 'task_id',
  passedKey: 'passed',
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    const tid = (r[taskKey] as string | null | undefined) ?? ''
    if (!tid || seen.has(tid)) continue
    seen.add(tid)
    const passed = (r as Record<string, unknown>)[passedKey]
    if (passed === true) continue
    out.push(r)
  }
  return out
}

// Designer variant — verdict is 'pass' | 'fail' | 'unknown'.
function collapseLatestDesignerPerTask<T extends { task_id?: string | null; verdict?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    const tid = r.task_id ?? ''
    if (!tid || seen.has(tid)) continue
    seen.add(tid)
    if (r.verdict === 'pass') continue
    out.push(r)
  }
  return out
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function readBodyBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error('payload_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

interface ParsedMultipartFile {
  field: string
  filename: string
  mimeType: string
  data: Buffer
}

// Minimal multipart/form-data parser for a single audio file field.
// Sufficient for browser MediaRecorder uploads where the body is a single file part.
function parseMultipart(body: Buffer, boundary: string): ParsedMultipartFile[] {
  const dashBoundary = Buffer.from(`--${boundary}`)
  const crlf = Buffer.from('\r\n')
  const files: ParsedMultipartFile[] = []

  let offset = 0
  while (offset < body.length) {
    const start = body.indexOf(dashBoundary, offset)
    if (start < 0) break
    let cursor = start + dashBoundary.length
    // Closing boundary "--boundary--"
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break
    // Skip the trailing CRLF after boundary
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2

    // Read headers until empty line (CRLF CRLF).
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd < 0) break
    const headersRaw = body.slice(cursor, headerEnd).toString('utf-8')
    const dataStart = headerEnd + 4

    // Locate next boundary (data ends with CRLF preceding "--boundary").
    const nextBoundary = body.indexOf(dashBoundary, dataStart)
    if (nextBoundary < 0) break
    // Strip the trailing CRLF that precedes the boundary marker.
    let dataEnd = nextBoundary
    if (body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) dataEnd -= 2

    const data = body.slice(dataStart, dataEnd)

    // Parse Content-Disposition + Content-Type from headers.
    let field = ''
    let filename = ''
    let mimeType = 'application/octet-stream'
    for (const line of headersRaw.split('\r\n')) {
      const lower = line.toLowerCase()
      if (lower.startsWith('content-disposition:')) {
        const nameMatch = line.match(/name="([^"]+)"/i)
        const fileMatch = line.match(/filename="([^"]*)"/i)
        if (nameMatch) field = nameMatch[1]
        if (fileMatch) filename = fileMatch[1]
      } else if (lower.startsWith('content-type:')) {
        mimeType = line.slice('content-type:'.length).trim()
      }
    }

    if (filename) {
      files.push({ field, filename, mimeType, data })
    }
    offset = nextBoundary
    void crlf
  }
  return files
}

export async function runChatTurn(params: {
  threadId: string
  channel: string
  message: string
  overrideToken?: string
  callerRole?: Role
  onEvent?: (event: string, data: unknown) => void
  assistantMetadata?: Record<string, unknown>
  attachments?: AttachmentRecord[]
  // Phase 1.10ar — when the user clicks a timeline chip, the next message
  // arrives with a replay context describing the segment they're referencing.
  // The handler prepends a synthetic system note so Claude knows the user
  // pointed at that exact span of prior conversation.
  replayContext?: { rangeStartAt?: string; summaryLong?: string } | null
  // Phase 1.10av — project scoping. Every conversation row is filed under
  // exactly one project; queries always filter by project_id to keep multi-
  // project Atlas data isolated.
  projectId?: string
  projectSlug?: string
}): Promise<string> {
  const { threadId, channel, message, overrideToken, callerRole, onEvent, assistantMetadata, attachments, replayContext, projectId, projectSlug } = params
  const sb = getSupabaseClient()
  const trustMode = getCurrentMode()

  // Load recent conversation history (last 20 messages, scoped to project)
  let messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  if (sb) {
    let historyQuery = sb
      .from('atlas_conversations')
      .select('role, content')
      .eq('thread_id', threadId)
    if (projectId) historyQuery = historyQuery.eq('project_id', projectId)
    const { data: history } = await historyQuery
      .order('created_at', { ascending: false })
      .limit(20)
    messages = (history ?? []).reverse().map(m => ({
      role: m.role === 'atlas' ? ('assistant' as const) : ('user' as const),
      content: m.content as string,
    }))
  }

  // ─── Phase 1.10ar — replay context from a clicked timeline chip ─────────
  // When the frontend signalled the user just clicked a chip, prepend a
  // user-role primer so Claude has the prior segment's summary BEFORE the
  // user's new message arrives. We use a user-role frame (rather than mutating
  // the system prompt) because Anthropic's API treats system as a single
  // string; a per-turn primer is safer with caching.
  if (replayContext && (replayContext.summaryLong || replayContext.rangeStartAt)) {
    const tm = replayContext.rangeStartAt
      ? new Date(replayContext.rangeStartAt).toLocaleString()
      : 'an earlier moment'
    const summary = replayContext.summaryLong || '(summary missing)'
    messages.push({
      role: 'user',
      content: `[context primer — user just clicked the timeline chip from ${tm}. Summary of that segment:\n\n${summary}\n\nThe user is referencing back to that point. Acknowledge that context implicitly when answering.]`,
    })
  }

  // ─── Phase 1.10ar — backward-recall heuristic ─────────────────────────
  // If the user references prior context ("earlier", "remember", etc.) we
  // pull the top 3 chat-summary memory chunks for this thread and inject
  // them as a synthetic primer at the start of the messages array.
  if (sb && shouldRecall(message)) {
    try {
      const recalls = await recallSummariesForQuery({ threadId, query: message, topK: 3 })
      if (recalls.length > 0) {
        const recallText = formatRecallSystemMessage(recalls)
        // Prepend so it sits BEFORE the loaded last-20 history.
        messages = [{ role: 'user', content: recallText }, ...messages]
        onEvent?.('recall_hit', { count: recalls.length })
      }
    } catch (err) {
      console.warn('[chat] recall failed:', err)
    }
  }

  // Ensure the current message is appended if not already persisted.
  // When attachments accompany the message, build a multimodal content array:
  //   - image attachments → Claude vision blocks (base64-encoded bytes)
  //   - text/JSON attachments → inlined as code blocks
  //   - video/PDF/zip → URL reference (Claude can't process but is told they exist)
  const attached = attachments ?? []
  if (attached.length > 0) {
    const blocks: Array<unknown> = []
    let imagesIncluded = 0
    let textNotes: string[] = []
    for (const att of attached) {
      const mime = (att.mime || '').toLowerCase()
      if (mime.startsWith('image/') && imagesIncluded < IMAGES_PER_MESSAGE_MAX) {
        try {
          const dl = await downloadAttachment(att.storage_path)
          if (dl) {
            const b64 = dl.buffer.toString('base64')
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: mime, data: b64 },
            })
            imagesIncluded++
          }
        } catch (err) {
          textNotes.push(`(failed to attach image ${att.name}: ${err instanceof Error ? err.message : String(err)})`)
        }
      } else if (mime.startsWith('text/') || mime === 'application/json') {
        try {
          const dl = await downloadAttachment(att.storage_path)
          if (dl) {
            const text = dl.buffer.toString('utf-8').slice(0, 16000)
            textNotes.push(`Attached file ${att.name} (${mime}):\n\n\`\`\`\n${text}\n\`\`\``)
          }
        } catch {
          textNotes.push(`(failed to read text attachment ${att.name})`)
        }
      } else {
        textNotes.push(`Attached: ${att.name} (${mime}, ${att.size} bytes) — link: ${att.signed_url}`)
      }
    }
    const textPart = [message, ...textNotes].filter(Boolean).join('\n\n')
    blocks.push({ type: 'text', text: textPart })
    messages.push({ role: 'user', content: blocks as unknown })
  } else {
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== message) {
      messages.push({ role: 'user', content: message })
    }
  }

  // ─── Intent-detection hint (advisory, no LLM call) ────────────────────────
  // Runs BEFORE Claude — if a high-confidence pattern matches, we append a hidden
  // user-role message guiding the LLM toward the relevant tool. The LLM remains free
  // to ignore it.
  const intent = detectIntent(message)
  if (intent && intent.confidence >= 0.75) {
    onEvent?.('intent_hint', { tool: intent.tool, reason: intent.reason, confidence: intent.confidence, matched: intent.matched })
    messages.push({ role: 'user', content: buildIntentHint(intent) })
  }

  let totalCostUsd = 0
  let assistantText = ''
  let iteration = 0
  // D.4: track tool calls + their verified evidence so we can synthesize a
  // closing message if the LLM hits the iteration cap without a text block.
  // Without this, batch flows like "queue 8 specs" silently truncate — the
  // user sees streaming text from earlier iterations but no final summary.
  const toolCallsSummary: Array<{ tool: string; status: string; verified?: boolean | null; filename?: string | null; error?: string | null }> = []
  // D.4: iteration cap raised from 8 → 12 so batch flows have headroom for
  // their drafting + multi-tool-call cycles.
  const MAX_ITERATIONS = 12

  while (iteration < MAX_ITERATIONS) {
    iteration++
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: getSystemPrompt(),
      tools: TOOL_DEFINITIONS as Parameters<typeof anthropic.messages.create>[0]['tools'],
      messages: messages as Parameters<typeof anthropic.messages.create>[0]['messages'],
    })

    const inputCost = (response.usage.input_tokens / 1_000_000) * 3
    const outputCost = (response.usage.output_tokens / 1_000_000) * 15
    totalCostUsd += inputCost + outputCost

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    for (const block of textBlocks) {
      onEvent?.('message', { role: 'atlas', content: block.text })
      assistantText += block.text
    }

    if (toolUseBlocks.length === 0) {
      break
    }

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const toolUse of toolUseBlocks) {
      const toolName = toolUse.name.replace('_', '.') as ToolName
      onEvent?.('tool_call', { tool: toolName, arguments: toolUse.input })

      // Inject thread_id for spec-authorship tools so they can persist pending-spec rows
      // (preserved insertion order: phase, goal, then thread_id at the end).
      let toolArgs = toolUse.input as Record<string, unknown>
      if (toolName === 'atlas.propose_and_queue' && !('thread_id' in toolArgs)) {
        toolArgs = { ...toolArgs, thread_id: threadId }
      }
      // D.3: builder.queue_pending_batch needs the thread_id so it scopes to
      // specs drafted in THIS conversation, not anything pending in other threads.
      if (toolName === 'builder.queue_pending_batch' && !('thread_id' in toolArgs)) {
        toolArgs = { ...toolArgs, thread_id: threadId }
      }

      const dispatchResult = await dispatch({
        tool: toolName,
        arguments: toolArgs,
        initiatedBy: `${channel}:${threadId}`,
        trustMode,
        overrideToken,
        callerRole,
      })

      onEvent?.('tool_result', { tool: toolName, ...dispatchResult })

      // Emit spec_drafted SSE for ChatPanel preview when an Atlas spec authorship tool
      // returns successfully with markdown content.
      if (
        (toolName === 'atlas.draft_spec' || toolName === 'atlas.propose_and_queue') &&
        dispatchResult.status !== 'failed' && dispatchResult.status !== 'blocked'
      ) {
        const r = dispatchResult.result as {
          filename?: string
          markdown?: string
          spec_markdown?: string
          action?: string
          validation?: { ok: boolean; missing: string[] }
          cost_usd?: number
          queue?: { sha: string; queue_position: number; queue_size: number }
          review_verdict?: string
        } | null
        if (r) {
          onEvent?.('spec_drafted', {
            tool: toolName,
            filename: r.filename ?? null,
            markdown: r.markdown ?? r.spec_markdown ?? '',
            action: r.action ?? 'drafted',
            validation: r.validation ?? null,
            cost_usd: r.cost_usd ?? null,
            queue: r.queue ?? null,
            review_verdict: r.review_verdict ?? null,
          })
        }
      }

      if (dispatchResult.verified) {
        onEvent?.('tool_verified', {
          tool: toolName,
          dispatchId: dispatchResult.dispatchId,
          verified: dispatchResult.verified.verified,
          evidence: dispatchResult.verified.evidence,
          error: dispatchResult.verified.error ?? null,
        })
      }

      // Build the content the LLM sees. For write tools, embed verification status so the model
      // is forced to surface it (honesty rules 5 + 10).
      const llmPayload: Record<string, unknown> = {
        status: dispatchResult.status,
        result: dispatchResult.result ?? null,
        error: dispatchResult.error ?? null,
      }
      if (dispatchResult.verified) {
        llmPayload.verification = {
          verified: dispatchResult.verified.verified,
          evidence: dispatchResult.verified.evidence,
          error: dispatchResult.verified.error ?? null,
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(llmPayload),
      })

      // D.4: capture per-tool summary so we can fall back to a synthetic
      // closing message if the loop runs out of iterations.
      const toolResultObj = (dispatchResult.result ?? null) as { filename?: string; queued?: Array<{ filename: string }> } | null
      const filename = toolResultObj?.filename
        ?? (toolResultObj?.queued && toolResultObj.queued.length > 0 ? `${toolResultObj.queued.length} specs` : null)
      toolCallsSummary.push({
        tool: toolName,
        status: dispatchResult.status,
        verified: dispatchResult.verified ? dispatchResult.verified.verified : null,
        filename: filename ?? null,
        error: dispatchResult.error ?? null,
      })
    }

    messages.push({ role: 'assistant', content: response.content as unknown })
    messages.push({ role: 'user', content: toolResults as unknown })
  }

  // D.4: if the loop exited (cap hit OR toolUseBlocks=0 in last iteration)
  // but the LLM never produced a text block, synthesize one from the tool
  // call evidence so the user gets a closing summary instead of silence.
  // This is the failure mode Atlas confessed to: "I called the tools but
  // can't confirm any completed before you sent the next message."
  if (!assistantText && toolCallsSummary.length > 0) {
    const lines = toolCallsSummary.map(t => {
      const status = t.status === 'success' && t.verified === true
        ? '✓'
        : t.status === 'success' && t.verified === false
        ? '⚠ unverified'
        : t.status === 'success' && t.verified === null
        ? '✓ (no verifier)'
        : `✗ ${t.status}${t.error ? `: ${t.error.slice(0, 80)}` : ''}`
      return `- ${t.tool}${t.filename ? ` → ${t.filename}` : ''} ${status}`
    })
    const reason = iteration >= MAX_ITERATIONS
      ? `(hit ${MAX_ITERATIONS}-iteration cap)`
      : '(no closing text from model)'
    assistantText = [
      `I called ${toolCallsSummary.length} tool${toolCallsSummary.length === 1 ? '' : 's'} across ${iteration} iteration${iteration === 1 ? '' : 's'} ${reason} but didn't produce a closing summary. Here's what I confirmed:`,
      '',
      ...lines,
    ].join('\n')
    onEvent?.('message', { role: 'atlas', content: assistantText })
  }

  if (assistantText && sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: threadId,
      channel,
      role: 'atlas',
      content: assistantText,
      metadata: { totalCostUsd, iterations: iteration, ...(assistantMetadata ?? {}) },
      project_id: projectId ?? null,
    })
  }
  void projectSlug

  // Phase 1.10ar — fire-and-forget rolling summarizer. NEVER block the chat
  // response on this. The function self-rate-limits (5 min per thread) and
  // is gated by 10-min wall-clock OR 30-message thresholds.
  void (async () => {
    try {
      const result = await maybeSummarize(threadId)
      if (result.status === 'inserted') {
        console.log(`[chat] summary created for ${threadId}: ${result.summaryId} (${result.messageCount} msgs, $${result.costUsd?.toFixed(4)})`)
      }
    } catch (err) {
      console.warn('[chat] summarize failed:', err)
    }
  })()

  return assistantText
}

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const principal = await requireAuth(req, res)
  if (!principal) return

  const body = await readBody(req)
  let payload: {
    thread_id: string
    channel: string
    message: string
    attachments?: AttachmentRecord[]
    replay_context?: { rangeStartAt?: string; summaryLong?: string } | null
  }
  try {
    payload = JSON.parse(body)
  } catch {
    json(res, 400, { error: 'Invalid JSON' })
    return
  }

  if (!payload.thread_id || (!payload.message && (!payload.attachments || payload.attachments.length === 0))) {
    json(res, 400, { error: 'thread_id and message (or attachments) are required' })
    return
  }

  // Defense-in-depth: server-side cap matches storage helper. Reject more than
  // ATTACHMENTS_PER_MESSAGE_MAX even though the client also enforces this.
  const cleanAttachments = Array.isArray(payload.attachments) ? payload.attachments : []
  if (cleanAttachments.length > ATTACHMENTS_PER_MESSAGE_MAX) {
    json(res, 400, { error: `too_many_attachments`, max: ATTACHMENTS_PER_MESSAGE_MAX })
    return
  }
  const imageCount = cleanAttachments.filter(a => (a.mime || '').toLowerCase().startsWith('image/')).length
  if (imageCount > IMAGES_PER_MESSAGE_MAX) {
    json(res, 400, { error: 'too_many_images', max: IMAGES_PER_MESSAGE_MAX })
    return
  }

  // Phase 1.10av — namespace the thread by project so multi-project Atlas
  // keeps chat isolated. Legacy clients sending `web-default` get auto-prefixed.
  const namespacedThreadId = namespaceThreadId(principal.projectSlug, payload.thread_id)

  const sb = getSupabaseClient()
  if (sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: namespacedThreadId,
      channel: payload.channel || 'web',
      role: 'user',
      content: payload.message,
      metadata: cleanAttachments.length > 0 ? { attachments: cleanAttachments } : {},
      project_id: principal.projectId || null,
    })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const overrideToken = req.headers['x-budget-override'] as string | undefined

  try {
    const assistantText = await runChatTurn({
      threadId: namespacedThreadId,
      channel: payload.channel || 'web',
      message: payload.message,
      overrideToken,
      callerRole: principal.role,
      onEvent: sendEvent,
      attachments: cleanAttachments,
      replayContext: payload.replay_context ?? null,
      projectId: principal.projectId || undefined,
      projectSlug: principal.projectSlug,
    })

    sendEvent('done', { thread_id: namespacedThreadId })
    res.end()

    void assistantText // already persisted inside runChatTurn
  } catch (err) {
    sendEvent('error', { error: err instanceof Error ? err.message : String(err) })
    res.end()
  }
}

// ─── Phase 1.10am: chat attachments + URL preview ───────────────────────────
//
// POST /atlas/chat/upload — multipart/form-data with one or more file parts.
// Each file is size+type validated, uploaded to atlas-chat-attachments, and
// returned with a 6-hour signed URL. The client then echoes the returned
// AttachmentRecord(s) back in the next /atlas/chat call's `attachments` field.
async function handleChatUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const principal = await requireAuth(req, res)
  if (!principal) return

  const contentType = req.headers['content-type'] ?? ''
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundaryMatch) {
    json(res, 400, { error: 'Content-Type must be multipart/form-data' })
    return
  }
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2] ?? '').trim()
  if (!boundary) { json(res, 400, { error: 'Missing multipart boundary' }); return }

  // Cap whole body at ATTACHMENTS_PER_MESSAGE_MAX × ATTACHMENT_MAX_BYTES so a
  // single request can't pin memory on Railway. ~10 × 25MB = 250MB max.
  const MAX_BODY_BYTES = ATTACHMENTS_PER_MESSAGE_MAX * ATTACHMENT_MAX_BYTES
  let body: Buffer
  try {
    body = await readBodyBuffer(req, MAX_BODY_BYTES)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'payload_too_large') {
      json(res, 413, { error: 'payload_too_large', max_bytes: MAX_BODY_BYTES })
      return
    }
    json(res, 400, { error: 'failed_to_read_body', detail: msg })
    return
  }

  const files = parseMultipart(body, boundary)
  if (files.length === 0) { json(res, 400, { error: 'no_files' }); return }
  if (files.length > ATTACHMENTS_PER_MESSAGE_MAX) {
    json(res, 400, { error: 'too_many_files', max: ATTACHMENTS_PER_MESSAGE_MAX })
    return
  }

  // thread_id is optional but recommended — when present we file objects under
  // the thread directory so cleanup can scope by thread.
  const threadIdRaw = files.find(f => f.field === 'thread_id')?.data?.toString('utf-8')
  const threadId = (threadIdRaw && threadIdRaw.trim()) || 'web-default'
  const messageId = (files.find(f => f.field === 'message_id')?.data?.toString('utf-8')?.trim()) || randomUUID()

  // Validate every file BEFORE uploading any so we don't half-commit a batch.
  for (const f of files) {
    if (!f.filename) continue
    if (f.data.length === 0) {
      json(res, 400, { error: 'empty_file', filename: f.filename })
      return
    }
    if (f.data.length > ATTACHMENT_MAX_BYTES) {
      json(res, 413, { error: 'file_too_large', filename: f.filename, max_bytes: ATTACHMENT_MAX_BYTES })
      return
    }
    if (!isMimeAllowed(f.mimeType)) {
      json(res, 415, { error: 'unsupported_type', filename: f.filename, mime: f.mimeType })
      return
    }
  }

  const records: AttachmentRecord[] = []
  for (const f of files) {
    if (!f.filename) continue
    try {
      const rec = await uploadAttachment({
        data: f.data,
        filename: f.filename,
        mimeType: f.mimeType,
        threadId,
        messageId,
      })
      records.push(rec)
    } catch (err) {
      json(res, 500, { error: 'upload_failed', detail: err instanceof Error ? err.message : String(err) })
      return
    }
  }

  json(res, 200, { ok: true, attachments: records, message_id: messageId, thread_id: threadId })
}

// GET /atlas/chat/preview-url?url=<...> — fetch a Slack/GitHub/Linear (or any)
// URL server-side and return a small structured preview so the client can
// render an inline card. Defends against SSRF by allow-listing schemes and
// rejecting private/loopback IP literals at the URL parser level (best-effort
// — proper SSRF defense would resolve DNS server-side; out of scope here).
async function handleChatPreviewUrl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return
  const url = new URL(req.url ?? '', 'http://_')
  const target = url.searchParams.get('url') ?? ''
  if (!target) { json(res, 400, { error: 'url required' }); return }
  let parsed: URL
  try { parsed = new URL(target) } catch { json(res, 400, { error: 'invalid_url' }); return }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    json(res, 400, { error: 'unsupported_scheme' })
    return
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
    json(res, 400, { error: 'forbidden_host' })
    return
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      // Bound how much HTML we'll parse — 256 KB is plenty for og: tags.
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (CropsIntel Atlas Preview)' },
    })
    if (!upstream.ok) {
      json(res, 502, { error: 'upstream_error', status: upstream.status })
      return
    }
    const reader = upstream.body?.getReader()
    if (!reader) { json(res, 502, { error: 'no_body' }); return }
    const PREVIEW_MAX = 256 * 1024
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        total += value.length
        if (total > PREVIEW_MAX) break
        chunks.push(value)
      }
    }
    try { reader.cancel() } catch { /* ignore */ }
    const html = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8')

    const meta = (prop: string): string | null => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')
      const m = re.exec(html)
      return m ? m[1] : null
    }
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
    const ogTitle = meta('og:title') ?? meta('twitter:title')
    const ogDesc = meta('og:description') ?? meta('description') ?? meta('twitter:description')
    const ogImage = meta('og:image') ?? meta('twitter:image')
    const ogSite = meta('og:site_name')

    json(res, 200, {
      ok: true,
      url: parsed.toString(),
      host: parsed.hostname,
      title: ogTitle ?? (titleMatch ? titleMatch[1].trim() : null),
      description: ogDesc,
      image: ogImage,
      site_name: ogSite,
    })
  } catch (err) {
    json(res, 502, { error: 'fetch_failed', detail: err instanceof Error ? err.message : String(err) })
  }
}

// Public URL Atlas presents to Twilio for the inbound webhook. Used to compute
// the expected HMAC for signature validation; if not set we skip validation
// (e.g. local dev without a public tunnel).
const TWILIO_INBOUND_PUBLIC_URL = process.env.TWILIO_INBOUND_PUBLIC_URL ?? ''
const TWILIO_VALIDATE_SIGNATURE = process.env.TWILIO_VALIDATE_SIGNATURE !== 'false'

const VOICE_TOGGLE_DISABLE = /^\s*disable\s+voice\s*$/i
const VOICE_TOGGLE_ENABLE = /^\s*enable\s+voice\s*$/i

async function handleWhatsAppInbound(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  const params = new URLSearchParams(body)

  const from = params.get('From')
  // Phase 1.10aw — voice STT parity. Twilio Programmable Voice surfaces the
  // user's transcript in `SpeechResult` (separate from WhatsApp text in
  // `Body`). Treat them as equivalent inputs so a phoned-in "/status" or "queue"
  // routes through the same parseSlash → dispatchSlashCommand pipeline as a
  // typed message. Body wins when both are populated (defensive default —
  // shouldn't happen in practice). NEVER list compliance: SpeechResult is
  // never logged at full fidelity; downstream we only persist the parsed
  // command name.
  const speechResult = params.get('SpeechResult') ?? ''
  const rawBody = params.get('Body') ?? ''
  const messageBody = rawBody || speechResult
  const messageSid = params.get('MessageSid')
  const numMedia = parseInt(params.get('NumMedia') ?? '0', 10)
  const mediaUrl0 = params.get('MediaUrl0') ?? undefined
  const mediaType0 = params.get('MediaContentType0') ?? undefined

  // Either a non-empty body (text or voice transcript) OR at least one media
  // attachment is required.
  if (!from || (!messageBody && numMedia === 0)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Missing From, Body, or media')
    return
  }

  // Validate Twilio signature when configured. Reject unsigned webhooks unless
  // explicitly disabled (set TWILIO_VALIDATE_SIGNATURE=false for local dev).
  if (TWILIO_VALIDATE_SIGNATURE && TWILIO_INBOUND_PUBLIC_URL) {
    const sigHeader = (req.headers['x-twilio-signature'] as string | undefined) ?? null
    const formMap: Record<string, string> = {}
    for (const [k, v] of params.entries()) formMap[k] = v
    const ok = validateTwilioSignature({
      expectedUrl: TWILIO_INBOUND_PUBLIC_URL,
      formParams: formMap,
      signatureHeader: sigHeader,
    })
    if (!ok) {
      console.warn('[whatsapp-inbound] signature validation FAILED — rejecting')
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('signature_invalid')
      return
    }
  }

  // Acknowledge to Twilio immediately (within 10s SLA)
  res.writeHead(200, { 'Content-Type': 'text/xml' })
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')

  // Process async — don't block the webhook
  processWhatsAppMessage({
    from,
    body: messageBody,
    messageSid,
    numMedia,
    mediaUrl0,
    mediaType0,
  }).catch(err =>
    console.error('[whatsapp-inbound] processing error:', err),
  )
}

interface VoicePrefs {
  voice_replies_enabled: boolean
  preferred_voice_id: string | null
}

async function getVoicePrefs(phone: string): Promise<VoicePrefs> {
  const sb = getSupabaseClient()
  if (!sb) return { voice_replies_enabled: true, preferred_voice_id: null }
  const { data } = await sb
    .from('atlas_user_prefs')
    .select('voice_replies_enabled, preferred_voice_id')
    .eq('user_phone', phone)
    .maybeSingle()
  if (!data) return { voice_replies_enabled: true, preferred_voice_id: null }
  return {
    voice_replies_enabled: Boolean((data as { voice_replies_enabled: boolean }).voice_replies_enabled),
    preferred_voice_id: (data as { preferred_voice_id: string | null }).preferred_voice_id,
  }
}

async function setVoicePrefs(phone: string, enabled: boolean): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb.from('atlas_user_prefs').upsert(
    { user_phone: phone, voice_replies_enabled: enabled, updated_at: new Date().toISOString() },
    { onConflict: 'user_phone' },
  )
}

interface ProcessParams {
  from: string
  body: string
  messageSid: string | null
  numMedia: number
  mediaUrl0?: string
  mediaType0?: string
}

// Single-user system (Phase 1.10aj): collapse all channels onto one thread so
// the user's phone WhatsApp, the open web tab, and live mode all share one
// timeline. This is what the Realtime subscription on the dashboard listens
// to — change here also requires updating the channel filter in the browser.
const ATLAS_SINGLE_THREAD_ID = 'web-default'

async function processWhatsAppMessage(params: ProcessParams): Promise<void> {
  const { from, body, messageSid, numMedia, mediaUrl0, mediaType0 } = params
  const sb = getSupabaseClient()
  const fromPhone = from.replace('whatsapp:', '')

  // Phase 1.10av — WhatsApp inbound goes to the default project (cropsintel-v3
  // for now). Per-user project routing for WhatsApp is a future spec; until
  // then every WhatsApp message lives under the cropsintel-v3 namespace.
  const wsProject = await getProjectBySlug(CROPSINTEL_PROJECT_SLUG)
  const wsProjectId = wsProject?.id ?? null
  const wsProjectSlug = wsProject?.slug ?? CROPSINTEL_PROJECT_SLUG
  const threadId = namespaceThreadId(wsProjectSlug, ATLAS_SINGLE_THREAD_ID)

  let inboundText = body
  let isVoiceNote = false
  let inboundAudioSeconds = 0
  const userMetadata: Record<string, unknown> = { from, messageSid }

  // ─── Voice-note inbound path ──────────────────────────────────────────────
  // Download immediately (Twilio media URLs expire ~24 h, but we never persist
  // the URL — we only use it once to fetch the bytes for Whisper). The audio
  // buffer itself is held only in memory for the duration of transcription.
  if (numMedia > 0 && mediaUrl0 && mediaType0?.toLowerCase().startsWith('audio/')) {
    isVoiceNote = true
    try {
      const dl = await downloadTwilioMedia(mediaUrl0)
      inboundAudioSeconds = estimateAudioSeconds(dl.buffer.length)
      const mime = dl.contentType.split(';')[0].trim() || mediaType0
      const filename = mime.includes('ogg') ? 'voice.ogg' : 'voice.mp3'
      const result = await transcribe(dl.buffer, mime, filename)
      inboundText = result.text.trim()
      userMetadata.voice_note = true
      userMetadata.audio_mime = mime
      userMetadata.audio_seconds = inboundAudioSeconds
      userMetadata.transcribe_latency_ms = result.durationMs
      // Cost log for Whisper (the inbound side of this voice turn).
      void recordWhisperSttCost(inboundAudioSeconds, {
        bytes: dl.buffer.length,
        mime_type: mime,
        channel: 'whatsapp',
        from_phone: fromPhone,
      })
    } catch (err) {
      console.error('[whatsapp-inbound] voice transcription failed:', err)
      // Inform the user so they're not left hanging.
      const msg = 'Sorry — I could not transcribe that voice note. Could you try again, or send it as text?'
      await sendWhatsAppReply(from, msg)
      if (sb) {
        await sb.from('atlas_conversations').insert({
          thread_id: threadId,
          channel: 'whatsapp',
          role: 'user',
          content: '[voice note: transcription failed]',
          metadata: { ...userMetadata, voice_note: true, transcription_error: err instanceof Error ? err.message : String(err) },
          project_id: wsProjectId,
        })
      }
      return
    }

    if (!inboundText) {
      // Empty transcript — likely silent audio. Tell the user.
      await sendWhatsAppReply(from, 'I got the voice note but the audio came through empty. Could you re-send?')
      return
    }
  }

  // ─── Voice opt-in toggle (text only) ──────────────────────────────────────
  if (!isVoiceNote && VOICE_TOGGLE_DISABLE.test(inboundText)) {
    await setVoicePrefs(fromPhone, false)
    await sendWhatsAppReply(from, 'Voice replies disabled. Send "enable voice" to turn them back on.')
    if (sb) {
      await sb.from('atlas_conversations').insert({
        thread_id: threadId,
        channel: 'whatsapp',
        role: 'user',
        content: inboundText,
        metadata: { ...userMetadata, command: 'disable_voice' },
        project_id: wsProjectId,
      })
    }
    return
  }
  if (!isVoiceNote && VOICE_TOGGLE_ENABLE.test(inboundText)) {
    await setVoicePrefs(fromPhone, true)
    await sendWhatsAppReply(from, 'Voice replies enabled. Send "disable voice" to turn them off.')
    if (sb) {
      await sb.from('atlas_conversations').insert({
        thread_id: threadId,
        channel: 'whatsapp',
        role: 'user',
        content: inboundText,
        metadata: { ...userMetadata, command: 'enable_voice' },
        project_id: wsProjectId,
      })
    }
    return
  }

  if (sb) {
    await sb.from('atlas_conversations').insert({
      thread_id: threadId,
      channel: 'whatsapp',
      role: 'user',
      content: inboundText,
      metadata: userMetadata,
      project_id: wsProjectId,
    })
  }

  // Look up the sender's role from atlas_members so the WhatsApp chat path
  // honours role-based tool gates the same way the web chat does. Unknown
  // phones (no member row) default to 'viewer' — fail closed.
  const allow = await isPhoneAllowed(fromPhone)
  const callerRole: Role = allow.allowed ? allow.role : 'viewer'

  // ─── Phase 1.10aw — slash command short-circuit ──────────────────────────
  // Recognized slash / voice-prefix commands (e.g. "/status", "slash queue",
  // bare "help") run server-side without going through the chat LLM. This
  // gives instant replies for queue/cost/agent inspections.
  const parsedSlash = parseSlash(inboundText)
  if (parsedSlash) {
    const principal: AuthPrincipalForSlash = {
      phone: fromPhone,
      sessionId: 'whatsapp',
      role: callerRole,
      memberId: allow.allowed ? allow.memberId : null,
    }
    const result = await dispatchSlashCommand(parsedSlash, principal)
    const replyText = result.text
    if (sb) {
      await sb.from('atlas_conversations').insert({
        thread_id: threadId,
        channel: 'whatsapp',
        role: 'atlas',
        content: replyText,
        metadata: {
          slash_command: parsedSlash.name,
          from_voice_note: isVoiceNote,
          dispatch_cost_usd: result.cost_usd ?? 0,
        },
        project_id: wsProjectId,
      })
    }
    await sendAtlasReply({
      toWhatsApp: from,
      threadId,
      replyText,
      triggeredByVoiceNote: isVoiceNote,
    })
    return
  }

  // Run the chat turn — emits the assistant row with combined metadata.
  const assistantMetadata: Record<string, unknown> = { from_voice_note: isVoiceNote }
  const assistantText = await runChatTurn({
    threadId,
    channel: 'whatsapp',
    message: inboundText,
    callerRole,
    assistantMetadata,
    projectId: wsProjectId ?? undefined,
    projectSlug: wsProjectSlug,
  })

  await sendAtlasReply({
    toWhatsApp: from,
    threadId,
    replyText: assistantText,
    triggeredByVoiceNote: isVoiceNote,
  })
}

// Local alias to keep the slash dispatcher's principal shape isolated from the
// server's full AuthPrincipal (no session id for WhatsApp callers — they
// authenticate by phone number, not session token).
type AuthPrincipalForSlash = {
  phone: string
  sessionId: string
  role: Role
  memberId: string | null
}

// Sends the reply back to the user. Always sends a text body; additionally
// generates an ElevenLabs voice note when the user has voice replies enabled
// and the ElevenLabs monthly budget gate has not been tripped.
async function sendAtlasReply(params: {
  toWhatsApp: string
  threadId: string
  replyText: string
  triggeredByVoiceNote: boolean
}): Promise<void> {
  const { toWhatsApp, threadId, replyText, triggeredByVoiceNote } = params
  const fromPhone = toWhatsApp.replace('whatsapp:', '')
  if (!replyText) return

  // 1. Always send text first so the user gets *something* even if voice fails.
  // Auto-split sentence-aware so long Atlas answers don't get truncated by
  // Twilio's 1600-char cap (Phase 1.10aw).
  const textResult = await sendWhatsAppReplyAutoSplit(toWhatsApp, replyText)
  if (textResult.errors.length > 0) {
    console.error('[whatsapp-inbound] reply failed:', textResult.errors.join('; '))
    if (textResult.sids.length === 0) return
  }
  console.log(`[whatsapp-inbound] replied with ${textResult.sids.length} part(s) sid=${textResult.sids.join(',')}`)

  // 2. Determine whether to also send a voice note.
  const prefs = await getVoicePrefs(fromPhone)
  if (!prefs.voice_replies_enabled) {
    console.log(`[whatsapp-inbound] voice replies disabled for ${fromPhone}`)
    return
  }

  // Budget gate — skip TTS if monthly ElevenLabs spend is past the cap.
  const monthSpend = await getMonthlyProviderSpendUsd('elevenlabs')
  const projected = monthSpend + estimateTtsCostUsd(Math.min(replyText.length, VOICE_NOTE_MAX_CHARS))
  if (monthSpend >= ELEVENLABS_BUDGET_GATE_USD || projected >= ELEVENLABS_BUDGET_GATE_USD) {
    console.warn(
      `[whatsapp-inbound] skipping voice reply — elevenlabs month_to_date=${monthSpend.toFixed(2)} gate=${ELEVENLABS_BUDGET_GATE_USD}`,
    )
    return
  }

  try {
    const voiceId = prefs.preferred_voice_id || VOICE_DEFAULT
    const tts = await generateVoiceNote(replyText, voiceId)

    // Defense in depth: hard-truncate by bytes too. ElevenLabs Turbo at 32 kHz mono
    // is well under the 2 MB ceiling for 1500 chars, but we still bail out rather
    // than send a malformed payload to Twilio.
    if (tts.audio.length === 0 || tts.audio.length > VOICE_OUT_MAX_BYTES) {
      console.warn(`[whatsapp-inbound] voice audio out of bounds (${tts.audio.length}); skipping`)
      return
    }

    const messageId = randomUUID()
    const upload = await uploadVoiceNote({ audio: tts.audio, threadId, messageId })

    const mediaResult = await sendWhatsAppMedia(toWhatsApp, upload.signedUrl)
    if ('error' in mediaResult) {
      console.error('[whatsapp-inbound] voice media send failed:', mediaResult.error)
      return
    }
    console.log(`[whatsapp-inbound] voice note sent sid=${mediaResult.sid} bytes=${tts.audio.length}`)

    // Cost log for the outbound TTS leg.
    void recordElevenLabsTtsCost(tts.charCount, voiceId, {
      transport: 'whatsapp_voice_note',
      truncated: tts.truncated,
      thread_id: threadId,
      message_id: messageId,
      triggered_by_voice_note: triggeredByVoiceNote,
    })

    // Annotate the assistant row so we can audit which turns produced voice.
    const sb = getSupabaseClient()
    if (sb) {
      const { data: latest } = await sb
        .from('atlas_conversations')
        .select('id, metadata')
        .eq('thread_id', threadId)
        .eq('role', 'atlas')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest) {
        const merged = {
          ...((latest as { metadata: Record<string, unknown> }).metadata ?? {}),
          has_voice_reply: true,
          voice_id: voiceId,
          voice_truncated: tts.truncated,
          voice_message_sid: mediaResult.sid,
          voice_storage_path: upload.path,
          voice_bytes: tts.audio.length,
        }
        await sb
          .from('atlas_conversations')
          .update({ metadata: merged })
          .eq('id', (latest as { id: string }).id)
      }
    }
  } catch (err) {
    console.error('[whatsapp-inbound] voice reply error:', err)
  }
}

async function handleTtsVoices(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return
  try {
    const voices = await listVoices()
    const summary = voices.map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category ?? null,
      labels: v.labels ?? null,
      preview_url: v.preview_url ?? null,
    }))
    json(res, 200, { voices: summary })
  } catch (err) {
    json(res, 502, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleTts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await requireAuth(req, res))) return

  const body = await readBody(req)
  let payload: { text?: string; voice_id?: string }
  try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }

  const rawText = (payload.text ?? '').trim()
  if (!rawText) { json(res, 400, { error: 'text is required' }); return }
  const voiceId = payload.voice_id || VOICE_DEFAULT

  const text = truncateForTts(rawText)
  const charCount = text.length

  // Budget gate: 90% of $100 cap default. If month-to-date elevenlabs spend
  // already exceeds the gate, refuse before calling the API.
  const monthSpend = await getMonthlyProviderSpendUsd('elevenlabs')
  const projected = monthSpend + estimateTtsCostUsd(charCount)
  if (monthSpend >= ELEVENLABS_BUDGET_GATE_USD || projected >= ELEVENLABS_BUDGET_GATE_USD) {
    json(res, 429, {
      error: 'budget_exceeded',
      message: 'TTS disabled — monthly cap approaching.',
      month_to_date_usd: monthSpend,
      gate_usd: ELEVENLABS_BUDGET_GATE_USD,
    })
    return
  }

  let upstream: Response
  try {
    upstream = await streamTts(text, voiceId)
  } catch (err) {
    json(res, 502, { error: err instanceof Error ? err.message : String(err) })
    return
  }

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => '')
    json(res, upstream.status || 502, {
      error: 'elevenlabs_upstream_error',
      status: upstream.status,
      detail: errBody.slice(0, 500),
    })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-store',
    'X-Atlas-Tts-Chars': String(charCount),
    'X-Atlas-Tts-Voice': voiceId,
  })

  // Stream upstream audio chunks straight to the client.
  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    console.error('[atlas-tts] stream error:', err)
    try { res.end() } catch { /* ignore */ }
  }

  // Log cost after the stream finishes (don't block the response).
  void recordElevenLabsTtsCost(charCount, voiceId, { truncated: rawText.length > text.length })
}

async function handleStt(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const principal = await requireAuth(req, res)
  if (!principal) return

  const contentType = req.headers['content-type'] ?? ''
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundaryMatch) {
    json(res, 400, { error: 'Content-Type must be multipart/form-data' })
    return
  }
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2] ?? '').trim()
  if (!boundary) { json(res, 400, { error: 'Missing multipart boundary' }); return }

  // Budget gate: if month-to-date OpenAI spend already at or near the cap, refuse.
  const monthSpend = await getMonthlyProviderSpendUsd('openai')
  if (monthSpend >= OPENAI_BUDGET_GATE_USD) {
    json(res, 429, {
      error: 'budget_exceeded',
      message: 'STT disabled — monthly OpenAI cap approaching.',
      month_to_date_usd: monthSpend,
      gate_usd: OPENAI_BUDGET_GATE_USD,
    })
    return
  }

  let body: Buffer
  try {
    body = await readBodyBuffer(req, WHISPER_MAX_BYTES)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'payload_too_large') {
      json(res, 413, { error: 'audio_too_large', max_bytes: WHISPER_MAX_BYTES })
      return
    }
    json(res, 400, { error: 'failed_to_read_body', detail: msg })
    return
  }

  const files = parseMultipart(body, boundary)
  const audioFile = files.find(f => f.field === 'audio') ?? files[0]
  if (!audioFile) { json(res, 400, { error: 'No audio file in request' }); return }

  const mimeBase = audioFile.mimeType.split(';')[0].trim().toLowerCase()
  const accepted = ACCEPTED_MIME_TYPES.some(t => t.split(';')[0] === mimeBase)
  if (!accepted) {
    json(res, 415, { error: 'unsupported_audio_type', mime_type: audioFile.mimeType, accepted: ACCEPTED_MIME_TYPES })
    return
  }

  let result: { text: string; durationMs: number }
  try {
    result = await transcribe(audioFile.data, audioFile.mimeType, audioFile.filename || 'audio.webm')
  } catch (err) {
    json(res, 502, { error: 'whisper_failed', detail: err instanceof Error ? err.message : String(err) })
    return
  }

  const audioSeconds = estimateAudioSeconds(audioFile.data.length)
  const costUsd = estimateWhisperCostUsd(audioSeconds)

  // Phase 1.10am: persist user mic audio so the message bubble can offer a
  // "Play your audio" replay button. Soft-fails — if storage is mis-configured
  // the STT transcript still returns to the client.
  let userAudio: { storage_path: string; signed_url: string; mime: string; bytes: number } | null = null
  try {
    const messageId = randomUUID()
    const ext = audioFile.mimeType.includes('mp4') ? 'mp4'
      : audioFile.mimeType.includes('wav') ? 'wav'
      : audioFile.mimeType.includes('mpeg') || audioFile.mimeType.includes('mp3') ? 'mp3'
      : 'webm'
    const rec = await uploadAttachment({
      data: audioFile.data,
      filename: `user-${messageId}.${ext}`,
      mimeType: audioFile.mimeType,
      threadId: 'web-default',
      messageId,
      subPath: 'audio/user',
    })
    userAudio = {
      storage_path: rec.storage_path,
      signed_url: rec.signed_url,
      mime: audioFile.mimeType,
      bytes: audioFile.data.length,
    }
  } catch (err) {
    // Log + swallow — STT response must still succeed.
    console.warn('[stt] audio persistence failed:', err instanceof Error ? err.message : String(err))
  }

  json(res, 200, {
    transcript: result.text,
    duration_ms: result.durationMs,
    audio_seconds: audioSeconds,
    cost_usd: costUsd,
    audio: userAudio,
  })

  // Log cost after responding; never block the client on the cost-log write.
  void recordWhisperSttCost(audioSeconds, {
    bytes: audioFile.data.length,
    mime_type: audioFile.mimeType,
    transcribe_latency_ms: result.durationMs,
    user_phone: principal.phone,
  })
}

// ─── Live-mode TTS WebSocket bridge ────────────────────────────────────────
// Browser opens its own WS to `/atlas/tts-ws` (Bearer token in Sec-WebSocket-Protocol);
// this handler opens an upstream WS to ElevenLabs `stream-input`, pipes text → audio
// chunks back to the dashboard, and tracks character count for cost logging.
async function authenticateWs(req: IncomingMessage): Promise<{ ok: boolean; protocol?: string }> {
  // Browsers can't set a Bearer header on a WebSocket; clients pass the token via
  // Sec-WebSocket-Protocol as `bearer.<token>` (echoed back as the chosen subprotocol).
  const proto = req.headers['sec-websocket-protocol']
  const offers = (Array.isArray(proto) ? proto.join(',') : (proto ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const o of offers) {
    if (!o.startsWith('bearer.')) continue
    const token = o.slice('bearer.'.length)
    if (!token) continue
    // Service bearer for Builder / cron callers.
    if (ATLAS_API_TOKEN && token === ATLAS_API_TOKEN) {
      return { ok: true, protocol: o }
    }
    // User session token issued by /atlas/auth/verify-otp.
    const session = await findSessionByToken(token)
    if (session) {
      touchSessionLastSeen(session.id).catch(() => {})
      return { ok: true, protocol: o }
    }
  }
  return { ok: false }
}

interface DownstreamMessage {
  type: 'open' | 'text' | 'flush' | 'close' | 'heartbeat-ack' | 'turn-start' | 'thinking-start' | 'thinking-end'
  voiceId?: string
  text?: string
}

// Phase 1.10am: filler library for live mode. When Atlas is "thinking" for
// more than 2s, server picks one and streams it via the upstream TTS WS so
// the user hears continuous audio instead of dead air. Kept short on purpose.
const LIVE_MODE_FILLERS = [
  'Just a moment, let me think.',
  'Hmm, let me work that out.',
  'One second, processing.',
  'Okay, give me a beat.',
  'Right, working on it.',
] as const

const HEARTBEAT_INTERVAL_MS = 20_000
const FILLER_DELAY_MS = 2000

function attachTtsWebSocket(server: ReturnType<typeof createServer>): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/atlas/tts-ws') {
      socket.destroy()
      return
    }
    void (async () => {
      const auth = await authenticateWs(req)
      if (!auth.ok) {
        try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n') } catch { /* ignore */ }
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, auth.protocol)
      })
    })()
  })

  wss.on('connection', (ws: WsWebSocket, _req: IncomingMessage, protocol?: string) => {
    void _req
    void protocol
    let upstream: WsWebSocket | null = null
    let voiceId: string = VOICE_DEFAULT
    let charCount = 0
    let upstreamOpened = false
    let upstreamReady = false
    const pendingText: string[] = []
    let pendingFlush = false
    let closed = false
    // Phase 1.10am: heartbeat + filler timers
    let heartbeatTimer: NodeJS.Timeout | null = null
    let fillerTimer: NodeJS.Timeout | null = null
    let inThinking = false
    let fillerSent = false
    const sessionStart = Date.now()
    const voiceSessionId = randomUUID()

    const clearHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    }
    const clearFiller = () => {
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null }
      inThinking = false
      fillerSent = false
    }

    const cleanup = () => {
      if (closed) return
      closed = true
      clearHeartbeat()
      clearFiller()
      try { upstream?.close() } catch { /* ignore */ }
      upstream = null
      // Log cost (one row per WS session) — never block on this.
      if (charCount > 0) {
        void recordElevenLabsTtsCost(charCount, voiceId, { transport: 'ws_stream', live_mode: true })
      }
      // Persist a row in atlas_voice_sessions so we can audit live-mode usage.
      const sb = getSupabaseClient()
      if (sb) {
        const durationSec = (Date.now() - sessionStart) / 1000
        void sb.from('atlas_voice_sessions').insert({
          id: voiceSessionId,
          thread_id: 'web-default',
          phone: 'live-mode',
          started_at: new Date(sessionStart).toISOString(),
          ended_at: new Date().toISOString(),
          atlas_speech_seconds: Math.round(durationSec * 100) / 100,
          end_reason: 'cleanup',
          metadata: { transport: 'ws_stream', char_count: charCount },
        })
      }
    }

    const safeSend = (data: string | Buffer) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(data) } catch { /* ignore */ }
      }
    }

    const sendError = (error: string, detail?: string) => {
      safeSend(JSON.stringify({ type: 'error', error, detail }))
    }

    const flushPending = () => {
      if (!upstream || !upstreamReady) return
      while (pendingText.length > 0) {
        const text = pendingText.shift()!
        try {
          upstream.send(JSON.stringify({ text, try_trigger_generation: true }))
        } catch (err) {
          sendError('upstream_send_failed', err instanceof Error ? err.message : String(err))
        }
      }
      if (pendingFlush) {
        pendingFlush = false
        try { upstream.send(JSON.stringify({ text: '' })) } catch { /* ignore */ }
      }
    }

    const openUpstream = (vid: string) => {
      if (upstreamOpened) return
      upstreamOpened = true
      voiceId = vid || VOICE_DEFAULT

      const apiKey = getElevenLabsApiKey()
      if (!apiKey) {
        sendError('elevenlabs_not_configured', 'ELEVENLABS_API_KEY missing on server')
        try { ws.close(1011) } catch { /* ignore */ }
        return
      }

      try {
        upstream = new WsWebSocket(buildElevenLabsStreamInputUrl(voiceId), {
          headers: { 'xi-api-key': apiKey },
        })
      } catch (err) {
        sendError('upstream_open_failed', err instanceof Error ? err.message : String(err))
        try { ws.close(1011) } catch { /* ignore */ }
        return
      }

      upstream.on('open', () => {
        upstreamReady = true
        // ElevenLabs requires an initial empty `text: " "` to prime generation.
        try {
          upstream?.send(JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            xi_api_key: apiKey,
          }))
        } catch { /* ignore */ }
        safeSend(JSON.stringify({ type: 'ready', voice_id: voiceId }))
        flushPending()
      })

      upstream.on('message', (raw) => {
        // ElevenLabs returns JSON text frames containing { audio: <base64>, isFinal, normalizedAlignment }.
        // Forward verbatim to the browser; the browser decodes base64 → Web Audio.
        try {
          const txt = typeof raw === 'string' ? raw : raw.toString('utf-8')
          safeSend(txt)
        } catch (err) {
          sendError('forward_failed', err instanceof Error ? err.message : String(err))
        }
      })

      upstream.on('close', () => {
        safeSend(JSON.stringify({ type: 'upstream_closed' }))
      })

      upstream.on('error', (err) => {
        sendError('upstream_error', err instanceof Error ? err.message : String(err))
      })
    }

    ws.on('message', async (raw) => {
      let msg: DownstreamMessage
      try {
        msg = JSON.parse(raw.toString()) as DownstreamMessage
      } catch {
        sendError('invalid_json')
        return
      }

      if (msg.type === 'open') {
        // Budget gate before opening upstream — refuse if monthly TTS spend already past cap.
        const monthSpend = await getMonthlyProviderSpendUsd('elevenlabs')
        if (monthSpend >= ELEVENLABS_BUDGET_GATE_USD) {
          safeSend(JSON.stringify({
            type: 'budget_exceeded',
            month_to_date_usd: monthSpend,
            gate_usd: ELEVENLABS_BUDGET_GATE_USD,
          }))
          try { ws.close(1011) } catch { /* ignore */ }
          return
        }
        openUpstream(msg.voiceId ?? VOICE_DEFAULT)
        // Start heartbeat once upstream is opened. Railway proxies idle out
        // sockets after ~60s of silence, so we need to send something at least
        // every 20s during quiet windows.
        clearHeartbeat()
        heartbeatTimer = setInterval(() => {
          if (closed || ws.readyState !== ws.OPEN) return
          safeSend(JSON.stringify({ type: 'heartbeat', t: Date.now() }))
        }, HEARTBEAT_INTERVAL_MS)
        return
      }

      if (msg.type === 'text') {
        const t = (msg.text ?? '').toString()
        if (!t) return
        // First text after thinking-start cancels the filler timer.
        clearFiller()
        charCount += t.length
        pendingText.push(t)
        flushPending()
        return
      }

      if (msg.type === 'flush') {
        pendingFlush = true
        flushPending()
        // Atlas finished its turn — signal end-of-turn to the client so the UI
        // state machine can flip out of 'speaking' deterministically.
        safeSend(JSON.stringify({ type: 'turn-end', reason: 'atlas-finished' }))
        return
      }

      if (msg.type === 'thinking-start') {
        // Client tells us "Atlas is generating, no audio coming yet" — start
        // the filler countdown. If text arrives before FILLER_DELAY_MS the
        // filler is cancelled.
        inThinking = true
        fillerSent = false
        clearFiller()
        fillerTimer = setTimeout(() => {
          if (!inThinking || fillerSent || closed) return
          fillerSent = true
          const filler = LIVE_MODE_FILLERS[Math.floor(Math.random() * LIVE_MODE_FILLERS.length)]
          charCount += filler.length
          pendingText.push(filler)
          pendingFlush = true
          flushPending()
        }, FILLER_DELAY_MS)
        return
      }

      if (msg.type === 'thinking-end') {
        clearFiller()
        return
      }

      if (msg.type === 'heartbeat-ack') {
        // Quiet ack — nothing to do beyond keeping the socket alive.
        return
      }

      if (msg.type === 'close') {
        cleanup()
        try { ws.close(1000) } catch { /* ignore */ }
        return
      }
    })

    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })
}

export async function startServer(): Promise<void> {
  validateEnv()
  await loadTrustModeFromDb()

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    // ─── CORS — allow browser clients (Atlas dashboard at github.io) to reach this API
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, PUT, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With')
    res.setHeader('Access-Control-Max-Age', '86400')
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (url === '/health' && method === 'GET') {
      // 1.10bd: surface git_state + queue_frozen so the operator can detect
      // ahead-of-remote / diverged / frozen states without SSHing into Railway.
      const gitState = await getGitState()
      json(res, 200, {
        status: 'ok',
        service: 'cropsintel-atlas',
        version: '0.1.0',
        trust_mode: getCurrentMode(),
        ts: new Date().toISOString(),
        git_state: gitState,
        queue_frozen: isQueueFrozen(),
        queue_freeze_reason: getQueueFreezeReason(),
      })
      return
    }

    // ─── Auth endpoints (Phase 1.10aj) ──────────────────────────────────────
    // Public: /atlas/auth/request-otp, /atlas/auth/verify-otp.
    // Auth required: logout, me, sessions, sessions/:id/revoke.

    if (url === '/atlas/auth/request-otp' && method === 'POST') {
      const body = await readBody(req)
      let payload: { phone?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      const phone = (payload.phone ?? '').trim()
      if (!phone) { json(res, 400, { error: 'phone required' }); return }
      // DB-backed allowlist (Phase 1.10ao): active member OR pending invite.
      // Suspended/revoked accounts fail at this gate; not_invited as well.
      const allow = await isPhoneAllowed(phone)
      if (!allow.allowed) {
        if (allow.reason === 'suspended') { json(res, 403, { error: 'account_suspended' }); return }
        if (allow.reason === 'revoked') { json(res, 403, { error: 'account_revoked' }); return }
        if (allow.reason === 'pending_invite') {
          // Allow OTP for an invitee — first-login path consumes the invite on verify.
          // Fall through.
        } else {
          json(res, 403, { error: 'phone_not_allowed' })
          return
        }
      }
      // Rate limit BEFORE generating + sending so floods don't burn Twilio cost.
      const recent = await countRecentOtpRequests(phone)
      if (recent >= OTP_RATE_LIMIT_MAX) {
        json(res, 429, { error: 'rate_limited', retry_after_sec: 15 * 60 })
        return
      }
      const code = generateOtpCode()
      const inserted = await insertOtp(phone, code)
      if (!inserted) {
        json(res, 503, { error: 'otp_persist_failed' })
        return
      }
      const sent = await sendOtpViaWhatsApp(phone, code)
      if (!sent) {
        // Don't leak that the row was created — but we must respond honestly.
        json(res, 502, { error: 'whatsapp_send_failed' })
        return
      }
      json(res, 200, { ok: true, expires_in: OTP_TTL_SECONDS })
      return
    }

    if (url === '/atlas/auth/verify-otp' && method === 'POST') {
      const body = await readBody(req)
      let payload: { phone?: string; code?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      const phone = (payload.phone ?? '').trim()
      const code = (payload.code ?? '').trim()
      if (!phone || !code) { json(res, 400, { error: 'phone and code required' }); return }
      const allow = await isPhoneAllowed(phone)
      if (!allow.allowed && allow.reason !== 'pending_invite') {
        json(res, 401, { error: 'invalid_credentials' })
        return
      }

      const otp = await findActiveOtp(phone)
      if (!otp) { json(res, 401, { error: 'invalid_credentials' }); return }

      // Attempt cap — burn ALL outstanding OTPs for this phone so the attacker
      // can't grind on any of the rows they may have stacked up.
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        await burnAllOtpsForPhone(phone)
        json(res, 401, { error: 'too_many_attempts' })
        return
      }

      const matches = await compareOtp(code, otp.code_hash)
      if (!matches) {
        await incrementOtpAttempts(otp.id, otp.attempts)
        json(res, 401, { error: 'invalid_credentials' })
        return
      }

      // Mark this OTP used + mint a session.
      await markOtpUsed(otp.id)
      // Defense-in-depth: also burn any other unused codes for this phone so a
      // recently issued spare can't be used to mint a second session silently.
      await burnAllOtpsForPhone(phone)

      // First-login flow: consume the invite + create the member row atomically.
      let memberId: string
      let role: Role
      if (allow.allowed) {
        memberId = allow.memberId
        role = allow.role
      } else {
        // pending_invite path
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'session_persist_failed' }); return }
        const { data: inviteRow } = await sb
          .from('atlas_invites')
          .select('id, role, display_name, invited_by')
          .eq('id', allow.inviteId)
          .maybeSingle()
        if (!inviteRow) { json(res, 401, { error: 'invalid_credentials' }); return }
        const inv = inviteRow as { id: string; role: 'admin' | 'operator' | 'viewer'; display_name: string | null; invited_by: string }
        const consumed = await consumeInviteAndCreateMember({
          inviteId: inv.id,
          phone,
          role: inv.role,
          displayName: inv.display_name,
          invitedBy: inv.invited_by,
        })
        if (!consumed) { json(res, 503, { error: 'session_persist_failed' }); return }
        memberId = consumed.memberId
        role = inv.role
        // Audit the consumption.
        await recordTeamAudit({
          actorId: inv.invited_by,
          actorPhone: 'system',
          action: 'invite_consumed',
          targetMemberId: memberId,
          targetInviteId: inv.id,
          targetPhone: phone,
          details: { role },
        })
      }

      // Stamp first_login_at + last_seen_at on the member row.
      await touchMemberLogin(memberId)

      const userAgent = (req.headers['user-agent'] as string | undefined) ?? null
      const fwd = (req.headers['x-forwarded-for'] as string | undefined)
        ?? (req.socket?.remoteAddress ?? '')
      const ip = (typeof fwd === 'string' ? fwd.split(',')[0] : '').trim() || null

      const session = await createSession({
        phone,
        memberId,
        role,
        userAgent: userAgent ?? undefined,
        ip: ip ?? undefined,
      })
      if (!session) { json(res, 503, { error: 'session_persist_failed' }); return }

      json(res, 200, { ok: true, token: session.token, session_id: session.sessionId, role })
      return
    }

    if (url === '/atlas/auth/logout' && method === 'POST') {
      const principal = await authenticate(req)
      if (!principal || principal.sessionId === 'service') {
        // Service callers don't have a real session to revoke. Return 401 so
        // the dashboard treats it as a failed logout and clears local state.
        json(res, 401, { error: 'Unauthorized' })
        return
      }
      await revokeSession(principal.sessionId)
      json(res, 200, { ok: true })
      return
    }

    if (url === '/atlas/auth/me' && method === 'GET') {
      const principal = await authenticate(req)
      if (!principal) { json(res, 401, { error: 'Unauthorized' }); return }
      // Service callers — return a stub so internal probes can still introspect.
      if (principal.sessionId === 'service') {
        json(res, 200, {
          phone: 'service',
          session_id: 'service',
          device_label: 'service',
          role: 'owner',
          member_id: null,
          display_name: 'service',
          created_at: null,
          last_seen_at: null,
        })
        return
      }
      // Look the session row back up to surface device_label / timestamps to the UI.
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
      const { data } = await sb
        .from('atlas_sessions')
        .select('id, phone, device_label, created_at, last_seen_at, role, member_id')
        .eq('id', principal.sessionId)
        .maybeSingle()
      if (!data) { json(res, 401, { error: 'Unauthorized' }); return }
      const row = data as {
        id: string
        phone: string
        device_label: string | null
        created_at: string
        last_seen_at: string
        role: string | null
        member_id: string | null
      }
      let displayName: string | null = null
      if (row.member_id) {
        const m = await getMember(row.member_id)
        displayName = m?.display_name ?? null
      }
      json(res, 200, {
        phone: row.phone,
        session_id: row.id,
        device_label: row.device_label,
        role: row.role ?? principal.role,
        member_id: row.member_id,
        display_name: displayName,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
      })
      return
    }

    if (url === '/atlas/auth/sessions' && method === 'GET') {
      const principal = await authenticate(req)
      if (!principal) { json(res, 401, { error: 'Unauthorized' }); return }
      if (principal.sessionId === 'service') { json(res, 200, { sessions: [] }); return }
      const rows = await listSessionsForPhone(principal.phone)
      json(res, 200, {
        sessions: rows.map((r) => ({
          id: r.id,
          device_label: r.device_label,
          user_agent: r.user_agent,
          created_at: r.created_at,
          last_seen_at: r.last_seen_at,
          current: r.id === principal.sessionId,
        })),
      })
      return
    }

    {
      const revokeMatch = url.match(/^\/atlas\/auth\/sessions\/([0-9a-f-]{36})\/revoke$/i)
      if (revokeMatch && method === 'POST') {
        const principal = await authenticate(req)
        if (!principal) { json(res, 401, { error: 'Unauthorized' }); return }
        if (principal.sessionId === 'service') { json(res, 403, { error: 'forbidden' }); return }
        // Authorize: only sessions belonging to the same phone may be revoked.
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const targetId = revokeMatch[1]
        const { data } = await sb
          .from('atlas_sessions')
          .select('id, phone')
          .eq('id', targetId)
          .maybeSingle()
        if (!data || (data as { phone: string }).phone !== principal.phone) {
          json(res, 404, { error: 'not_found' })
          return
        }
        await revokeSession(targetId)
        json(res, 200, { ok: true, id: targetId })
        return
      }
    }

    if (url === '/atlas/mode' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      json(res, 200, getModeMetadata())
      return
    }

    // ─── GitHub repo reader (Phase 1.10ak) ──────────────────────────────────
    // Read-only endpoints surfacing the cached repo index + on-demand file
    // contents. Index read requires auth; file read + manual refresh require
    // admin so we don't accidentally expose every file in the repo to a
    // viewer-tier session.
    if (url === '/atlas/repo/index' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const idx = await getRepoIndex()
      if (!idx) {
        json(res, 200, { index: null, reason: 'github_pat_missing_or_unbuilt' })
        return
      }
      json(res, 200, { index: idx })
      return
    }

    if (method === 'GET' && url.startsWith('/atlas/repo/file')) {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const parsed = new URL(url, 'http://_')
      const path = parsed.searchParams.get('path')?.trim() ?? ''
      if (!path) { json(res, 400, { error: 'path required' }); return }
      const content = await getFileContent(path)
      if (content === null) {
        json(res, 404, { error: 'not_found_or_binary' })
        return
      }
      json(res, 200, { path, content })
      return
    }

    if (url === '/atlas/repo/refresh-index' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const idx = await refreshRepoIndex()
      if (!idx) {
        json(res, 503, { error: 'refresh_failed', reason: 'github_pat_missing_or_fetch_failed' })
        return
      }
      json(res, 200, { ok: true, index: idx })
      return
    }

    // Phase 1.10al — GET /atlas/repo/idea returns the current `.agent/idea.md`
    // content (canonical product vision). Falls back to local repo read if
    // GITHUB_PAT is missing so the cockpit drawer renders even offline. Auth
    // required (any role); contents are non-secret but session-scoped.
    if (url === '/atlas/repo/idea' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      let content = await getFileContent('.agent/idea.md')
      let source: 'github' | 'local' | 'missing' = 'github'
      if (content === null) {
        try {
          const fs = await import('fs/promises')
          const path = await import('path')
          const localPath = path.resolve(process.env.REPO_ROOT ?? '/workspace/cropsintel-v3', '.agent/idea.md')
          content = await fs.readFile(localPath, 'utf-8')
          source = 'local'
        } catch {
          source = 'missing'
        }
      }
      if (content === null) {
        json(res, 404, { error: 'idea_file_missing', source })
        return
      }
      json(res, 200, { content, source })
      return
    }

    // GET /atlas/conversations/<threadId>/summaries?limit=N — Phase 1.10ar
    // chat-summary timeline rows for the cockpit horizontal bar.
    {
      const summaryMatch = method === 'GET' && url.startsWith('/atlas/conversations/')
        ? url.match(/^\/atlas\/conversations\/([^/?]+)\/summaries(?:\?(.*))?$/)
        : null
      if (summaryMatch) {
        const principal = await requireAuth(req, res)
        if (!principal) return
        const rawThreadId = decodeURIComponent(summaryMatch[1])
        if (!rawThreadId) { json(res, 400, { error: 'threadId required' }); return }
        const threadId = namespaceThreadId(principal.projectSlug, rawThreadId)
        const qs = new URLSearchParams(summaryMatch[2] ?? '')
        const limitRaw = qs.get('limit')
        const limit = Math.min(Math.max(parseInt(limitRaw ?? '30', 10) || 30, 1), 200)
        const sb = getSupabaseClient()
        if (!sb) { json(res, 200, { summaries: [] }); return }
        let q = sb
          .from('atlas_chat_summaries')
          .select('id, range_start_at, range_end_at, range_start_msg_id, range_end_msg_id, message_count, summary_short, topics, created_at')
          .eq('thread_id', threadId)
        if (principal.projectId) q = q.eq('project_id', principal.projectId)
        const { data, error } = await q
          .order('range_end_at', { ascending: false })
          .limit(limit)
        if (error) {
          json(res, 500, { error: `summaries query failed: ${error.message ?? JSON.stringify(error)}` })
          return
        }
        json(res, 200, { summaries: data ?? [] })
        return
      }
    }

    // GET /atlas/conversations/<threadId>?limit=N — chat history for the thread.
    // Returns the most recent N messages in chronological order so the UI can
    // re-hydrate the chat after a page refresh.
    if (method === 'GET' && url.startsWith('/atlas/conversations/')) {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const parsed = new URL(url, 'http://_')
      const rawThreadId = decodeURIComponent(parsed.pathname.replace('/atlas/conversations/', ''))
      if (!rawThreadId) { json(res, 400, { error: 'threadId required' }); return }
      const threadId = namespaceThreadId(principal.projectSlug, rawThreadId)
      const limitRaw = parsed.searchParams.get('limit')
      const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 200)
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, []); return }
      let q = sb
        .from('atlas_conversations')
        .select('id, role, content, metadata, created_at')
        .eq('thread_id', threadId)
      if (principal.projectId) q = q.eq('project_id', principal.projectId)
      const { data, error } = await q
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) {
        json(res, 500, { error: `history query failed: ${error.message ?? JSON.stringify(error)}` })
        return
      }
      const rows = (data ?? []).reverse().map(r => ({
        id: r.id as string,
        role: r.role === 'atlas' ? 'assistant' : (r.role as 'user' | 'assistant'),
        content: r.content as string,
        metadata: r.metadata as Record<string, unknown> | undefined,
        created_at: r.created_at as string,
      }))
      json(res, 200, rows)
      return
    }

    if (url === '/atlas/mode' && method === 'POST') {
      if (!(await requireAuth(req, res))) return
      const body = await readBody(req)
      let payload: { mode: TrustMode; setBy?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      try {
        await setMode(payload.mode, payload.setBy ?? 'api')
        json(res, 200, { ok: true, ...getModeMetadata(), success: true })
      } catch (err) {
        // Distinguish bad-input (400) from persist-failure (500) so callers can
        // tell whether to retry. Validation errors come from setMode's known
        // "Invalid trust mode: …" path; everything else is a real server-side
        // failure (DB persist failure, missing client) and MUST surface as 500
        // — otherwise the dashboard sees 200 and the mode silently reverts on
        // next service restart (the bug spec 1.10y was filed to fix and 1.10af
        // re-asserted with the {ok:false,error} response contract).
        const msg = err instanceof Error ? err.message : String(err)
        const isValidationError = msg.startsWith('Invalid trust mode:')
        json(res, isValidationError ? 400 : 500, { ok: false, error: msg })
      }
      return
    }

    if (url === '/atlas/chat' && method === 'POST') {
      await handleChat(req, res)
      return
    }

    if (url === '/atlas/chat/upload' && method === 'POST') {
      await handleChatUpload(req, res)
      return
    }

    if ((url ?? '').split('?')[0] === '/atlas/chat/preview-url' && method === 'GET') {
      await handleChatPreviewUrl(req, res)
      return
    }

    if (url === '/atlas/tts' && method === 'POST') {
      await handleTts(req, res)
      return
    }

    if (url === '/atlas/tts/voices' && method === 'GET') {
      await handleTtsVoices(req, res)
      return
    }

    if (url === '/atlas/stt' && method === 'POST') {
      await handleStt(req, res)
      return
    }

    if (url === '/atlas/costs' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      json(res, 200, await getBurnRate())
      return
    }

    if (url === '/atlas/status' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sbStatus = getSupabaseClient()
      if (!sbStatus) { json(res, 503, { error: 'Supabase not configured' }); return }
      const { data } = await sbStatus.from('atlas_snapshots').select('*').order('taken_at', { ascending: false }).limit(1).maybeSingle()
      json(res, 200, data ?? { error: 'No snapshot yet — try again in 5 minutes' })
      return
    }

    if (url === '/atlas/artifacts/pending-specs' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { specs: [] }); return }
      let q = sb
        .from('atlas_pending_specs')
        .select('id, thread_id, spec_markdown, filename, drafted_at, expires_at')
        .is('resolved_at', null)
      if (principal.projectId) q = q.eq('project_id', principal.projectId)
      const { data, error } = await q
        .order('drafted_at', { ascending: false })
        .limit(20)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { specs: data ?? [] })
      return
    }

    // D.2: batch queue-all. Reads ALL unresolved pending specs for the
    // principal, queues them in ONE git push via builderQueueSpecsBatch,
    // marks all newly-queued rows resolved. The user's failure mode (8 specs
    // queued individually + iteration cap) collapses to one tool call.
    if (url === '/atlas/artifacts/pending-specs/queue-all' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      let pendingQuery = sb
        .from('atlas_pending_specs')
        .select('id, spec_markdown, filename')
        .is('resolved_at', null)
      if (principal.projectId) pendingQuery = pendingQuery.eq('project_id', principal.projectId)
      const { data: rows, error: fetchErr } = await pendingQuery
        .order('drafted_at', { ascending: true })  // oldest first so the queue order matches draft order
        .limit(50)
      if (fetchErr) { json(res, 500, { error: `pending_spec_lookup_failed: ${fetchErr.message}` }); return }
      const pendingRows = (rows ?? []) as Array<{ id: string; spec_markdown: string; filename: string }>
      if (pendingRows.length === 0) {
        json(res, 200, { ok: true, queued: [], failed: [], sha: 'no-changes', pushed: false })
        return
      }
      try {
        const result = await builderQueueSpecsBatch(
          pendingRows.map(r => ({ filename: r.filename, body: r.spec_markdown })),
        )
        // Mark every row whose filename succeeded as resolved=queued. Failures stay open.
        const queuedFilenames = new Set(result.queued.map(q => q.filename))
        const queuedIds = pendingRows.filter(r => queuedFilenames.has(r.filename)).map(r => r.id)
        if (queuedIds.length > 0) {
          await sb.from('atlas_pending_specs')
            .update({ resolved_at: new Date().toISOString(), resolution: 'queued' })
            .in('id', queuedIds)
        }
        json(res, 200, {
          ok: true,
          queued: result.queued,
          failed: result.failed,
          sha: result.sha,
          pushed: result.pushed,
        })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // D.1: real Queue button on PendingSpecCard. Reads the staged spec from
    // atlas_pending_specs, calls builderQueueSpec (which refuses duplicates
    // per b88ba04), and marks the row resolved=queued. Closes the UX trap
    // where the old Queue button just dismissed the card without queueing.
    {
      const m = url.match(/^\/atlas\/artifacts\/pending-specs\/([^/]+)\/queue$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const specId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        // Fetch the staged spec — verify ownership + not-already-resolved.
        let pendingQuery = sb
          .from('atlas_pending_specs')
          .select('id, thread_id, spec_markdown, filename, project_id, resolved_at')
          .eq('id', specId)
          .limit(1)
        if (principal.projectId) pendingQuery = pendingQuery.eq('project_id', principal.projectId)
        const { data: rows, error: fetchErr } = await pendingQuery
        if (fetchErr) { json(res, 500, { error: `pending_spec_lookup_failed: ${fetchErr.message}` }); return }
        const pending = (rows ?? [])[0] as { id: string; spec_markdown: string; filename: string; resolved_at: string | null } | undefined
        if (!pending) { json(res, 404, { error: 'pending_spec_not_found' }); return }
        if (pending.resolved_at) { json(res, 409, { error: 'pending_spec_already_resolved' }); return }
        // Call the real queue path. builderQueueSpec throws on duplicate-against-tree.
        try {
          const result = await builderQueueSpec(pending.filename, pending.spec_markdown)
          await sb.from('atlas_pending_specs')
            .update({ resolved_at: new Date().toISOString(), resolution: 'queued' })
            .eq('id', specId)
          json(res, 200, { ok: true, filename: pending.filename, sha: result.sha, pushed: result.pushed })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    if (url === '/atlas/artifacts/design-audits' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { audits: [] }); return }
      const { data, error } = await sb
        .from('designer_runs')
        .select('id, task_id, operation, verdict, confidence, gaps, cost_usd, duration_ms, created_at')
        .eq('verdict', 'fail')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { audits: data ?? [] })
      return
    }

    if (url === '/atlas/artifacts/open-forks' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { forks: [] }); return }
      // "Open" = decisions awaiting a human pick. Schema requires chosen_option NOT NULL,
      // so the fork-author writes the literal string 'PENDING' until a human resolves it.
      // We additionally include rows where chosen_option IS NULL for forward-compat.
      let q = sb
        .from('atlas_decisions')
        .select('id, decided_at, fork_question, options_considered, rationale, related_phase, chosen_option')
        .or('chosen_option.is.null,chosen_option.eq.PENDING')
      if (principal.projectId) q = q.eq('project_id', principal.projectId)
      const { data, error } = await q
        .order('decided_at', { ascending: false })
        .limit(20)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { forks: data ?? [] })
      return
    }

    // Match /atlas/artifacts/forks/<uuid>/decide
    {
      const decideMatch = url.match(/^\/atlas\/artifacts\/forks\/([0-9a-f-]{36})\/decide$/i)
      if (decideMatch && method === 'POST') {
        if (!(await requireAuth(req, res))) return
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const id = decideMatch[1]
        const body = await readBody(req)
        let payload: { chosen?: string; rationale?: string }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (!payload.chosen || typeof payload.chosen !== 'string') {
          json(res, 400, { error: '`chosen` is required' })
          return
        }
        const { error } = await sb
          .from('atlas_decisions')
          .update({
            chosen_option: payload.chosen,
            rationale: payload.rationale ?? null,
            decided_by: 'user',
            decided_at: new Date().toISOString(),
          })
          .eq('id', id)
        if (error) { json(res, 500, { error: error.message }); return }
        json(res, 200, { ok: true, id, chosen: payload.chosen })
        return
      }
    }

    // Match /atlas/decisions/<uuid>/approve  (legacy Approve-ADR wizard)
    {
      const approveMatch = url.match(/^\/atlas\/decisions\/([0-9a-f-]{36})\/approve$/i)
      if (approveMatch && method === 'POST') {
        if (!(await requireAuth(req, res))) return
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const id = approveMatch[1]
        const { error } = await sb
          .from('atlas_decisions')
          .update({
            chosen_option: 'APPROVED',
            decided_by: 'user',
            decided_at: new Date().toISOString(),
          })
          .eq('id', id)
        if (error) { json(res, 500, { error: error.message }); return }
        json(res, 200, { ok: true, id })
        return
      }
    }

    // ─── Team management routes (Phase 1.10ao) ──────────────────────────────
    // Read endpoints require admin+; write endpoints require owner. Owner
    // cannot demote/revoke themselves through the UI (DB-only operation).

    if (url === '/atlas/team/members' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const members = await listMembers()
      json(res, 200, { members })
      return
    }

    if (url === '/atlas/team/invites' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const invites = await listPendingInvites()
      // Strip invite_token from the read endpoint so it never leaks server logs
      // / proxy access logs / browser history. Owner can fetch the URL by
      // re-issuing or via the create-invite response.
      const sanitized = invites.map(({ invite_token: _t, ...rest }) => {
        void _t
        return rest
      })
      json(res, 200, { invites: sanitized })
      return
    }

    if (url === '/atlas/team/invite' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (principal.role !== 'owner' || !principal.memberId) {
        json(res, 403, { error: 'role_insufficient', required: 'owner' })
        return
      }
      const body = await readBody(req)
      let payload: { phone?: string; role?: 'admin' | 'operator' | 'viewer'; display_name?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      const phone = (payload.phone ?? '').trim()
      const inviteRole = payload.role
      if (!phone) { json(res, 400, { error: 'phone required' }); return }
      if (!inviteRole || !['admin', 'operator', 'viewer'].includes(inviteRole)) {
        json(res, 400, { error: 'role must be admin|operator|viewer' })
        return
      }
      const result = await createOrRefreshInvite({
        phone,
        role: inviteRole,
        displayName: (payload.display_name ?? '').trim() || null,
        invitedBy: principal.memberId,
      })
      if (!result) { json(res, 503, { error: 'invite_persist_failed' }); return }

      const inviterMember = await getMember(principal.memberId)
      const inviterName = inviterMember?.display_name ?? 'the Atlas owner'
      const sent = await sendInviteWhatsApp({
        phone,
        role: inviteRole,
        inviterName,
        token: result.invite.invite_token,
      })

      await recordTeamAudit({
        actorId: principal.memberId,
        actorPhone: principal.phone,
        action: result.isNew ? 'invite_created' : 'invite_refreshed',
        targetInviteId: result.invite.id,
        targetPhone: phone,
        details: { role: inviteRole, whatsapp_sent: sent },
      })

      json(res, 200, {
        ok: true,
        invite: {
          id: result.invite.id,
          phone: result.invite.phone,
          role: result.invite.role,
          display_name: result.invite.display_name,
          expires_at: result.invite.expires_at,
          created_at: result.invite.created_at,
        },
        is_new: result.isNew,
        whatsapp_sent: sent,
      })
      return
    }

    {
      const revokeMatch = url.match(/^\/atlas\/team\/invites\/([0-9a-f-]{36})\/revoke$/i)
      if (revokeMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (principal.role !== 'owner' || !principal.memberId) {
          json(res, 403, { error: 'role_insufficient', required: 'owner' })
          return
        }
        const id = revokeMatch[1]
        const inviteBefore = await getInvite(id)
        const revoked = await revokeInvite(id)
        if (!revoked) { json(res, 404, { error: 'invite_not_found_or_already_resolved' }); return }
        const sent = inviteBefore ? await sendInviteRevokedWhatsApp(inviteBefore.phone) : false
        await recordTeamAudit({
          actorId: principal.memberId,
          actorPhone: principal.phone,
          action: 'invite_revoked',
          targetInviteId: revoked.id,
          targetPhone: revoked.phone,
          details: { whatsapp_sent: sent },
        })
        json(res, 200, { ok: true, id: revoked.id })
        return
      }
    }

    {
      const memberMatch = url.match(/^\/atlas\/team\/members\/([0-9a-f-]{36})$/i)
      if (memberMatch && method === 'PATCH') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (principal.role !== 'owner' || !principal.memberId) {
          json(res, 403, { error: 'role_insufficient', required: 'owner' })
          return
        }
        const id = memberMatch[1]
        const body = await readBody(req)
        let payload: { role?: Role; display_name?: string | null; status?: 'active' | 'suspended' | 'revoked'; notes?: string | null }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }

        const target = await getMember(id)
        if (!target) { json(res, 404, { error: 'member_not_found' }); return }

        // Owner cannot change their own role/status (DB-only operation).
        if (target.id === principal.memberId) {
          if (payload.role !== undefined && payload.role !== 'owner') {
            json(res, 403, { error: 'cannot_demote_self' })
            return
          }
          if (payload.status !== undefined && payload.status !== 'active') {
            json(res, 403, { error: 'cannot_revoke_self' })
            return
          }
        }
        // Owner role is reserved — never assign or remove via API.
        if (target.role === 'owner' && payload.role !== undefined && payload.role !== 'owner') {
          json(res, 403, { error: 'cannot_demote_owner' })
          return
        }
        if (payload.role === 'owner' && target.role !== 'owner') {
          json(res, 403, { error: 'cannot_promote_to_owner' })
          return
        }

        if (payload.role !== undefined && !['admin', 'operator', 'viewer', 'owner'].includes(payload.role)) {
          json(res, 400, { error: 'invalid_role' })
          return
        }
        if (payload.status !== undefined && !['active', 'suspended', 'revoked'].includes(payload.status)) {
          json(res, 400, { error: 'invalid_status' })
          return
        }

        const result = await updateMember({
          id,
          role: payload.role,
          displayName: payload.display_name,
          status: payload.status,
          notes: payload.notes,
        })
        if (!result) { json(res, 503, { error: 'member_persist_failed' }); return }

        await recordTeamAudit({
          actorId: principal.memberId,
          actorPhone: principal.phone,
          action: 'member_updated',
          targetMemberId: result.member.id,
          targetPhone: result.member.phone,
          details: {
            role: payload.role,
            status: payload.status,
            display_name: payload.display_name,
            sessions_revoked: result.sessionsRevoked,
          },
        })

        json(res, 200, { ok: true, member: result.member, sessions_revoked: result.sessionsRevoked })
        return
      }
    }

    {
      const sessionsMatch = url.match(/^\/atlas\/team\/members\/([0-9a-f-]{36})\/sessions\/revoke-all$/i)
      if (sessionsMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (principal.role !== 'owner' || !principal.memberId) {
          json(res, 403, { error: 'role_insufficient', required: 'owner' })
          return
        }
        const id = sessionsMatch[1]
        const target = await getMember(id)
        if (!target) { json(res, 404, { error: 'member_not_found' }); return }
        const count = await revokeAllSessionsForMember(id)
        await recordTeamAudit({
          actorId: principal.memberId,
          actorPhone: principal.phone,
          action: 'sessions_revoked_all',
          targetMemberId: target.id,
          targetPhone: target.phone,
          details: { sessions_revoked: count },
        })
        json(res, 200, { ok: true, sessions_revoked: count })
        return
      }
    }

    if (url === '/atlas/team/audit-log' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (principal.role !== 'owner') {
        json(res, 403, { error: 'role_insufficient', required: 'owner' })
        return
      }
      const entries = await listTeamAudit(100)
      json(res, 200, { entries })
      return
    }

    if (url === '/atlas/team/request-elevation' && method === 'POST') {
      // Any authed member may request elevation; the server WhatsApps the owner.
      const principal = await requireAuth(req, res)
      if (!principal) return
      const body = await readBody(req)
      let payload: { tool?: string; required_role?: Role; context?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.tool || !payload.required_role) {
        json(res, 400, { error: 'tool and required_role required' })
        return
      }

      // Look up the active owner phone.
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
      const { data: owner } = await sb
        .from('atlas_members')
        .select('id, phone, display_name')
        .eq('role', 'owner')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (!owner) { json(res, 503, { error: 'no_active_owner' }); return }
      const ownerRow = owner as { id: string; phone: string; display_name: string | null }

      const requesterMember = principal.memberId ? await getMember(principal.memberId) : null
      const sent = await sendElevationRequestWhatsApp({
        ownerPhone: ownerRow.phone,
        requesterPhone: principal.phone,
        requesterDisplayName: requesterMember?.display_name ?? null,
        tool: payload.tool,
        requiredRole: payload.required_role,
      })

      await recordTeamAudit({
        actorId: principal.memberId ?? ownerRow.id,
        actorPhone: principal.phone,
        action: 'elevation_requested',
        targetMemberId: ownerRow.id,
        targetPhone: ownerRow.phone,
        details: {
          tool: payload.tool,
          required_role: payload.required_role,
          context: payload.context ?? null,
          whatsapp_sent: sent,
        },
      })

      json(res, 200, { ok: true, whatsapp_sent: sent })
      return
    }

    // ─── Multi-project routes (Phase 1.10av) ────────────────────────────────
    // Atlas hosts N projects; CropsIntel V3 is project #1. Each member has a
    // role per project (atlas_project_members). Every per-project read/write
    // anywhere in this server filters by principal.projectId.

    if (url === '/atlas/projects' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const projects = await listProjectsForMember(principal.memberId)
      json(res, 200, {
        projects,
        current: { id: principal.projectId, slug: principal.projectSlug, role: principal.projectRole },
      })
      return
    }

    if (url === '/atlas/projects' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      // Only owners (global) can create new projects. The creator is auto-
      // attached as 'owner' on the new project.
      if (principal.role !== 'owner' || !principal.memberId) {
        json(res, 403, { error: 'role_insufficient', required: 'owner' })
        return
      }
      const body = await readBody(req)
      let payload: { slug?: string; display_name?: string; description?: string; repo_url?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.slug || !payload.display_name) {
        json(res, 400, { error: 'slug and display_name required' })
        return
      }
      const created = await createProject({
        slug: payload.slug,
        displayName: payload.display_name,
        description: payload.description ?? null,
        repoUrl: payload.repo_url ?? null,
        createdBy: principal.memberId,
      })
      if (!created.ok) { json(res, 400, { error: created.error }); return }
      // Auto-attach the creator as owner of the new project.
      await addProjectMember({
        projectId: created.project.id,
        memberId: principal.memberId,
        role: 'owner',
      })
      json(res, 200, { ok: true, project: created.project })
      return
    }

    {
      const projectMatch = url.match(/^\/atlas\/projects\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/i)
      if (projectMatch && method === 'GET') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        const slug = projectMatch[1].toLowerCase()
        const project = await getProjectBySlug(slug)
        if (!project) { json(res, 404, { error: 'project_not_found' }); return }
        const ms = await getMembership(principal.memberId, project.id)
        if (!ms) { json(res, 403, { error: 'no_project_access' }); return }
        if (!roleAtLeast(ms.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const members = await listProjectMembers(project.id)
        json(res, 200, { project, members, your_role: ms.role })
        return
      }
    }

    {
      const selectMatch = url.match(/^\/atlas\/projects\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/select$/i)
      if (selectMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (principal.sessionId === 'service') {
          json(res, 403, { error: 'service_principal_cannot_switch' })
          return
        }
        const slug = selectMatch[1].toLowerCase()
        const project = await getProjectBySlug(slug)
        if (!project || project.status !== 'active') { json(res, 404, { error: 'project_not_found' }); return }
        const ms = await getMembership(principal.memberId, project.id)
        if (!ms) { json(res, 403, { error: 'no_project_access' }); return }
        await setSessionLastProject(principal.sessionId, project.id)
        json(res, 200, { ok: true, project: { id: project.id, slug: project.slug, display_name: project.display_name }, role: ms.role })
        return
      }
    }

    {
      const memberAddMatch = url.match(/^\/atlas\/projects\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/members$/i)
      if (memberAddMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        const slug = memberAddMatch[1].toLowerCase()
        const project = await getProjectBySlug(slug)
        if (!project) { json(res, 404, { error: 'project_not_found' }); return }
        const ms = await getMembership(principal.memberId, project.id)
        if (!ms || !roleAtLeast(ms.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const body = await readBody(req)
        let payload: { member_id?: string; role?: Role }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (!payload.member_id || !payload.role) {
          json(res, 400, { error: 'member_id and role required' })
          return
        }
        if (!['owner', 'admin', 'operator', 'viewer'].includes(payload.role)) {
          json(res, 400, { error: 'invalid_role' })
          return
        }
        // Only owners may grant the project-level 'owner' role.
        if (payload.role === 'owner' && ms.role !== 'owner') {
          json(res, 403, { error: 'only_owner_can_grant_owner' })
          return
        }
        const result = await addProjectMember({
          projectId: project.id,
          memberId: payload.member_id,
          role: payload.role,
        })
        if (!result.ok) { json(res, 500, { error: result.error ?? 'persist_failed' }); return }
        json(res, 200, { ok: true })
        return
      }
    }

    {
      const memberRemoveMatch = url.match(/^\/atlas\/projects\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/members\/([0-9a-f-]{36})$/i)
      if (memberRemoveMatch && method === 'DELETE') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        const slug = memberRemoveMatch[1].toLowerCase()
        const targetMemberId = memberRemoveMatch[2]
        const project = await getProjectBySlug(slug)
        if (!project) { json(res, 404, { error: 'project_not_found' }); return }
        const ms = await getMembership(principal.memberId, project.id)
        if (!ms || ms.role !== 'owner') {
          json(res, 403, { error: 'role_insufficient', required: 'owner' })
          return
        }
        // Don't let the owner accidentally remove themselves from a project
        // they're the only owner of — leaves it orphaned.
        if (targetMemberId === principal.memberId) {
          json(res, 403, { error: 'cannot_remove_self' })
          return
        }
        const result = await removeProjectMember(project.id, targetMemberId)
        if (!result.ok) { json(res, 500, { error: result.error ?? 'persist_failed' }); return }
        json(res, 200, { ok: true })
        return
      }
    }

    if (url === '/whatsapp/inbound' && method === 'POST') {
      await handleWhatsAppInbound(req, res)
      return
    }

    // ─── Plan + workflow authoring (Phase 1.10ak) ────────────────────────────

    if (url === '/atlas/plan' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      try {
        const data = await getPlanResponse()
        json(res, 200, data)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/plan/upload' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { markdown?: string; message?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.markdown || typeof payload.markdown !== 'string') {
        json(res, 400, { error: 'markdown required' })
        return
      }
      try {
        const result = await writePlanMarkdown(
          payload.markdown,
          payload.message ?? 'chore(plan): user-uploaded plan revision',
          'upload',
          principal.phone,
        )
        json(res, 200, { ok: true, sha: result.sha, pushed: result.pushed })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/plan/amend' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { instruction?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.instruction || typeof payload.instruction !== 'string') {
        json(res, 400, { error: 'instruction required' })
        return
      }
      try {
        const { markdown } = await amendPlanWithClaude(payload.instruction, anthropic)
        if (!markdown || markdown.length < 100) {
          json(res, 502, { error: 'amend_returned_empty' })
          return
        }
        const result = await writePlanMarkdown(
          markdown,
          `chore(plan): amend — ${payload.instruction.slice(0, 60)}`,
          'amend',
          principal.phone,
          payload.instruction,
        )
        json(res, 200, { ok: true, sha: result.sha, pushed: result.pushed })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/draft-amendment — runs the amend prompt without writing.
    // Returns proposed markdown + diff so chat can render an Apply/Reject card.
    if (url === '/atlas/plan/draft-amendment' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { instruction?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.instruction || typeof payload.instruction !== 'string') {
        json(res, 400, { error: 'instruction required' })
        return
      }
      try {
        const result = await draftPlanAmendment(payload.instruction, anthropic)
        json(res, 200, {
          ok: true,
          proposed_markdown: result.proposedMarkdown,
          current_markdown: result.currentMarkdown,
          diff: result.diff,
          reasoning: result.reasoning,
        })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/apply-amendment — write a previously-drafted markdown
    // verbatim. Caller passes proposed_markdown from draft-amendment / draft-new.
    if (url === '/atlas/plan/apply-amendment' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { proposed_markdown?: string; summary?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.proposed_markdown || typeof payload.proposed_markdown !== 'string' || payload.proposed_markdown.length < 100) {
        json(res, 400, { error: 'proposed_markdown required (min 100 chars)' })
        return
      }
      const summary = typeof payload.summary === 'string' && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : 'chat-applied amendment'
      try {
        const result = await applyPendingPlanAmendment(payload.proposed_markdown, summary, principal.phone)
        json(res, 200, { ok: true, sha: result.sha, pushed: result.pushed })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/draft-new — drafts a brand-new master plan from a
    // free-form prompt. Optional context_refs are file paths inlined as
    // reference docs (capped at 12KB each). Same return shape as draft-amendment.
    if (url === '/atlas/plan/draft-new' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { prompt?: string; context_refs?: unknown }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.prompt || typeof payload.prompt !== 'string') {
        json(res, 400, { error: 'prompt required' })
        return
      }
      const contextRefs: string[] = Array.isArray(payload.context_refs)
        ? payload.context_refs.filter((s): s is string => typeof s === 'string')
        : []
      try {
        const result = await draftNewPlan(payload.prompt, contextRefs, anthropic)
        json(res, 200, {
          ok: true,
          proposed_markdown: result.proposedMarkdown,
          current_markdown: result.currentMarkdown,
          diff: result.diff,
          reasoning: result.reasoning,
        })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/plan/reorder' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { moved_id?: string; new_parent_id?: string; new_index?: number }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.moved_id || !payload.new_parent_id || typeof payload.new_index !== 'number') {
        json(res, 400, { error: 'moved_id, new_parent_id, new_index required' })
        return
      }
      try {
        const result = await reorderPlanNode(
          payload.moved_id,
          payload.new_parent_id,
          payload.new_index,
          principal.phone,
        )
        if (!result.ok) {
          json(res, 400, { error: result.error ?? 'reorder_failed' })
          return
        }
        json(res, 200, { ok: true, sha: result.sha })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/plan/build' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { title?: string; node_body?: string; phase_hint?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.title) { json(res, 400, { error: 'title required' }); return }
      try {
        const r = await queueSpecFromPlanNode(
          payload.title,
          payload.node_body ?? '',
          payload.phase_hint ?? 'plan',
        )
        json(res, 200, { ok: true, ...r })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase A.2: 5 plan-state mutation routes ─────────────────────────────
    // All require admin role (matches /atlas/plan/build) and operate on the
    // atlas_plan_node_state table. The master-plan markdown is read-only here;
    // these routes record overlay state that the Plan tab reads at render-time.

    // POST /atlas/plan/void — mark a node as voided. Tree hides by default,
    // visible under the "Voided" filter. Recoverable via /atlas/plan/recover.
    if (url === '/atlas/plan/void' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { plan_node_id?: string; reason?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id) { json(res, 400, { error: 'plan_node_id required' }); return }
      const result = await setPlanNodeState({
        planNodeId: payload.plan_node_id,
        state: 'voided',
        reason: payload.reason,
        setBy: 'user',
      })
      if (!result.ok) {
        json(res, 500, { error: result.reason ?? 'failed' })
        return
      }
      json(res, 200, { ok: true, row_id: result.rowId })
      return
    }

    // POST /atlas/plan/recover — clear the voided state.
    if (url === '/atlas/plan/recover' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { plan_node_id?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id) { json(res, 400, { error: 'plan_node_id required' }); return }
      const result = await clearPlanNodeState(payload.plan_node_id, 'voided')
      if (!result.ok) {
        json(res, 500, { error: result.reason ?? 'failed' })
        return
      }
      json(res, 200, { ok: true })
      return
    }

    // POST /atlas/plan/undeploy — flag a shipped node for revert. We DON'T
    // hard-revert files automatically; instead we ping the operator with a
    // WhatsApp + record the request. Full revert is a separate
    // remediation-spec drafting flow that the operator confirms.
    if (url === '/atlas/plan/undeploy' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { plan_node_id?: string; reason?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id) { json(res, 400, { error: 'plan_node_id required' }); return }
      try {
        await sendWhatsAppReply(
          process.env.MUZAMMIL_WHATSAPP ?? '+971562556592',
          `🔄 Undeploy requested for plan node ${payload.plan_node_id}.${payload.reason ? ` Reason: ${payload.reason}` : ''} Confirm in cockpit to draft a revert spec.`,
        )
      } catch (err) {
        console.warn('[atlas-plan/undeploy] WhatsApp ping failed:', err instanceof Error ? err.message : err)
      }
      json(res, 200, {
        ok: true,
        message: 'Undeploy request recorded. Confirm in chat to draft a revert spec.',
      })
      return
    }

    // POST /atlas/plan/add-to-queue — queue the spec without immediately
    // building. Same as /atlas/plan/build but also writes a queued-no-build
    // overlay so the Plan tab badge reflects the pending state.
    if (url === '/atlas/plan/add-to-queue' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { plan_node_id?: string; title?: string; node_body?: string; phase_hint?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id || !payload.title) {
        json(res, 400, { error: 'plan_node_id and title required' })
        return
      }
      try {
        const r = await queueSpecFromPlanNode(
          payload.title,
          payload.node_body ?? '',
          payload.phase_hint ?? 'plan',
        )
        await setPlanNodeState({
          planNodeId: payload.plan_node_id,
          state: 'queued-no-build',
          setBy: 'user',
          metadata: { spec_filename: r.filename },
        })
        json(res, 200, { ok: true, filename: r.filename, sha: r.sha, pushed: r.pushed })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/change-phase — re-parent a node under a different
    // phase. Thin wrapper over reorderPlanNode that lets callers omit
    // new_index (defaults to end of new parent's children).
    if (url === '/atlas/plan/change-phase' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { plan_node_id?: string; new_parent_id?: string; new_index?: number }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id || !payload.new_parent_id) {
        json(res, 400, { error: 'plan_node_id and new_parent_id required' })
        return
      }
      try {
        const result = await reorderPlanNode(
          payload.plan_node_id,
          payload.new_parent_id,
          // Use a large index to default to "end of new parent's children";
          // reorderPlanNode clamps to children.length.
          payload.new_index ?? Number.MAX_SAFE_INTEGER,
        )
        // result already carries an `ok` field from reorderPlanNode; spread directly.
        json(res, 200, result)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10aj: Plan tab build cockpit ────────────────────────────────

    // GET /atlas/concepts — list concepts. Query string ?theme=auth filters.
    if (url.split('?')[0] === '/atlas/concepts' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { concepts: [] }); return }
      const queryStr = url.includes('?') ? url.split('?')[1] : ''
      const params = new URLSearchParams(queryStr)
      const theme = params.get('theme')
      let q = sb
        .from('concepts')
        .select('id, title, content, source_type, source_ref, theme, used_in_phases, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (theme) q = q.eq('theme', theme)
      const { data, error } = await q
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { concepts: data ?? [] })
      return
    }

    // POST /atlas/concepts — create a concept. Source types: paste, upload,
    // voice, past-chat. Upload payloads carry source_ref pointing at the
    // chat-attachments storage path; voice carries the transcript in content.
    if (url === '/atlas/concepts' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: {
        title?: string
        content?: string
        // 1.10bb-c Session 7 hotfix — 'folder' was added to the DB CHECK
        // constraint + ConceptSourceType but missed in this single-row
        // route. Batch route already accepted 'folder'; this matches.
        source_type?: 'paste' | 'upload' | 'voice' | 'past-chat' | 'folder'
        source_ref?: string
        theme?: string
      }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.title || !payload.source_type) {
        json(res, 400, { error: 'title and source_type required' })
        return
      }
      const allowed = ['paste', 'upload', 'voice', 'past-chat', 'folder']
      if (!allowed.includes(payload.source_type)) {
        json(res, 400, { error: 'invalid source_type' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const { data, error } = await sb
        .from('concepts')
        .insert({
          title: payload.title.slice(0, 200),
          content: payload.content ?? '',
          source_type: payload.source_type,
          source_ref: payload.source_ref ?? null,
          theme: payload.theme ?? null,
        })
        .select('id, title, content, source_type, source_ref, theme, used_in_phases, created_at')
        .single()
      if (error || !data) { json(res, 500, { error: error?.message ?? 'insert failed' }); return }
      json(res, 200, { ok: true, concept: data })
      return
    }

    // 1.10bb-c Session 7 — POST /atlas/concepts/batch
    // Bulk-insert N concept rows in one round-trip. Used by the Concepts
    // panel's folder upload (a 300-file checkout would otherwise be 300
    // HTTP calls). Returns the inserted rows so the UI can drop them into
    // the list without a refetch.
    if (url === '/atlas/concepts/batch' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const rawBody = await readBody(req)
      let payload: {
        parent_folder?: string
        concepts?: Array<{
          title: string
          content?: string
          source_type?: 'paste' | 'upload' | 'voice' | 'past-chat' | 'folder'
          source_ref?: string
          theme?: string
        }>
      }
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
      const items = Array.isArray(payload.concepts) ? payload.concepts : []
      if (items.length === 0) { json(res, 400, { error: 'concepts[] required (non-empty)' }); return }
      if (items.length > 1000) { json(res, 400, { error: 'batch too large — cap is 1000 rows' }); return }
      const parentFolder = typeof payload.parent_folder === 'string' && payload.parent_folder.length > 0
        ? payload.parent_folder.slice(0, 200)
        : null
      const allowed = new Set(['paste', 'upload', 'voice', 'past-chat', 'folder'])
      const rows = items.map((c) => ({
        title: String(c.title ?? '').slice(0, 240),
        content: typeof c.content === 'string' ? c.content : '',
        source_type: allowed.has(c.source_type ?? '') ? c.source_type! : 'upload',
        source_ref: typeof c.source_ref === 'string' ? c.source_ref.slice(0, 500) : null,
        theme: typeof c.theme === 'string' ? c.theme.slice(0, 200) : null,
        parent_folder: parentFolder,
      })).filter((r) => r.title.length > 0)
      if (rows.length === 0) { json(res, 400, { error: 'no valid rows after sanitization' }); return }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const { data, error } = await sb
        .from('concepts')
        .insert(rows)
        .select('id, title, content, source_type, source_ref, theme, used_in_phases, created_at, parent_folder')
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { ok: true, inserted: data?.length ?? 0, concepts: data ?? [] })
      return
    }

    // 1.10bb-c Session 7 — PATCH /atlas/concepts/:id — partial update.
    // Lets the panel's Edit action rewrite title/content/theme.
    {
      const m = url.match(/^\/atlas\/concepts\/([^/]+)$/)
      if (m && method === 'PATCH') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const conceptId = decodeURIComponent(m[1])
        const rawBody = await readBody(req)
        let payload: { title?: string; content?: string; theme?: string }
        try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
        const update: Record<string, unknown> = {}
        if (typeof payload.title === 'string') update.title = payload.title.slice(0, 240)
        if (typeof payload.content === 'string') update.content = payload.content
        if (typeof payload.theme === 'string') update.theme = payload.theme.slice(0, 200) || null
        if (Object.keys(update).length === 0) {
          json(res, 400, { error: 'no fields to update' })
          return
        }
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { data, error } = await sb
          .from('concepts')
          .update(update)
          .eq('id', conceptId)
          .select('id, title, content, source_type, source_ref, theme, used_in_phases, created_at, parent_folder')
          .single()
        if (error || !data) { json(res, 404, { error: error?.message ?? 'concept not found' }); return }
        json(res, 200, { ok: true, concept: data })
        return
      }
    }

    // 1.10bb-c Session 7 — DELETE /atlas/concepts/:id
    // If the concept is a 'folder' parent row, all rows with the same
    // parent_folder are removed in the same call.
    {
      const m = url.match(/^\/atlas\/concepts\/([^/]+)$/)
      if (m && method === 'DELETE') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const conceptId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { data: existing } = await sb
          .from('concepts')
          .select('id, source_type, title, parent_folder')
          .eq('id', conceptId)
          .maybeSingle()
        let cascaded = 0
        if (existing && (existing as { source_type?: string }).source_type === 'folder') {
          const folderName = (existing as { title?: string }).title ?? ''
          if (folderName) {
            const { count } = await sb
              .from('concepts')
              .delete({ count: 'exact' })
              .eq('parent_folder', folderName)
            cascaded = count ?? 0
          }
        }
        const { error } = await sb.from('concepts').delete().eq('id', conceptId)
        if (error) { json(res, 500, { error: error.message }); return }
        json(res, 200, { ok: true, cascaded })
        return
      }
    }

    // 1.10bb-c Session 7 — concept ↔ plan-node link CRUD.
    // GET /atlas/concept-links?concept_id=… OR ?plan_node_id=…
    if (url.split('?')[0] === '/atlas/concept-links' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { links: [] }); return }
      const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')
      const conceptId = params.get('concept_id')
      const planNodeId = params.get('plan_node_id')
      let q = sb
        .from('atlas_concept_links')
        .select('id, concept_id, plan_node_id, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (conceptId) q = q.eq('concept_id', conceptId)
      if (planNodeId) q = q.eq('plan_node_id', planNodeId)
      const { data, error } = await q
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { links: data ?? [] })
      return
    }

    // POST /atlas/concept-links — attach a concept to a plan node. Idempotent
    // (UNIQUE (concept_id, plan_node_id) — 23505 returns the existing row).
    if (url === '/atlas/concept-links' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const rawBody = await readBody(req)
      let payload: { concept_id?: string; plan_node_id?: string }
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
      if (!payload.concept_id || !payload.plan_node_id) {
        json(res, 400, { error: 'concept_id and plan_node_id required' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const { data, error } = await sb
        .from('atlas_concept_links')
        .upsert(
          { concept_id: payload.concept_id, plan_node_id: payload.plan_node_id },
          { onConflict: 'concept_id,plan_node_id' },
        )
        .select('id, concept_id, plan_node_id, created_at')
        .single()
      if (error || !data) { json(res, 500, { error: error?.message ?? 'link insert failed' }); return }
      json(res, 200, { ok: true, link: data })
      return
    }

    // DELETE /atlas/concept-links/:id — detach.
    {
      const m = url.match(/^\/atlas\/concept-links\/([^/]+)$/)
      if (m && method === 'DELETE') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const linkId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { error } = await sb.from('atlas_concept_links').delete().eq('id', linkId)
        if (error) { json(res, 500, { error: error.message }); return }
        json(res, 200, { ok: true })
        return
      }
    }

    // ─── 1.10bb-c Session 9A: Settings — Connections vault + Audit ──────────
    // All admin-gated. Member id comes from requireAuth() — atlas_members.id
    // when present, otherwise the session id (so single-member bootstrap
    // works too). The vault holds the actual secret value; this surface only
    // reads metadata + last4. Provider test endpoints live under
    // atlas/src/lib/providers/. See atlas/src/lib/vault.ts for crypto.

    // Resolve a stable member-scope id for the current principal. Used as
    // atlas_connections.member_id. Falls back to the sessionId so a fresh
    // tenant with no atlas_members row can still write connections.
    function memberScopeForPrincipal(p: AuthPrincipal): string {
      return p.memberId ?? p.sessionId
    }

    async function logAuditEvent(args: {
      memberId: string | null
      connectionId?: string | null
      action: 'create' | 'update' | 'rotate' | 'test' | 'reveal' | 'delete' | 'wizard_complete'
      result: 'success' | 'failure'
      meta?: Record<string, unknown>
      req: IncomingMessage
    }): Promise<void> {
      const sb = getSupabaseClient()
      if (!sb) return
      const ip = (args.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
        ?? args.req.socket.remoteAddress
        ?? null
      const ua = (args.req.headers['user-agent'] as string | undefined) ?? null
      try {
        await sb.from('atlas_audit_events').insert({
          member_id: args.memberId,
          connection_id: args.connectionId ?? null,
          action: args.action,
          result: args.result,
          ip,
          user_agent: ua,
          meta_json: args.meta ?? null,
        })
      } catch { /* audit failure must never break the control path */ }
    }

    interface ConnectionRow {
      id: string
      member_id: string
      provider: string
      label: string
      sensitivity: string
      encrypted_value: string  // base64 / bytea-from-postgres
      encryption_nonce: string
      meta_json: Record<string, unknown> | null
      last_verified_at: string | null
      last_verify_status: string | null
      last_verify_error: string | null
      created_at: string
      updated_at: string
    }

    // bytea from Supabase comes back as "\\x..." hex by default. Provide both
    // directions so callers stay readable.
    function byteaToBuffer(input: unknown): Uint8Array {
      if (input instanceof Uint8Array) return input
      if (typeof input === 'string' && input.startsWith('\\x')) {
        return Uint8Array.from(Buffer.from(input.slice(2), 'hex'))
      }
      if (typeof input === 'string') {
        // Fallback: base64.
        return Uint8Array.from(Buffer.from(input, 'base64'))
      }
      return new Uint8Array()
    }

    function bufferToBytea(input: Uint8Array): string {
      return '\\x' + Buffer.from(input).toString('hex')
    }

    function maskedRow(row: ConnectionRow, last4: string): Record<string, unknown> {
      return {
        id: row.id,
        provider: row.provider,
        label: row.label,
        sensitivity: row.sensitivity,
        meta_json: row.meta_json ?? {},
        last_verified_at: row.last_verified_at,
        last_verify_status: row.last_verify_status,
        last_verify_error: row.last_verify_error,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last4,
        masked: last4 ? `••••••••${last4}` : '••••',
      }
    }

    async function decryptRow(row: ConnectionRow): Promise<string> {
      const { vaultDecrypt } = await import('./lib/vault.js')
      const ciphertext = byteaToBuffer(row.encrypted_value)
      const nonce = byteaToBuffer(row.encryption_nonce)
      return vaultDecrypt(ciphertext, nonce)
    }

    // GET /atlas/connections — list (masked).
    if (url === '/atlas/connections' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { connections: [] }); return }
      const memberId = memberScopeForPrincipal(principal)
      const { data, error } = await sb
        .from('atlas_connections')
        .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
        .eq('member_id', memberId)
        .order('updated_at', { ascending: false })
        .limit(200)
      if (error) { json(res, 500, { error: error.message }); return }
      // Best-effort decrypt to surface last4 — failures fall back to empty.
      const rows = (data ?? []) as ConnectionRow[]
      const masked = await Promise.all(rows.map(async (row) => {
        try {
          const { maskSecret } = await import('./lib/vault.js')
          const plain = await decryptRow(row)
          const { last4 } = maskSecret(plain)
          return maskedRow(row, last4)
        } catch {
          return maskedRow(row, '')
        }
      }))
      json(res, 200, { connections: masked })
      return
    }

    // POST /atlas/connections — create (or dry_run test).
    // Session 9B: when dry_run=true, runs the provider test against the
    // submitted creds WITHOUT writing to atlas_connections. Used by the
    // AddConnectionSheet's "Test connection" button so the user can
    // validate before committing. Audit log captures it as action='test'.
    if (url === '/atlas/connections' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const rawBody = await readBody(req)
      let payload: { provider?: string; label?: string; sensitivity?: string; secret?: string; meta_json?: Record<string, unknown>; dry_run?: boolean } = {}
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
      if (!payload.provider || !payload.secret) {
        json(res, 400, { error: 'provider + secret required' })
        return
      }

      // Session 9B — dry_run short-circuits the vault + insert. No row
      // persists, no last_verify_* update. Pure read-side check on the
      // upstream provider.
      if (payload.dry_run === true) {
        const memberId = memberScopeForPrincipal(principal)
        const { runProviderTest } = await import('./lib/providers/index.js')
        const result = await runProviderTest(payload.provider, {
          apiKey: payload.secret,
          meta: (payload.meta_json ?? {}) as Record<string, string>,
        })
        await logAuditEvent({
          memberId,
          action: 'test',
          result: result.ok ? 'success' : 'failure',
          meta: { provider: payload.provider, dry_run: true, status: result.status, identity: result.identity },
          req,
        })
        json(res, 200, {
          ok: result.ok,
          dry_run: true,
          identity: result.identity,
          scopes: result.scopes,
          error: result.error,
          status: result.status,
        })
        return
      }

      const { vaultIsReady, vaultEncrypt } = await import('./lib/vault.js')
      const ready = await vaultIsReady()
      if (!ready.ok) {
        json(res, 503, { error: 'vault_unconfigured', detail: ready.error })
        return
      }
      try {
        const encrypted = await vaultEncrypt(payload.secret)
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const memberId = memberScopeForPrincipal(principal)
        const { data, error } = await sb
          .from('atlas_connections')
          .insert({
            member_id: memberId,
            provider: payload.provider,
            label: payload.label ?? '',
            sensitivity: payload.sensitivity === 'production_sensitive' ? 'production_sensitive' : 'regular',
            encrypted_value: bufferToBytea(encrypted.ciphertext),
            encryption_nonce: bufferToBytea(encrypted.nonce),
            meta_json: payload.meta_json ?? {},
          })
          .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
          .single()
        if (error || !data) {
          await logAuditEvent({ memberId, action: 'create', result: 'failure', meta: { provider: payload.provider, error: error?.message }, req })
          json(res, 500, { error: error?.message ?? 'insert failed' })
          return
        }
        const insertedRow = data as ConnectionRow
        const { maskSecret } = await import('./lib/vault.js')
        const { last4 } = maskSecret(payload.secret)

        // 1.10bb-c Session 9B-FIX — verify-after-insert.
        //
        // The 9A code path returned the just-inserted row with NULL
        // verify columns, which left the wizard's stepper stuck on
        // "needs test" even after a successful Save. The dry_run path
        // already validates against the provider, but the *create*
        // path didn't — so the persisted row never reached
        // last_verify_status='verified' until the user manually
        // clicked Test from Settings.
        //
        // Now we always run the provider test against the freshly
        // encrypted credentials and write the result back. The row is
        // returned to the client with last_verify_status populated, so
        // the wizard can advance immediately. Failures persist as
        // last_verify_status='failing' / 'unknown' so the user can
        // retry from Settings without re-entering the secret.
        const { runProviderTest } = await import('./lib/providers/index.js')
        const nowIso = new Date().toISOString()
        let testStatus: 'verified' | 'failing' | 'unknown' = 'unknown'
        let testError: string | null = null
        let testIdentity: string | undefined
        let testScopes: string[] | undefined
        let testHttpStatus: number | undefined
        try {
          const testResult = await runProviderTest(payload.provider, {
            apiKey: payload.secret,
            meta: (payload.meta_json ?? {}) as Record<string, string>,
          })
          testStatus = testResult.ok ? 'verified' : 'failing'
          testError = testResult.ok ? null : (testResult.error ?? 'failed').slice(0, 1000)
          testIdentity = testResult.identity
          testScopes = testResult.scopes
          testHttpStatus = testResult.status
        } catch (err) {
          // Network / unexpected throw — keep the row so the user can
          // retry. last_verify_status='unknown' signals "we couldn't
          // ask the provider, not that the provider rejected us".
          testStatus = 'unknown'
          testError = (err instanceof Error ? err.message : String(err)).slice(0, 1000)
        }

        const { data: updated, error: updateErr } = await sb
          .from('atlas_connections')
          .update({
            last_verify_status: testStatus,
            last_verify_error: testError,
            last_verified_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', insertedRow.id)
          .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
          .single()
        // If the update query itself fails, fall back to the inserted
        // row — the connection still exists; verify status just won't
        // surface until the next manual Test.
        const finalRow = (updated as ConnectionRow | null) ?? insertedRow

        await logAuditEvent({
          memberId,
          connectionId: finalRow.id,
          action: 'create',
          result: testStatus === 'verified' ? 'success' : 'failure',
          meta: {
            provider: payload.provider,
            verify_status: testStatus,
            verify_identity: testIdentity,
            verify_scopes: testScopes,
            verify_http_status: testHttpStatus,
            verify_error: testError,
            update_error: updateErr?.message ?? null,
          },
          req,
        })
        json(res, 200, { ok: true, connection: maskedRow(finalRow, last4) })
        return
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        json(res, 500, { error: msg })
        return
      }
    }

    // PATCH /atlas/connections/:id — label / meta only (not secret).
    {
      const m = url.match(/^\/atlas\/connections\/([^/]+)$/)
      if (m && method === 'PATCH') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const connectionId = decodeURIComponent(m[1])
        const rawBody = await readBody(req)
        let payload: { label?: string; meta_json?: Record<string, unknown>; sensitivity?: string } = {}
        try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (typeof payload.label === 'string') update.label = payload.label.slice(0, 200)
        if (payload.meta_json && typeof payload.meta_json === 'object') update.meta_json = payload.meta_json
        if (payload.sensitivity === 'regular' || payload.sensitivity === 'production_sensitive') update.sensitivity = payload.sensitivity
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const memberId = memberScopeForPrincipal(principal)
        const { data, error } = await sb
          .from('atlas_connections')
          .update(update)
          .eq('id', connectionId)
          .eq('member_id', memberId)
          .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
          .maybeSingle()
        if (error || !data) { json(res, 404, { error: error?.message ?? 'connection not found' }); return }
        const row = data as ConnectionRow
        let last4 = ''
        try { const { maskSecret } = await import('./lib/vault.js'); const plain = await decryptRow(row); last4 = maskSecret(plain).last4 } catch { /* ignore */ }
        await logAuditEvent({ memberId, connectionId: row.id, action: 'update', result: 'success', req })
        json(res, 200, { ok: true, connection: maskedRow(row, last4) })
        return
      }
    }

    // POST /atlas/connections/:id/rotate — replace the secret value.
    {
      const m = url.match(/^\/atlas\/connections\/([^/]+)\/rotate$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const connectionId = decodeURIComponent(m[1])
        const rawBody = await readBody(req)
        let payload: { secret?: string } = {}
        try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
        if (!payload.secret) { json(res, 400, { error: 'secret required' }); return }
        const { vaultIsReady, vaultEncrypt, maskSecret } = await import('./lib/vault.js')
        const ready = await vaultIsReady()
        if (!ready.ok) { json(res, 503, { error: 'vault_unconfigured', detail: ready.error }); return }
        const encrypted = await vaultEncrypt(payload.secret)
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const memberId = memberScopeForPrincipal(principal)
        const { data, error } = await sb
          .from('atlas_connections')
          .update({
            encrypted_value: bufferToBytea(encrypted.ciphertext),
            encryption_nonce: bufferToBytea(encrypted.nonce),
            last_verify_status: 'unknown',
            last_verify_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', connectionId)
          .eq('member_id', memberId)
          .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
          .maybeSingle()
        if (error || !data) { json(res, 404, { error: error?.message ?? 'connection not found' }); return }
        const row = data as ConnectionRow
        const { last4 } = maskSecret(payload.secret)
        await logAuditEvent({ memberId, connectionId: row.id, action: 'rotate', result: 'success', meta: { provider: row.provider }, req })
        json(res, 200, { ok: true, connection: maskedRow(row, last4) })
        return
      }
    }

    // POST /atlas/connections/:id/test — provider-specific live check.
    {
      const m = url.match(/^\/atlas\/connections\/([^/]+)\/test$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const connectionId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const memberId = memberScopeForPrincipal(principal)
        const { data, error } = await sb
          .from('atlas_connections')
          .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
          .eq('id', connectionId)
          .eq('member_id', memberId)
          .maybeSingle()
        if (error || !data) { json(res, 404, { error: error?.message ?? 'connection not found' }); return }
        const row = data as ConnectionRow
        let plain: string
        try { plain = await decryptRow(row) } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          await sb.from('atlas_connections').update({ last_verify_status: 'failing', last_verify_error: `decrypt_failed: ${msg}`, last_verified_at: new Date().toISOString() }).eq('id', connectionId)
          await logAuditEvent({ memberId, connectionId: row.id, action: 'test', result: 'failure', meta: { reason: 'decrypt_failed' }, req })
          json(res, 503, { ok: false, error: `vault decrypt failed: ${msg}` })
          return
        }
        const { runProviderTest } = await import('./lib/providers/index.js')
        const testResult = await runProviderTest(row.provider, {
          apiKey: plain,
          meta: (row.meta_json ?? {}) as Record<string, string>,
        })
        const nowIso = new Date().toISOString()
        await sb.from('atlas_connections').update({
          last_verify_status: testResult.ok ? 'verified' : 'failing',
          last_verify_error: testResult.ok ? null : (testResult.error ?? 'failed').slice(0, 1000),
          last_verified_at: nowIso,
        }).eq('id', connectionId)
        await logAuditEvent({ memberId, connectionId: row.id, action: 'test', result: testResult.ok ? 'success' : 'failure', meta: { provider: row.provider, status: testResult.status, identity: testResult.identity }, req })
        json(res, 200, { ok: testResult.ok, identity: testResult.identity, scopes: testResult.scopes, error: testResult.error, status: testResult.status, verified_at: nowIso })
        return
      }
    }

    // POST /atlas/connections/:id/reveal — return plaintext once.
    {
      const m = url.match(/^\/atlas\/connections\/([^/]+)\/reveal$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const connectionId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const memberId = memberScopeForPrincipal(principal)
        const { data, error } = await sb
          .from('atlas_connections')
          .select('id, member_id, provider, label, sensitivity, encrypted_value, encryption_nonce, meta_json, last_verified_at, last_verify_status, last_verify_error, created_at, updated_at')
          .eq('id', connectionId)
          .eq('member_id', memberId)
          .maybeSingle()
        if (error || !data) { json(res, 404, { error: error?.message ?? 'connection not found' }); return }
        const row = data as ConnectionRow
        if (row.sensitivity === 'production_sensitive') {
          await logAuditEvent({ memberId, connectionId: row.id, action: 'reveal', result: 'failure', meta: { reason: 'production_sensitive' }, req })
          json(res, 403, { error: 'reveal blocked for production_sensitive secrets — rotate instead' })
          return
        }
        try {
          const plain = await decryptRow(row)
          await logAuditEvent({ memberId, connectionId: row.id, action: 'reveal', result: 'success', meta: { provider: row.provider }, req })
          json(res, 200, { ok: true, secret: plain })
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          await logAuditEvent({ memberId, connectionId: row.id, action: 'reveal', result: 'failure', meta: { reason: 'decrypt_failed' }, req })
          json(res, 503, { error: `vault decrypt failed: ${msg}` })
          return
        }
      }
    }

    // DELETE /atlas/connections/:id — hard delete.
    {
      const m = url.match(/^\/atlas\/connections\/([^/]+)$/)
      if (m && method === 'DELETE') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const connectionId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const memberId = memberScopeForPrincipal(principal)
        const { data: existing } = await sb
          .from('atlas_connections')
          .select('id, provider')
          .eq('id', connectionId)
          .eq('member_id', memberId)
          .maybeSingle()
        if (!existing) { json(res, 404, { error: 'connection not found' }); return }
        const { error } = await sb.from('atlas_connections').delete().eq('id', connectionId).eq('member_id', memberId)
        if (error) {
          await logAuditEvent({ memberId, connectionId, action: 'delete', result: 'failure', req })
          json(res, 500, { error: error.message })
          return
        }
        await logAuditEvent({ memberId, connectionId, action: 'delete', result: 'success', meta: { provider: (existing as { provider?: string }).provider }, req })
        json(res, 200, { ok: true })
        return
      }
    }

    // GET /atlas/audit — list audit events for this member (most recent first).
    if (url.split('?')[0] === '/atlas/audit' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { events: [] }); return }
      const memberId = memberScopeForPrincipal(principal)
      const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')
      const action = params.get('action')
      const connectionId = params.get('connection_id')
      const limit = Math.min(500, Math.max(1, Number(params.get('limit') ?? '100')))
      let q = sb
        .from('atlas_audit_events')
        .select('id, member_id, connection_id, action, result, ip, user_agent, meta_json, created_at')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (action) q = q.eq('action', action)
      if (connectionId) q = q.eq('connection_id', connectionId)
      const { data, error } = await q
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { events: data ?? [] })
      return
    }

    // GET /atlas/user-state — current member's atlas_user_state row (auto-creates).
    if (url === '/atlas/user-state' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const memberId = memberScopeForPrincipal(principal)
      const { data, error } = await sb
        .from('atlas_user_state')
        .select('member_id, onboarding_complete, whatsapp_number, updated_at')
        .eq('member_id', memberId)
        .maybeSingle()
      if (error) { json(res, 500, { error: error.message }); return }
      if (!data) {
        const { data: inserted, error: insErr } = await sb
          .from('atlas_user_state')
          .insert({ member_id: memberId, whatsapp_number: principal.phone })
          .select('member_id, onboarding_complete, whatsapp_number, updated_at')
          .single()
        if (insErr || !inserted) { json(res, 500, { error: insErr?.message ?? 'insert failed' }); return }
        json(res, 200, { state: inserted })
        return
      }
      json(res, 200, { state: data })
      return
    }

    // PATCH /atlas/user-state — update onboarding_complete + whatsapp_number.
    if (url === '/atlas/user-state' && method === 'PATCH') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const rawBody = await readBody(req)
      let payload: { onboarding_complete?: boolean; whatsapp_number?: string } = {}
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'invalid_json' }); return }
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (typeof payload.onboarding_complete === 'boolean') update.onboarding_complete = payload.onboarding_complete
      if (typeof payload.whatsapp_number === 'string') update.whatsapp_number = payload.whatsapp_number.slice(0, 32)
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const memberId = memberScopeForPrincipal(principal)
      const { data, error } = await sb
        .from('atlas_user_state')
        .upsert({ member_id: memberId, ...update }, { onConflict: 'member_id' })
        .select('member_id, onboarding_complete, whatsapp_number, updated_at')
        .single()
      if (error || !data) { json(res, 500, { error: error?.message ?? 'upsert failed' }); return }
      if (payload.onboarding_complete === true) {
        await logAuditEvent({ memberId, action: 'wizard_complete', result: 'success', req })
      }
      json(res, 200, { state: data })
      return
    }


    // ─── 1.10bb-c Session 4: Plan Workshop endpoints ────────────────────────
    // 8 endpoints for the new Workshop UI (PlanWorkshop.tsx). All admin-gated.
    // See workshop-engine.ts (Session 3) for the brain; this is the HTTP surface.

    // POST /atlas/workshop/sessions — start a new session.
    if (url === '/atlas/workshop/sessions' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: {
        prompt?: string
        concept_ids?: string[]
        uploads?: Array<{ filename: string; mime: string; body: string; bytes: number }>
        v3_paths?: string[]
        v1_paths?: string[]
        v1_search_queries?: string[]
        master_plan_version?: string
      }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.prompt || typeof payload.prompt !== 'string' || payload.prompt.trim().length < 3) {
        json(res, 400, { error: 'prompt required (≥3 chars)' })
        return
      }
      try {
        const { startWorkshopSession } = await import('./lib/workshop-engine.js')
        const result = await startWorkshopSession({
          prompt: payload.prompt,
          createdBy: principal.memberId,
          conceptIds: payload.concept_ids,
          uploads: payload.uploads,
          v3Paths: payload.v3_paths,
          v1Paths: payload.v1_paths,
          v1SearchQueries: payload.v1_search_queries,
          masterPlanVersion: payload.master_plan_version,
          anthropic,
        })
        json(res, 200, { ok: true, ...result })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // GET /atlas/workshop/sessions — list sessions (newest first, capped 50).
    // 1.10bd-queue-pivot Step 4: also surfaces archived_at and the linked
    // plan_diff's approved_at / applied_at / rejected_at so the frontend
    // can render Queue / Archive button variants without a second roundtrip.
    // ?include_archived=true returns archived sessions too (default: hidden).
    if (url.split('?')[0] === '/atlas/workshop/sessions' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const qs = new URL(url, 'http://x').searchParams
      const includeArchived = qs.get('include_archived') === 'true'
      let query = sb
        .from('plan_workshop_sessions')
        .select('id, status, started_at, completed_at, total_turns, total_cost_usd, plan_diff_id, master_plan_version, archived_at')
        .order('started_at', { ascending: false })
        .limit(50)
      if (!includeArchived) query = query.is('archived_at', null)
      const { data: sessions, error } = await query
      if (error) { json(res, 500, { error: error.message }); return }
      // Batch-fetch linked plan_diffs in a single query (no FK, so a manual
      // join in JS — Supabase's PostgREST relationship syntax needs an FK).
      const diffIds = (sessions ?? [])
        .map((s) => (s as { plan_diff_id: string | null }).plan_diff_id)
        .filter((x): x is string => !!x)
      const diffMap: Record<string, { approved_at: string | null; applied_at: string | null; rejected_at: string | null }> = {}
      if (diffIds.length > 0) {
        const { data: diffs } = await sb
          .from('plan_diffs')
          .select('id, approved_at, applied_at, rejected_at')
          .in('id', diffIds)
        for (const d of diffs ?? []) {
          const row = d as { id: string; approved_at: string | null; applied_at: string | null; rejected_at: string | null }
          diffMap[row.id] = { approved_at: row.approved_at, applied_at: row.applied_at, rejected_at: row.rejected_at }
        }
      }
      const enriched = (sessions ?? []).map((s) => {
        const row = s as { plan_diff_id: string | null }
        const d = row.plan_diff_id ? diffMap[row.plan_diff_id] : undefined
        return {
          ...s,
          plan_diff_approved_at: d?.approved_at ?? null,
          plan_diff_applied_at: d?.applied_at ?? null,
          plan_diff_rejected_at: d?.rejected_at ?? null,
        }
      })
      json(res, 200, { ok: true, sessions: enriched })
      return
    }

    // POST /atlas/workshop/sessions/:id/answer — record turn answer + advance.
    {
      const m = url.match(/^\/atlas\/workshop\/sessions\/([^/]+)\/answer$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const sessionId = decodeURIComponent(m[1])
        const body = await readBody(req)
        let payload: { answer?: string; advance?: boolean }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (typeof payload.answer !== 'string') {
          json(res, 400, { error: 'answer required' })
          return
        }
        try {
          const { recordTurnAnswer } = await import('./lib/workshop-engine.js')
          const result = await recordTurnAnswer({
            sessionId,
            answer: payload.answer,
            anthropic,
            advance: payload.advance !== false,
          })
          json(res, 200, { ok: true, ...result })
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // POST /atlas/workshop/sessions/:id/finalize — generate plan diff.
    {
      const m = url.match(/^\/atlas\/workshop\/sessions\/([^/]+)\/finalize$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const sessionId = decodeURIComponent(m[1])
        try {
          const { finalizePlanDiff } = await import('./lib/workshop-engine.js')
          const result = await finalizePlanDiff({ sessionId, anthropic })
          json(res, 200, { ok: true, ...result })
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // GET /atlas/workshop/sessions/:id — fetch a single session (status, turns, decisions).
    {
      const m = url.match(/^\/atlas\/workshop\/sessions\/([^/]+)$/)
      if (m && method === 'GET') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const sessionId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { data, error } = await sb
          .from('plan_workshop_sessions')
          .select('id, status, started_at, completed_at, decision_log, open_questions, concepts_referenced, master_plan_version, plan_diff_id, total_turns, total_cost_usd, metadata')
          .eq('id', sessionId)
          .single()
        if (error || !data) { json(res, 404, { error: 'session_not_found' }); return }
        // Surface the workshop_state turns array under a top-level key so clients
        // don't have to dig into metadata.
        const meta = (data as { metadata?: Record<string, unknown> }).metadata ?? {}
        const workshopState = (meta.workshop_state ?? null) as Record<string, unknown> | null
        json(res, 200, { ok: true, session: { ...data, workshop_state: workshopState } })
        return
      }
    }

    // POST /atlas/workshop/sessions/:id/archive — 1.10bd Step 4.
    // Marks plan_workshop_sessions.archived_at. Allowed on any status —
    // even archiving an active session removes it from the default list.
    // Idempotent: archiving an already-archived session is a no-op.
    {
      const m = url.match(/^\/atlas\/workshop\/sessions\/([^/]+)\/archive$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const sessionId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const nowIso = new Date().toISOString()
        const { data, error } = await sb
          .from('plan_workshop_sessions')
          .update({ archived_at: nowIso })
          .eq('id', sessionId)
          .select('id, archived_at')
          .single()
        if (error || !data) { json(res, 404, { error: 'session_not_found', detail: error?.message }); return }
        json(res, 200, { ok: true, id: sessionId, archived_at: (data as { archived_at: string }).archived_at })
        return
      }
    }

    // POST /atlas/workshop/sessions/:id/unarchive — 1.10bd Step 4.
    {
      const m = url.match(/^\/atlas\/workshop\/sessions\/([^/]+)\/unarchive$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const sessionId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { data, error } = await sb
          .from('plan_workshop_sessions')
          .update({ archived_at: null })
          .eq('id', sessionId)
          .select('id')
          .single()
        if (error || !data) { json(res, 404, { error: 'session_not_found', detail: error?.message }); return }
        json(res, 200, { ok: true, id: sessionId, archived_at: null })
        return
      }
    }

    // GET /atlas/workshop/diffs/:id — fetch a plan diff for preview.
    {
      const m = url.match(/^\/atlas\/workshop\/diffs\/([^/]+)$/)
      if (m && method === 'GET') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const diffId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { data, error } = await sb
          .from('plan_diffs')
          .select('id, session_id, diff_jsonb, verifier_audit_jsonb, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, applied_at, created_at')
          .eq('id', diffId)
          .single()
        if (error || !data) { json(res, 404, { error: 'diff_not_found' }); return }
        json(res, 200, { ok: true, diff: data })
        return
      }
    }

    // POST /atlas/workshop/diffs/:id/approve — mark approval only.
    //
    // 1.10bd-queue-pivot: approval no longer auto-dispatches. Previously
    // (commit 4ce5a3a) this handler inserted atlas_dispatches rows and
    // stamped applied_at — that path never actually wrote master-plan.md
    // and bypassed the filesystem queue, so it's been removed. The user
    // now explicitly hits POST /atlas/workshop/diffs/:id/queue (which
    // calls queueWorkshopDiff in lib/queue-orchestrator.ts) to land the
    // diff in master-plan + .agent/tasks/queued in a single git commit.
    //
    // Approve = "I'm happy with this diff" (lock it in for queue/archive).
    // Queue   = "ship the spec files now" (the atomic transactional path).
    {
      const m = url.match(/^\/atlas\/workshop\/diffs\/([^/]+)\/approve$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const diffId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const nowIso = new Date().toISOString()
        const { data: diffRow, error: diffErr } = await sb
          .from('plan_diffs')
          .update({ approved_by: principal.memberId, approved_at: nowIso })
          .eq('id', diffId)
          .is('approved_at', null)
          .is('rejected_at', null)
          .select('id, session_id, diff_jsonb')
          .single()
        if (diffErr || !diffRow) {
          json(res, 409, { error: 'diff_not_found_or_already_resolved', detail: diffErr?.message })
          return
        }
        if (diffRow.session_id) {
          await sb.from('plan_workshop_sessions')
            .update({ status: 'completed', completed_at: nowIso })
            .eq('id', diffRow.session_id)
        }

        const jsonb = (diffRow as { diff_jsonb?: { ops?: unknown[] } }).diff_jsonb
        const ops: unknown[] = Array.isArray(jsonb?.ops) ? jsonb!.ops! : []

        json(res, 200, {
          ok: true,
          diff_id: diffId,
          approved_at: nowIso,
          ops_total: ops.length,
          next_action: 'POST /atlas/workshop/diffs/:id/queue to land the spec files',
        })
        return
      }
    }

    // POST /atlas/workshop/diffs/:id/queue — 1.10bd-queue-pivot Step 3b.
    //
    // Atomic apply: read master-plan.md → compute new markdown in memory
    // → synthesize spec files → fs.rename into final locations → single
    // git commit + push. On push failure, hard-reset to origin/main so
    // the local commit and file changes are both discarded. Every
    // outcome lands in atlas_queue_operations with timestamps + op
    // counts + commit_sha + meta_json. See lib/queue-orchestrator.ts.
    //
    // Requires the diff to already be approved (approved_at set,
    // applied_at still null, not rejected). Frozen queue (boot recovery
    // tripped or rollback failed) short-circuits with 503.
    {
      const m = url.match(/^\/atlas\/workshop\/diffs\/([^/]+)\/queue$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        if (isQueueFrozen()) {
          json(res, 503, { error: 'queue_frozen', reason: getQueueFreezeReason() })
          return
        }
        const diffId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const { data: diffRow, error: diffErr } = await sb
          .from('plan_diffs')
          .select('id, session_id, diff_jsonb, approved_at, applied_at, rejected_at')
          .eq('id', diffId)
          .single()
        if (diffErr || !diffRow) {
          json(res, 404, { error: 'diff_not_found', detail: diffErr?.message })
          return
        }
        const row = diffRow as { id: string; session_id: string | null; diff_jsonb: { ops?: unknown[]; summary?: string } | null; approved_at: string | null; applied_at: string | null; rejected_at: string | null }
        if (!row.approved_at) { json(res, 409, { error: 'diff_not_approved' }); return }
        if (row.applied_at) { json(res, 409, { error: 'diff_already_applied', applied_at: row.applied_at }); return }
        if (row.rejected_at) { json(res, 409, { error: 'diff_rejected' }); return }

        // Resolve member: prefer the diff's owning workshop session
        // (plan_workshop_sessions.created_by — the column is `created_by`,
        // not `member_id`), fall back to the caller. Used only for
        // atlas_queue_operations.member_id.
        let memberId: string | null = principal.memberId ?? null
        if (row.session_id) {
          const { data: sessRow } = await sb
            .from('plan_workshop_sessions')
            .select('created_by')
            .eq('id', row.session_id)
            .maybeSingle()
          if (sessRow && (sessRow as { created_by?: string | null }).created_by) {
            memberId = (sessRow as { created_by: string }).created_by
          }
        }

        const jsonb = row.diff_jsonb ?? { ops: [] }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ops shape is
        // validated inside applyOpsToMasterPlan; passing through as the imported
        // PlanDiffOp union without re-declaring the discriminated tuple here.
        const ops = Array.isArray(jsonb.ops) ? (jsonb.ops as any[]) : []

        try {
          const result = await queueWorkshopDiff({
            diffId,
            memberId,
            sessionId: row.session_id,
            ops,
            diffJsonb: { ops, summary: jsonb.summary },
          })
          const httpStatus = result.ok ? 200 : (result.status === 'rolled_back' ? 502 : 500)
          json(res, httpStatus, {
            ok: result.ok,
            status: result.status,
            diff_id: diffId,
            queue_op_id: result.queueOpId,
            applied_at: result.appliedAt,
            ops_total: result.opsTotal,
            ops_applied: result.opsApplied,
            ops_skipped: result.opsSkipped,
            specs_drafted: result.specsDrafted,
            spec_paths: result.specPaths,
            commit_sha: result.commitSha,
            pushed: result.pushed,
            error: result.error,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          json(res, 500, { error: 'queue_unhandled', detail: msg })
        }
        return
      }
    }

    // POST /atlas/workshop/diffs/:id/reject — fully implemented; requires reason.
    {
      const m = url.match(/^\/atlas\/workshop\/diffs\/([^/]+)\/reject$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const diffId = decodeURIComponent(m[1])
        const body = await readBody(req)
        let payload: { reason?: string }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (!payload.reason || typeof payload.reason !== 'string' || payload.reason.trim().length < 3) {
          json(res, 400, { error: 'reason required (≥3 chars)' })
          return
        }
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const nowIso = new Date().toISOString()
        const { data: diffRow, error: diffErr } = await sb
          .from('plan_diffs')
          .update({ rejected_by: null, rejected_at: nowIso, rejection_reason: payload.reason.trim() })
          .eq('id', diffId)
          .is('approved_at', null)
          .is('rejected_at', null)
          .select('id, session_id')
          .single()
        if (diffErr || !diffRow) {
          json(res, 409, { error: 'diff_not_found_or_already_resolved', detail: diffErr?.message })
          return
        }
        if (diffRow.session_id) {
          await sb.from('plan_workshop_sessions')
            .update({ status: 'abandoned', completed_at: nowIso })
            .eq('id', diffRow.session_id)
        }
        json(res, 200, { ok: true, diff_id: diffId, rejected_at: nowIso, rejection_reason: payload.reason.trim() })
        return
      }
    }

    // POST /atlas/workshop/diffs/:id/revise — re-open the session to refine.
    // Clears 'awaiting_approval' on the session, marks the diff as superseded
    // (rejected with reason='revised').
    {
      const m = url.match(/^\/atlas\/workshop\/diffs\/([^/]+)\/revise$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const diffId = decodeURIComponent(m[1])
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
        const nowIso = new Date().toISOString()
        const { data: diffRow, error: diffErr } = await sb
          .from('plan_diffs')
          .update({ rejected_by: null, rejected_at: nowIso, rejection_reason: 'revised — session re-opened' })
          .eq('id', diffId)
          .is('approved_at', null)
          .is('rejected_at', null)
          .select('id, session_id')
          .single()
        if (diffErr || !diffRow) {
          json(res, 409, { error: 'diff_not_found_or_already_resolved', detail: diffErr?.message })
          return
        }
        if (diffRow.session_id) {
          await sb.from('plan_workshop_sessions')
            .update({ status: 'active', plan_diff_id: null, completed_at: null })
            .eq('id', diffRow.session_id)
        }
        json(res, 200, { ok: true, diff_id: diffId, session_id: diffRow.session_id, status: 'active' })
        return
      }
    }

    // ─── 1.10bb-c Session 5: verifier-dialog (pause/resume/abort) ─────────
    // POST /atlas/verifier-dialog/pause — set builder_pause_token + alert.
    if (url === '/atlas/verifier-dialog/pause' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const rawBody = await readBody(req)
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(rawBody) as Record<string, unknown> } catch { json(res, 400, { error: 'invalid_json' }); return }
      const dispatchId = String((body as { dispatch_id?: unknown }).dispatch_id ?? '')
      const reason = String((body as { reason?: unknown }).reason ?? '')
      const rawPaths = (body as { paths?: unknown }).paths
      const paths = Array.isArray(rawPaths) ? rawPaths.map((p) => String(p)).slice(0, 4) : []
      if (!dispatchId || !reason) {
        json(res, 400, { error: 'missing_fields', required: ['dispatch_id', 'reason'] })
        return
      }
      const { pauseBuilder } = await import('./lib/verifier-dialog.js')
      const result = await pauseBuilder(dispatchId, reason, paths)
      json(res, result.ok ? 200 : 500, result)
      return
    }

    // POST /atlas/verifier-dialog/:dispatchId/resume — clear the token.
    {
      const m = url.match(/^\/atlas\/verifier-dialog\/([^/]+)\/resume$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const dispatchId = decodeURIComponent(m[1])
        const { resumeBuilder } = await import('./lib/verifier-dialog.js')
        const result = await resumeBuilder(dispatchId)
        json(res, result.ok ? 200 : 500, result)
        return
      }
    }

    // POST /atlas/verifier-dialog/:dispatchId/abort — clear token + set
    // status='aborted'.
    {
      const m = url.match(/^\/atlas\/verifier-dialog\/([^/]+)\/abort$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const dispatchId = decodeURIComponent(m[1])
        const rawBody = await readBody(req).catch(() => '{}')
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(rawBody || '{}') as Record<string, unknown> } catch { body = {} }
        const reason = typeof (body as { reason?: unknown }).reason === 'string'
          ? (body as { reason: string }).reason : undefined
        const { abortBuilder } = await import('./lib/verifier-dialog.js')
        const result = await abortBuilder(dispatchId, reason)
        json(res, result.ok ? 200 : 500, result)
        return
      }
    }

    // GET /atlas/verifier-dialog/paused — list currently-paused dispatches.
    // Used by the cockpit's VerifierDialogPopup on mount before realtime
    // subscriptions take over.
    if (url === '/atlas/verifier-dialog/paused' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const sb = getSupabaseClient()
      if (!sb) { json(res, 503, { error: 'supabase_unavailable' }); return }
      const { data, error } = await sb
        .from('atlas_dispatches')
        .select('id, tool, initiated_at, status, builder_pause_token, error_message')
        .not('builder_pause_token', 'is', null)
        .order('initiated_at', { ascending: false })
        .limit(20)
      if (error) { json(res, 500, { error: 'query_failed', detail: error.message }); return }
      json(res, 200, { paused: data ?? [] })
      return
    }


    // ─── 1.10bb-c Session 3: per-phase wizard endpoints DELETED ─────────────
    // The wizard is replaced by Plan Workshop. Session 6 ships
    // /atlas/workshop/* (start / answer / finalize / approve / reject / etc.).
    // Until those land, every old wizard URL returns 410 Gone with a clear
    // pointer so cockpit clients fail loudly instead of silently 404-ing.
    //
    // Affected URLs (all return 410):
    //   POST /atlas/plan/wizard/propose
    //   POST /atlas/plan/wizard/finalize
    //   POST /atlas/wizard/start
    //   POST /atlas/wizard/answer
    //   GET  /atlas/wizard/session/:id
    //   DELETE /atlas/wizard/session/:id
    //   GET  /atlas/wizard/resumable
    //
    // The `/atlas/plan/follow` route a few blocks below also ends up 500-ing
    // because plan-action-handler.followPhase is now a throwing stub — that's
    // expected breakage during the Session 3 → Session 4 window. Session 4
    // replaces the cockpit's Add/Modify/Follow surfaces with the Workshop tab,
    // and Session 6 wires the new approve-and-queue path that supersedes
    // /atlas/plan/follow entirely.
    {
      const isWizardPropose = url === '/atlas/plan/wizard/propose' && method === 'POST'
      const isWizardFinalize = url === '/atlas/plan/wizard/finalize' && method === 'POST'
      const isWizardStart = url === '/atlas/wizard/start' && method === 'POST'
      const isWizardAnswer = url === '/atlas/wizard/answer' && method === 'POST'
      const isWizardSessionGet = method === 'GET' && url.startsWith('/atlas/wizard/session/')
      const isWizardSessionDelete = method === 'DELETE' && url.startsWith('/atlas/wizard/session/')
      const isWizardResumable = method === 'GET' && url.startsWith('/atlas/wizard/resumable')
      if (
        isWizardPropose
        || isWizardFinalize
        || isWizardStart
        || isWizardAnswer
        || isWizardSessionGet
        || isWizardSessionDelete
        || isWizardResumable
      ) {
        json(res, 410, {
          error: 'wizard_replaced_by_workshop',
          message:
            'The per-phase wizard was deleted in 1.10bb-c (Session 3). ' +
            'Plan Workshop replaces it. Session 6 of the workshop migration ' +
            'ships /atlas/workshop/* (start / answer / finalize / approve / reject). ' +
            'Cockpit Add/Modify/Follow buttons stop working until Session 4 lands the Workshop tab.',
          replacement_endpoints: [
            'POST /atlas/workshop/sessions',
            'POST /atlas/workshop/sessions/:id/answer',
            'POST /atlas/workshop/sessions/:id/finalize',
            'POST /atlas/workshop/sessions/:id/archive',
            'POST /atlas/workshop/sessions/:id/unarchive',
            'GET  /atlas/workshop/sessions/:id/diff',
            'POST /atlas/workshop/diffs/:id/approve',
            'POST /atlas/workshop/diffs/:id/queue',
            'POST /atlas/workshop/diffs/:id/reject',
            'POST /atlas/workshop/diffs/:id/revise',
          ],
        })
        return
      }
    }

    // POST /atlas/plan/follow — persist wizard-generated spec, set follow
    // state on the node, and (when isNewPhase) append phase to master plan.
    if (url === '/atlas/plan/follow' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: {
        plan_node_id?: string
        parent_title?: string
        phase_id?: string
        phase_hint?: string
        mode?: 'add' | 'modify'
        answers?: Array<{ question_id?: string; question_prompt?: string; answer?: string; free_text?: string }>
        concept_summaries?: string[]
        existing_spec?: string
        is_new_phase?: boolean
        override_spec_markdown?: string
      }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id || !payload.parent_title || !payload.phase_id) {
        json(res, 400, { error: 'plan_node_id, parent_title, and phase_id required' })
        return
      }
      try {
        const result = await followPhase({
          planNodeId: payload.plan_node_id,
          parentTitle: payload.parent_title,
          phaseId: payload.phase_id,
          phaseHint: payload.phase_hint ?? 'plan',
          mode: payload.mode ?? 'add',
          answers: (payload.answers ?? []).map(a => ({
            questionId: a.question_id ?? '',
            questionPrompt: a.question_prompt ?? '',
            answer: a.answer ?? '',
            freeText: a.free_text,
          })),
          conceptSummaries: payload.concept_summaries,
          existingSpec: payload.existing_spec,
          isNewPhase: payload.is_new_phase === true,
          actorPhone: principal.phone,
          overrideSpecMarkdown: payload.override_spec_markdown,
        })
        json(res, result.ok ? 200 : 409, result)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/revisit — toggle revisit state on a node.
    if (url === '/atlas/plan/revisit' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: { plan_node_id?: string }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.plan_node_id) { json(res, 400, { error: 'plan_node_id required' }); return }
      try {
        const r = await toggleRevisit(payload.plan_node_id)
        json(res, r.ok ? 200 : 500, r)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/build-runner — pre-flight + execute the build runner.
    // Two-phase API: ?action=preflight for the dry-run, default action is
    // 'run' which actually writes specs / sets state.
    if (url.split('?')[0] === '/atlas/plan/build-runner' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: {
        nodes?: Array<{
          plan_node_id?: string
          title?: string
          body?: string
          phase_hint?: string
          depends_on?: string[]
        }>
        mode?: 'approve-all' | 'per-phase'
        action?: 'preflight' | 'run'
      }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      const nodes: BuildRunnerNode[] = (payload.nodes ?? [])
        .filter(n => typeof n.plan_node_id === 'string' && typeof n.title === 'string')
        .map(n => ({
          planNodeId: n.plan_node_id!,
          title: n.title!,
          body: n.body ?? '',
          phaseHint: n.phase_hint ?? 'plan',
          dependsOn: n.depends_on,
        }))
      const action = payload.action ?? 'run'
      try {
        const pre = buildRunnerPreflight(nodes)
        if (action === 'preflight') {
          json(res, 200, { ok: true, preflight: pre })
          return
        }
        const runResult = await buildRunnerRun(pre.ordered, payload.mode ?? 'approve-all')
        json(res, runResult.ok ? 200 : 500, { ok: runResult.ok, preflight: pre, run: runResult })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // POST /atlas/plan/approve — unified approval router. Dashboard panel
    // calls this directly with via='panel'. Chat handlers + WhatsApp webhook
    // also funnel through here. WhatsApp callers must pass approver_phone;
    // we validate it matches MUZAMMIL_WHATSAPP before recording.
    if (url === '/atlas/plan/approve' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const body = await readBody(req)
      let payload: {
        phase_id?: string
        via?: 'panel' | 'chat' | 'whatsapp'
        approver_phone?: string
        decision?: 'approve' | 'skip' | 'pause' | 'modify'
        raw_message?: string
      }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.phase_id || !payload.via) {
        json(res, 400, { error: 'phase_id and via required' })
        return
      }
      // Decision parsing — if raw_message present and decision missing, derive.
      let decision = payload.decision
      if (!decision && payload.raw_message) {
        decision = parseKeywordDecision(payload.raw_message) ?? undefined
      }
      // WhatsApp lane: validate sender matches admin phone.
      if (payload.via === 'whatsapp') {
        if (!payload.approver_phone || !isApprovedWhatsAppSender(payload.approver_phone)) {
          json(res, 403, { error: 'whatsapp_sender_not_admin' })
          return
        }
      }
      try {
        const result = await routeApproval({
          phaseId: payload.phase_id,
          via: payload.via,
          approvedBy: payload.approver_phone ?? principal.phone,
          decision,
          rawMessage: payload.raw_message,
        })
        json(res, result.ok ? 200 : 500, result)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/workflow/graph' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      try {
        const graph = await getWorkflowGraph()
        json(res, 200, graph)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/workflow/refresh' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'owner')) {
        json(res, 403, { error: 'role_insufficient', required: 'owner' })
        return
      }
      clearWorkflowCache()
      try {
        const graph = await getWorkflowGraph()
        json(res, 200, { ok: true, source: graph.source, updated_at: graph.updated_at, nodes: graph.nodes.length })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url.split('?')[0] === '/atlas/workflow/related-specs' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      try {
        const queryStr = url.includes('?') ? url.split('?')[1] : ''
        const q = new URLSearchParams(queryStr).get('q') ?? ''
        const hits = await findRelatedSpecs(q)
        json(res, 200, { hits })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10ap: audit feed + builder queue manager ─────────────────
    // Show only the LATEST run per task. If the latest verdict for a task is
    // pass, the task is resolved — don't surface ancient fails for it.
    // Without this filter the audit tab showed every historic fail row, so
    // task IDs from phase-1.10a..h kept generating fix-prompts long after
    // their code had been superseded by later phases.
    if (url.split('?')[0] === '/atlas/verifier/runs' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { runs: [] }); return }
      const queryStr = url.includes('?') ? url.split('?')[1] : ''
      const params = new URLSearchParams(queryStr)
      const limitRaw = params.get('limit')
      const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 200)
      const includeAll = params.get('include_all') === '1'
      // Pull a wider window so we can collapse to latest-per-task and still
      // return `limit` distinct tasks worth of unresolved rows.
      const { data, error } = await sb
        .from('verifier_runs')
        .select('id, task_id, commit_sha, mode, passed, gaps, duration_ms, ran_at')
        .order('ran_at', { ascending: false })
        .limit(includeAll ? limit : Math.max(limit * 4, 200))
      if (error) { json(res, 500, { error: error.message }); return }
      const rows = data ?? []
      const filtered = includeAll ? rows : collapseLatestPerTask(rows, 'task_id', 'passed').slice(0, limit)
      json(res, 200, { runs: filtered })
      return
    }

    if (url.split('?')[0] === '/atlas/designer/runs' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { runs: [] }); return }
      const queryStr = url.includes('?') ? url.split('?')[1] : ''
      const params = new URLSearchParams(queryStr)
      const limitRaw = params.get('limit')
      const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 200)
      const includeAll = params.get('include_all') === '1'
      const { data, error } = await sb
        .from('designer_runs')
        .select('id, task_id, verdict, ai_judgment, created_at')
        .order('created_at', { ascending: false })
        .limit(includeAll ? limit : Math.max(limit * 4, 200))
      if (error) { json(res, 500, { error: error.message }); return }
      const rows = data ?? []
      const filtered = includeAll ? rows : collapseLatestDesignerPerTask(rows).slice(0, limit)
      json(res, 200, { runs: filtered })
      return
    }

    if (url.split('?')[0] === '/atlas/health/build-loop' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { attempts: [], ts: new Date().toISOString() }); return }
      const queryStr = url.includes('?') ? url.split('?')[1] : ''
      const params = new URLSearchParams(queryStr)
      const limitRaw = params.get('limit')
      const limit = Math.min(Math.max(parseInt(limitRaw ?? '3', 10) || 3, 1), 10)
      const { data, error } = await sb
        .from('atlas_build_attempts')
        .select('id, task_id, spec_filename, primary_domain, status, attempt_number, planned_at, shipped_at, verified_at, completed_at')
        .order('planned_at', { ascending: false })
        .limit(limit)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { attempts: data ?? [], ts: new Date().toISOString() })
      return
    }

    // POST /atlas/audit/recheck { kind, task_id }
    // Re-runs verifier or designer for a task at current HEAD. If the new
    // verdict is pass, the audit-feed dedup hides all the older fail rows
    // so the task drops out of the audit tab automatically.
    if (url === '/atlas/audit/recheck' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const raw = await readBody(req)
      let payload: { kind?: string; task_id?: string }
      try { payload = JSON.parse(raw) } catch { json(res, 400, { error: 'invalid JSON' }); return }
      const kind = payload.kind
      const taskId = payload.task_id
      if (!taskId || (kind !== 'verifier' && kind !== 'designer')) {
        json(res, 400, { error: 'kind must be verifier|designer; task_id required' })
        return
      }
      // Resolve current HEAD on the Atlas worker's repo clone. If the clone
      // is stale we still proceed — Verifier itself runs git fetch + reset
      // to head_after before auditing.
      let headSha = 'unknown'
      try {
        const execFileP = promisify(execFile)
        const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
          cwd: process.env.REPO_ROOT ?? '/workspace/cropsintel-v3',
        })
        headSha = stdout.trim()
      } catch (err) {
        console.warn('[atlas] recheck: failed to read HEAD —', err instanceof Error ? err.message : err)
      }
      try {
        let result: unknown
        if (kind === 'verifier') {
          result = await verifierAudit(taskId, undefined, headSha)
        } else {
          // Designer needs head_before too; pass HEAD for both — designer
          // re-audits the deployed UI at that SHA.
          result = await designerAuditCommit(taskId, headSha, headSha)
        }
        json(res, 200, { ok: true, kind, task_id: taskId, head: headSha, result })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[atlas] recheck ${kind}/${taskId} failed:`, msg)
        json(res, 500, { ok: false, error: msg })
      }
      return
    }

    // Phase 1.10as — recent Designer screenshots for the cockpit Preview tab.
    if (url.split('?')[0] === '/atlas/designer/recent-screenshots' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { screenshots: [] }); return }
      const queryStr = url.includes('?') ? url.split('?')[1] : ''
      const limitRaw = new URLSearchParams(queryStr).get('limit')
      const limit = Math.min(Math.max(parseInt(limitRaw ?? '12', 10) || 12, 1), 50)
      const { data, error } = await sb
        .from('designer_runs')
        .select('id, task_id, verdict, screenshot_url, head_after, created_at')
        .not('screenshot_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { screenshots: data ?? [] })
      return
    }

    if (url === '/atlas/builder/queue' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      try {
        const order = await builderQueueOrder()
        const queued = order.order.map(s => ({
          id: s.id,
          filename: `${s.id}.md`,
          priority: s.priority,
          depends_on: s.depends_on,
          blocked: s.blocked,
          blocked_by: s.blocked_by,
          paused: s.paused,
        }))
        // List in-flight specs by reading .agent/tasks/in-progress/.
        const inProgressDir = `${process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'}/.agent/tasks/in-progress`
        const logsDir = `${process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'}/.agent/tasks/logs`
        const fs = await import('fs/promises')

        // Phase 1.10ai: discover the youngest log mtime for any spec, so the
        // dashboard can render "in audit phase" instead of "Builder unresponsive"
        // when the heartbeat is stale but the log is being appended (e.g. mid-
        // Verifier/Designer run).
        const logEntries = await fs.readdir(logsDir).catch(() => [] as string[])
        const logAgeBySpec = async (specId: string): Promise<number> => {
          const prefix = `${specId}-`
          let youngest = Number.POSITIVE_INFINITY
          for (const entry of logEntries) {
            if (!entry.startsWith(prefix) || !entry.endsWith('.log')) continue
            try {
              const s = await fs.stat(`${logsDir}/${entry}`)
              const ageMs = Date.now() - s.mtime.getTime()
              if (ageMs < youngest) youngest = ageMs
            } catch { /* skip */ }
          }
          return youngest / 60_000
        }

        let inFlight: Array<{ id: string; filename: string; started_at: string | null; log_fresh: boolean }> = []
        try {
          const files = await fs.readdir(inProgressDir)
          inFlight = await Promise.all(
            files.filter(f => f.endsWith('.md') && f !== '_template.md').map(async filename => {
              const id = filename.replace(/\.md$/, '')
              let started_at: string | null = null
              try {
                const stat = await fs.stat(`${inProgressDir}/${filename}`)
                started_at = stat.mtime.toISOString()
              } catch { /* ignore */ }
              const ageMin = await logAgeBySpec(id)
              return { id, filename, started_at, log_fresh: ageMin < 5 }
            }),
          )
        } catch {
          inFlight = []
        }

        // Phase 1.10ag: include builder_heartbeat so the cockpit can show
        // Builder's actual liveness next to the in-flight spec.
        const builder_heartbeat = await readBuilderHeartbeat()

        json(res, 200, { queued, in_flight: inFlight, builder_heartbeat })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // Phase 1.10ag: GET /atlas/builder/heartbeat — reads atlas_config.builder_heartbeat
    // mirrored from the receiver above. Bare wrapper so the cockpit + reaper can
    // poll the same source of truth without re-reading the agent_heartbeats row.
    if (url === '/atlas/builder/heartbeat' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      const heartbeat = await readBuilderHeartbeat()
      json(res, 200, heartbeat)
      return
    }

    // Phase 1.10ag: POST /atlas/cleanup/ghosts — admin only. Scans
    // .agent/tasks/in-progress/, deletes any file whose name also exists in
    // cancelled/, failed/, or done/ (those copies are the source of truth —
    // the in-progress copy is the ghost). Commits + pushes if anything changed.
    if (url === '/atlas/cleanup/ghosts' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      try {
        const result = await cleanupGhostDuplicates()
        json(res, 200, result)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    {
      const priorityMatch = url.match(/^\/atlas\/builder\/queue\/([^/]+)\/priority$/)
      if (priorityMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const taskId = decodeURIComponent(priorityMatch[1])
        const body = await readBody(req)
        let payload: { priority?: number }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (typeof payload.priority !== 'number') {
          json(res, 400, { error: 'priority must be a number 1..10' })
          return
        }
        try {
          const result = await builderSetPriority(taskId, payload.priority)
          json(res, 200, { ok: true, updated: result.updated })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    {
      const cancelMatch = url.match(/^\/atlas\/builder\/queue\/([^/]+)\/cancel$/)
      if (cancelMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const taskId = decodeURIComponent(cancelMatch[1])
        try {
          await builderCancelTask(taskId)
          json(res, 200, { ok: true })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // H.1: force-cancel — works on queued/ AND in-progress/ specs.
    // Used to recover zombies (Builder crashed mid-run, file stuck in
    // in-progress/ for hours). Requires admin role; same gate as cancel.
    {
      const forceCancelMatch = url.match(/^\/atlas\/builder\/queue\/([^/]+)\/force-cancel$/)
      if (forceCancelMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const taskId = decodeURIComponent(forceCancelMatch[1])
        try {
          const result = await builderForceCancelTask(taskId)
          json(res, 200, { ok: true, from_bucket: result.from_bucket, sha: result.sha, pushed: result.pushed })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // Pillar B.1: positional move (swap priorities with adjacent neighbor).
    {
      const moveMatch = url.match(/^\/atlas\/builder\/queue\/([^/]+)\/move$/)
      if (moveMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const taskId = decodeURIComponent(moveMatch[1])
        const body = await readBody(req)
        let payload: { direction?: 'up' | 'down' }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        if (payload.direction !== 'up' && payload.direction !== 'down') {
          json(res, 400, { error: "direction must be 'up' or 'down'" })
          return
        }
        try {
          const result = await builderMovePosition(taskId, payload.direction)
          json(res, 200, result)
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // Pillar B.2: pause / resume.
    {
      const pauseMatch = url.match(/^\/atlas\/builder\/queue\/([^/]+)\/pause$/)
      if (pauseMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const taskId = decodeURIComponent(pauseMatch[1])
        try {
          const result = await builderPauseTask(taskId)
          json(res, 200, { ok: true, updated: result.updated, sha: result.sha })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    {
      const resumeMatch = url.match(/^\/atlas\/builder\/queue\/([^/]+)\/resume$/)
      if (resumeMatch && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const taskId = decodeURIComponent(resumeMatch[1])
        try {
          const result = await builderResumeTask(taskId)
          json(res, 200, { ok: true, updated: result.updated, sha: result.sha })
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // ─── Phase 1.10ax: agent heartbeats + live visibility ──────────────────

    // POST /atlas/agents/:agent/heartbeat — service-bearer only.
    {
      const m = url.match(/^\/atlas\/agents\/([a-z0-9-]+)\/heartbeat$/)
      if (m && method === 'POST') {
        const principal = await authenticate(req)
        if (!principal || principal.sessionId !== 'service') {
          json(res, 401, { error: 'service_bearer_required' })
          return
        }
        const agent = m[1].toLowerCase()
        const body = await readBody(req)
        let payload: { state?: string; task?: string | null; elapsed_s?: number; msg?: string | null }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        const validStates = ['idle', 'starting', 'running', 'shipping', 'verifying', 'unreachable', 'stale']
        if (!payload.state || !validStates.includes(payload.state)) {
          json(res, 400, { error: 'state must be one of: ' + validStates.join('|') })
          return
        }
        // Rate-limit at receiver (NEVER list: max one per 30s per agent).
        const last = heartbeatLastWrite.get(agent) ?? 0
        const now = Date.now()
        if (now - last < HEARTBEAT_MIN_INTERVAL_MS) {
          json(res, 200, { ok: true, throttled: true })
          return
        }
        heartbeatLastWrite.set(agent, now)
        const sb = getSupabaseClient()
        if (!sb) { json(res, 503, { error: 'Supabase not configured' }); return }
        const beatAt = new Date().toISOString()
        const { error } = await sb
          .from('atlas_agent_heartbeats')
          .upsert({
            agent,
            state: payload.state,
            task: payload.task ? String(payload.task).slice(0, 200) : null,
            elapsed_s: typeof payload.elapsed_s === 'number' ? Math.max(0, Math.floor(payload.elapsed_s)) : 0,
            msg: payload.msg ? String(payload.msg).slice(0, 500) : null,
            updated_at: beatAt,
          }, { onConflict: 'agent' })
        if (error) { json(res, 500, { error: error.message }); return }

        // Phase 1.10ag: mirror Builder's beat into atlas_config.builder_heartbeat
        // so the reaper can distinguish "spec mtime is old AND Builder is dead"
        // from "spec mtime is old BUT Builder is still beating on it." Only fires
        // for the builder agent — other agents have their own heartbeat surfaces.
        if (agent === 'builder') {
          const isActive = payload.state !== 'idle' && payload.state !== 'unreachable' && payload.state !== 'stale'
          const heartbeatValue = JSON.stringify({
            spec_id: isActive && payload.task ? String(payload.task).slice(0, 200) : null,
            beat_at: beatAt,
            state: payload.state,
            elapsed_s: typeof payload.elapsed_s === 'number' ? Math.max(0, Math.floor(payload.elapsed_s)) : 0,
          })
          const { error: cfgErr } = await sb
            .from('atlas_config')
            .upsert({
              key: 'builder_heartbeat',
              value: heartbeatValue,
              set_by: 'builder-heartbeat',
              updated_at: beatAt,
            }, { onConflict: 'key' })
          if (cfgErr) {
            console.warn('[atlas-heartbeat] atlas_config.builder_heartbeat mirror failed:', cfgErr.message)
          }
        }

        json(res, 200, { ok: true })
        return
      }
    }

    // GET /atlas/agents/heartbeats — viewer+ (any authenticated principal).
    if (url === '/atlas/agents/heartbeats' && method === 'GET') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const sb = getSupabaseClient()
      if (!sb) { json(res, 200, { heartbeats: [] }); return }
      const { data, error } = await sb
        .from('atlas_agent_heartbeats')
        .select('agent, state, task, elapsed_s, msg, updated_at')
        .order('updated_at', { ascending: false })
      if (error) { json(res, 500, { error: error.message }); return }
      json(res, 200, { heartbeats: data ?? [] })
      return
    }

    // GET /atlas/agents/:agent/logs?limit=N — admin+.
    {
      const m = url.match(/^\/atlas\/agents\/([a-z0-9-]+)\/logs(?:\?.*)?$/)
      if (m && method === 'GET') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const agent = m[1].toLowerCase()
        const serviceId = AGENT_SERVICE_IDS[agent]
        if (!serviceId) {
          json(res, 400, { error: `no service id configured for agent '${agent}'` })
          return
        }
        const qIdx = url.indexOf('?')
        const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : new URLSearchParams()
        const limit = Math.min(500, Math.max(10, parseInt(params.get('limit') ?? '50', 10) || 50))
        try {
          const lines = await fetchRailwayLogs(serviceId, limit)
          json(res, 200, { agent, lines })
        } catch (err) {
          json(res, 502, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // POST /atlas/agents/:agent/restart — admin+ (operator+ per spec but we keep admin gate consistent with cancel/queue).
    {
      const m = url.match(/^\/atlas\/agents\/([a-z0-9-]+)\/restart$/)
      if (m && method === 'POST') {
        const principal = await requireAuth(req, res)
        if (!principal) return
        if (!roleAtLeast(principal.role, 'admin')) {
          json(res, 403, { error: 'role_insufficient', required: 'admin' })
          return
        }
        const agent = m[1].toLowerCase()
        const serviceId = AGENT_SERVICE_IDS[agent]
        if (!serviceId) {
          json(res, 400, { error: `no service id configured for agent '${agent}'` })
          return
        }
        try {
          await railwayRedeployAgent(serviceId)
          json(res, 200, { ok: true, agent })
        } catch (err) {
          json(res, 502, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    // POST /atlas/agents/builder/force-pick — owner/admin only (separate intent from restart).
    if (url === '/atlas/agents/builder/force-pick' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      if (!roleAtLeast(principal.role, 'admin')) {
        json(res, 403, { error: 'role_insufficient', required: 'admin' })
        return
      }
      const serviceId = AGENT_SERVICE_IDS.builder
      if (!serviceId) {
        json(res, 400, { error: 'RAILWAY_BUILDER_SERVICE_ID not set' })
        return
      }
      try {
        await railwayRedeployAgent(serviceId)
        json(res, 200, { ok: true, intent: 'force-pick' })
      } catch (err) {
        json(res, 502, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10al: smart diagnosis for Active Artifacts ────────────────
    if (url === '/atlas/artifacts/diagnose' && method === 'POST') {
      if (!(await requireAuth(req, res))) return
      const body = await readBody(req)
      let payload: { kind?: string; ref?: string; payload?: Record<string, unknown> }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }

      const validKinds: DiagnoseArtifactKind[] = [
        'designer_audit', 'verifier_run', 'workflow_violation', 'open_fork', 'pending_spec',
      ]
      if (!payload.kind || !validKinds.includes(payload.kind as DiagnoseArtifactKind)) {
        json(res, 400, { error: 'kind must be one of designer_audit|verifier_run|workflow_violation|open_fork|pending_spec' })
        return
      }
      if (!payload.ref || typeof payload.ref !== 'string') {
        json(res, 400, { error: 'ref is required' })
        return
      }
      const artifactPayload = payload.payload ?? {}

      try {
        const input: ArtifactInput = {
          kind: payload.kind as DiagnoseArtifactKind,
          ref: payload.ref,
          payload: artifactPayload,
        }
        let result = await diagnose(input)

        // Discuss bucket: enrich the chat seed with a workflow-chain trace so
        // Atlas's first response in chat reads like a senior engineer's diag.
        if (result.bucket === 'discuss') {
          const trace = await traceArtifact(artifactPayload)
          if (trace.task_id) {
            const traced = formatTraceForChat(trace)
            result = {
              ...result,
              chat_seed: `${result.chat_seed}\n\n---\n\n${traced}`,
            }
          }
        }

        // Claude-code bucket: replace the LLM-drafted prompt with the
        // canonical, file-embedded prompt builder so the user actually has
        // file contents at hand.
        if (result.bucket === 'claude-code') {
          const taskId = (artifactPayload['task_id'] as string | undefined) ?? payload.ref.slice(0, 8)
          const evidence = JSON.stringify(artifactPayload, null, 2).slice(0, 4000)
          const richPrompt = await buildClaudeCodePrompt({
            problem: result.reason,
            affectedFiles: result.affected_files,
            evidence,
            taskId,
          })
          result = { ...result, prompt: richPrompt }
        }

        json(res, 200, result)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10aq: batch diagnose ──────────────────────────────────────
    // Body: { items: [{kind, ref, payload}] } (max 8 items per call).
    // Internally dispatches each through diagnose() with concurrency=5, then
    // produces a combined result the UI can render in a single card and
    // execute as one action group.
    if (url === '/atlas/artifacts/diagnose-batch' && method === 'POST') {
      if (!(await requireAuth(req, res))) return
      const rawBody = await readBody(req)
      let payload: {
        items?: Array<{ kind?: string; ref?: string; payload?: Record<string, unknown> }>
      }
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        json(res, 400, { error: 'items must be a non-empty array' })
        return
      }
      if (payload.items.length > 8) {
        json(res, 400, { error: 'batch capped at 8 items per call' })
        return
      }
      const validKinds: DiagnoseArtifactKind[] = [
        'designer_audit', 'verifier_run', 'workflow_violation', 'open_fork', 'pending_spec',
      ]
      const items: ArtifactInput[] = []
      for (const it of payload.items) {
        if (!it.kind || !validKinds.includes(it.kind as DiagnoseArtifactKind)) {
          json(res, 400, { error: `invalid kind: ${it.kind ?? '(missing)'}` })
          return
        }
        if (!it.ref || typeof it.ref !== 'string') {
          json(res, 400, { error: 'each item.ref is required' })
          return
        }
        items.push({
          kind: it.kind as DiagnoseArtifactKind,
          ref: it.ref,
          payload: it.payload ?? {},
        })
      }

      try {
        // Pre-flight: drop items whose underlying task has since passed.
        // Without this, fix-prompts kept getting generated for rows that
        // had already been resolved by later commits — operators wasted
        // cycles applying no-op patches. This mirrors the latest-per-task
        // dedup used by /atlas/verifier/runs and /atlas/designer/runs.
        const skippedResolved: Array<{ kind: DiagnoseArtifactKind; ref: string; reason: string }> = []
        const liveItems: ArtifactInput[] = []
        const sb = getSupabaseClient()
        for (const it of items) {
          const taskId = (it.payload['task_id'] as string | undefined) ?? null
          if (!sb || !taskId) {
            // No Supabase or no task_id → can't dedup; let the row through.
            liveItems.push(it)
            continue
          }
          let isResolved = false
          if (it.kind === 'verifier_run') {
            const { data } = await sb
              .from('verifier_runs')
              .select('passed, ran_at')
              .eq('task_id', taskId)
              .order('ran_at', { ascending: false })
              .limit(1)
            const latest = (data ?? [])[0] as { passed: boolean | null } | undefined
            if (latest?.passed === true) isResolved = true
          } else if (it.kind === 'designer_audit') {
            const { data } = await sb
              .from('designer_runs')
              .select('verdict, created_at')
              .eq('task_id', taskId)
              .order('created_at', { ascending: false })
              .limit(1)
            const latest = (data ?? [])[0] as { verdict: string | null } | undefined
            if (latest?.verdict === 'pass') isResolved = true
          }
          if (isResolved) {
            skippedResolved.push({ kind: it.kind, ref: it.ref, reason: 'task has passed since this audit row was written' })
          } else {
            liveItems.push(it)
          }
        }

        // Concurrency cap = 5. Simple worker-pool approach.
        const buckets: Array<{ kind: DiagnoseArtifactKind; ref: string; bucket: DiagnosisBucket }> = []
        let cursor = 0
        const worker = async (): Promise<void> => {
          while (cursor < liveItems.length) {
            const idx = cursor++
            const input = liveItems[idx]
            try {
              const bucket = await diagnose(input)
              buckets.push({ kind: input.kind, ref: input.ref, bucket })
            } catch (err) {
              // On a single-row failure, fall back to a discuss bucket so the
              // batch result still carries a placeholder row.
              const seed = `Diagnosis failed for ${input.kind}/${input.ref}: ${err instanceof Error ? err.message : String(err)}`
              buckets.push({
                kind: input.kind,
                ref: input.ref,
                bucket: { bucket: 'discuss', chat_seed: seed, reason: 'classifier failed' },
              })
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(5, liveItems.length || 1) }, () => worker()))

        // Build the combined result: per-bucket aggregations + one paste-able CC prompt.
        const autoRemediate = buckets
          .filter(b => b.bucket.bucket === 'auto-remediate')
          .map(b => {
            const bb = b.bucket as Extract<DiagnosisBucket, { bucket: 'auto-remediate' }>
            return {
              kind: b.kind,
              ref: b.ref,
              spec_filename: bb.spec_filename,
              spec_body: bb.spec_body,
              reason: bb.reason,
            }
          })

        const ccItems = buckets
          .filter(b => b.bucket.bucket === 'claude-code')
          .map(b => {
            const bb = b.bucket as Extract<DiagnosisBucket, { bucket: 'claude-code' }>
            const taskId = (items.find(i => i.ref === b.ref)?.payload['task_id'] as string | undefined) ?? b.ref.slice(0, 8)
            return {
              kind: b.kind,
              ref: b.ref,
              task_id: taskId,
              prompt: bb.prompt,
              affected_files: bb.affected_files,
              reason: bb.reason,
            }
          })

        const inAppItems = buckets
          .filter(b => b.bucket.bucket === 'in-app-action')
          .map(b => {
            const bb = b.bucket as Extract<DiagnosisBucket, { bucket: 'in-app-action' }>
            return {
              kind: b.kind,
              ref: b.ref,
              action_id: bb.action_id,
              label: bb.label,
              payload: bb.payload,
              reason: bb.reason,
            }
          })

        const discussItems = buckets
          .filter(b => b.bucket.bucket === 'discuss')
          .map(b => {
            const bb = b.bucket as Extract<DiagnosisBucket, { bucket: 'discuss' }>
            return { kind: b.kind, ref: b.ref, chat_seed: bb.chat_seed, reason: bb.reason }
          })

        // Combined CC prompt: one addressable paste covering all CC-bucket gaps.
        let combinedCcPrompt: string | null = null
        const combinedAffectedFiles: string[] = []
        if (ccItems.length > 0) {
          const fileSet = new Set<string>()
          for (const c of ccItems) for (const f of c.affected_files) fileSet.add(f)
          combinedAffectedFiles.push(...fileSet)
          const taskIds = ccItems.map(c => c.task_id).join(', ')
          const issues = ccItems
            .map((c, i) => {
              return `## Issue ${i + 1}: ${c.task_id}\n\n**Reason:** ${c.reason}\n\n**Affected files:** ${c.affected_files.join(', ') || '(none listed)'}\n\n**Original prompt detail:**\n\n${c.prompt}\n`
            })
            .join('\n\n---\n\n')
          combinedCcPrompt = `You're fixing ${ccItems.length} issue${ccItems.length === 1 ? '' : 's'} in cropsintel-v3 in one pass.\n\nAFFECTED FILES (deduped union):\n${combinedAffectedFiles.map(f => `- ${f}`).join('\n')}\n\n${issues}\n\n---\n\n## What to do\n\nApply each issue's fix in order. Run \`npm run build\` after each. Commit once at the end with:\n\n\`fix(atlas-pd): batch fix ${ccItems.length} artifacts — ${taskIds}\`\n`
        }

        // Combined discuss seed: single paste collapses N rows to one chat msg.
        let combinedDiscussSeed: string | null = null
        if (discussItems.length > 0) {
          combinedDiscussSeed = `${discussItems.length} artifact${discussItems.length === 1 ? '' : 's'} need discussion:\n\n${discussItems.map((d, i) => `${i + 1}. ${d.chat_seed.slice(0, 200)}`).join('\n\n')}`
        }

        json(res, 200, {
          results: buckets.map(b => ({ kind: b.kind, ref: b.ref, bucket: b.bucket.bucket })),
          combined: {
            auto_remediate: autoRemediate,
            claude_code: combinedCcPrompt
              ? { prompt: combinedCcPrompt, affected_files: combinedAffectedFiles, items: ccItems }
              : null,
            in_app: inAppItems,
            discuss: combinedDiscussSeed
              ? { seed: combinedDiscussSeed, items: discussItems }
              : null,
          },
          // Items dropped because their task has since passed. UI can toast
          // this so operators know why a 5-row selection produced 3 issues.
          skipped_resolved: skippedResolved,
        })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10aq: cascade analysis for an audit gap ───────────────────
    if (url === '/atlas/artifacts/cascade' && method === 'POST') {
      if (!(await requireAuth(req, res))) return
      const rawBody = await readBody(req)
      let payload: { commit_sha?: string; gap?: CascadeGapInput }
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.commit_sha || typeof payload.commit_sha !== 'string') {
        json(res, 400, { error: 'commit_sha is required' })
        return
      }
      if (!payload.gap || typeof payload.gap !== 'object') {
        json(res, 400, { error: 'gap is required' })
        return
      }
      try {
        const relation: CascadeRelation = await analyzeCascade(payload.commit_sha, payload.gap)
        json(res, 200, relation)
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10aq: queue an auto-fix from a cached diagnosis ───────────
    // Body: { diagnosis_id?: string, kind, ref, payload, spec_filename, spec_body }
    // Marks the diagnosis_cache row state=auto-fix-queued, queues the spec.
    if (url === '/atlas/artifacts/auto-fix-queue' && method === 'POST') {
      if (!(await requireAuth(req, res))) return
      const rawBody = await readBody(req)
      let payload: {
        kind?: string
        ref?: string
        payload?: Record<string, unknown>
        spec_filename?: string
        spec_body?: string
      }
      try { payload = JSON.parse(rawBody) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!payload.spec_filename || !payload.spec_body) {
        json(res, 400, { error: 'spec_filename and spec_body required' })
        return
      }
      if (!payload.kind || !payload.ref) {
        json(res, 400, { error: 'kind and ref required' })
        return
      }
      try {
        const result = await builderQueueSpec(payload.spec_filename, payload.spec_body)
        // Persist lifecycle on diagnosis cache. Match by (kind, payload_sha).
        const sb = getSupabaseClient()
        if (sb) {
          const taskIdFromPayload = (payload.payload?.['task_id'] as string | undefined) ?? null
          const commitShaFromPayload = (payload.payload?.['commit_sha'] as string | undefined) ?? null
          try {
            await sb
              .from('atlas_diagnosis_cache')
              .update({
                lifecycle_state: 'auto-fix-queued',
                lifecycle_updated_at: new Date().toISOString(),
                auto_fix_spec_filename: payload.spec_filename,
                auto_fix_queued_at: new Date().toISOString(),
                task_id: taskIdFromPayload,
                commit_sha: commitShaFromPayload,
              })
              .eq('artifact_kind', payload.kind)
              .eq('bucket', 'auto-remediate')
              .order('created_at', { ascending: false })
              .limit(1)
          } catch (err) {
            console.warn('[auto-fix-queue] cache update failed:', err)
          }
        }
        json(res, 200, {
          ok: true,
          spec_filename: payload.spec_filename,
          path: result.path,
          sha: result.sha,
          pushed: result.pushed,
        })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ─── Phase 1.10aq: fetch diagnosis lifecycle rows ──────────────────────
    if (url?.startsWith('/atlas/artifacts/diagnoses') && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      try {
        const sb = getSupabaseClient()
        if (!sb) { json(res, 200, { rows: [] }); return }
        const { data } = await sb
          .from('atlas_diagnosis_cache')
          .select('id, artifact_kind, bucket, lifecycle_state, lifecycle_updated_at, auto_fix_spec_filename, auto_fix_commit_sha, auto_fix_queued_at, auto_fix_shipped_at, auto_fix_resolved_at, auto_fix_failure_reason, task_id, commit_sha, result, reason, created_at')
          .neq('lifecycle_state', 'pending-user')
          .order('lifecycle_updated_at', { ascending: false })
          .limit(50)
        json(res, 200, { rows: data ?? [] })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/artifacts/move-to-discussion' && method === 'POST') {
      const principal = await requireAuth(req, res)
      if (!principal) return
      const body = await readBody(req)
      let payload: { items?: Array<{ kind?: string; ref?: string; context?: Record<string, unknown>; notes?: string }> }
      try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!Array.isArray(payload.items)) {
        json(res, 400, { error: 'items array required' })
        return
      }
      const validKinds = ['design_audit', 'open_fork', 'pending_spec', 'plan_node']
      const items = payload.items
        .filter(it => it && typeof it.kind === 'string' && typeof it.ref === 'string' && validKinds.includes(it.kind))
        .map(it => ({
          artifact_kind: it.kind as 'design_audit' | 'open_fork' | 'pending_spec' | 'plan_node',
          artifact_ref: it.ref!,
          context: it.context ?? {},
          notes: it.notes,
        }))
      try {
        const result = await moveItemsToDiscussion(items)
        json(res, 200, { ok: true, ...result })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (url === '/atlas/artifacts/discussion-queue' && method === 'GET') {
      if (!(await requireAuth(req, res))) return
      try {
        const items = await listDiscussionQueue()
        json(res, 200, { items })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    {
      const resolveMatch = url.match(/^\/atlas\/artifacts\/discussion\/([0-9a-f-]{36})\/resolve$/i)
      if (resolveMatch && method === 'POST') {
        if (!(await requireAuth(req, res))) return
        const id = resolveMatch[1]
        const body = await readBody(req)
        let payload: { resolution?: string }
        try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
        const validResolutions = ['queued', 'dismissed', 'forked']
        if (!payload.resolution || !validResolutions.includes(payload.resolution)) {
          json(res, 400, { error: 'resolution must be queued|dismissed|forked' })
          return
        }
        try {
          const result = await resolveDiscussionItem(id, payload.resolution as 'queued' | 'dismissed' | 'forked')
          if (!result.ok) {
            json(res, 500, { error: 'resolve_failed' })
            return
          }
          json(res, 200, { ok: true, id })
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    }

    if (!(await requireAuth(req, res))) return

    json(res, 404, { error: 'Not found' })
  })

  attachTtsWebSocket(server)

  // 1.10bd-queue-pivot Step 3b: detect ahead/behind/diverged on boot.
  // Behind → pull --rebase. Ahead with stuck in_progress queue ops →
  // freeze queue. Diverged → freeze + WhatsApp alert. See lib/queue-
  // orchestrator.ts bootGitRecovery() for the full state machine.
  try {
    const alertPhone = process.env.VERIFIER_ALERT_PHONE
    const recovery = await bootGitRecovery({
      notifyWhatsApp: alertPhone
        ? async (message: string) => { try { await sendWhatsAppReply(alertPhone, message) } catch { /* boot must not block */ } }
        : undefined,
    })
    console.log(`[boot] git-recovery: state=${recovery.state.state} action=${recovery.action} frozen=${recovery.queueFrozen}`)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.warn('[boot] git-recovery failed (continuing):', detail)
  }

  startSnapshotCron()
  startConductorLoop()
  // Phase 1.10ak: build repo index in the background so the wizard has fresh
  // facts. Never throws — Atlas keeps booting if GitHub is unreachable.
  void startRepoIndexLoop()

  // Phase 1.10ae: round-trip atlas_config write+read+delete BEFORE we start
  // accepting traffic. If the table is missing, RLS broke service_role, or
  // the env keys are wrong we want a loud log on every deploy — not a silent
  // revert of every user's mode to `passive` 30 seconds later. Failure does
  // NOT exit the process: Atlas can still answer chat with the env-default
  // mode, so we keep listening but log once per minute so the regression is
  // impossible to miss in Railway logs.
  try {
    await verifyTrustModePersistence()
    console.log('[boot] trust-mode persistence self-check: ok')
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[boot] FATAL: trust-mode persistence broken:', detail)
    setInterval(() => {
      console.error('[boot] trust-mode degraded — atlas_config not writable:', detail)
    }, 60_000)
  }

  server.listen(PORT, () => {
    console.log(`[atlas-server] Listening on :${PORT}`)
  })
}

// Deploy marker: 2026-05-12 02:30 — trigger Railway redeploy
