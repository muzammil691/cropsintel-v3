// Phase 1.10aw — server-side slash-command parser + dispatcher.
//
// Mirrors the cockpit's atlas-slash-commands.ts but runs entirely server-side
// so the WhatsApp inbound handler can recognize "/status", "queue", "slash help",
// etc. and reply with the formatted result without going through the LLM.
//
// Voice STT often produces "slash status" (with a space) or just "status"
// (no slash) — both forms are accepted. Plain-word recognition only fires when
// the message is JUST that word so conversational messages like "what's the
// status of the build" still fall through to chat.
//
// Cost-gating: each command declares an `estimatedCostUsd`. Cheap commands
// (Supabase reads) skip checkBudget(); anything that could trigger paid models
// goes through the gate first.
//
// Security: never expose the /help listing to a `viewer` role; viewers get a
// read-only subset.

import { roleAtLeast, type Role } from './auth'
import { checkBudget, getBurnRate } from './cost-gate'
import {
  statusSnapshot,
  builderListQueue,
  builderListDone,
  verifierAudit,
  adelaTriggerScrape,
  memoryIngest,
} from './tools'
import { getSupabaseClient } from './supabase'

// Mirror of server.ts's AuthPrincipal — duplicated locally to avoid a
// lib → server circular import. The shape MUST stay in sync; if server.ts adds
// a field, mirror it here only if the slash dispatchers actually need it.
export interface AuthPrincipal {
  phone: string
  sessionId: string
  role: Role
  memberId: string | null
}

export interface ParsedSlashCommand {
  name: string
  args: string[]
  raw: string
}

export interface SlashDispatchResult {
  text: string
  cost_usd?: number
}

interface SlashCommandSpec {
  name: string
  description: string
  /** Argument hint shown by /help. */
  argHint?: string
  /** Minimum role to invoke (default 'viewer'). */
  minRole?: Role
  /** Estimated USD cost — used to short-circuit checkBudget for cheap calls. */
  estimatedCostUsd: number
  handler: (args: string[], principal: AuthPrincipal) => Promise<string>
}

const COMMANDS: SlashCommandSpec[] = [
  {
    name: 'status',
    description: 'Snapshot of queue + cost + agent activity',
    estimatedCostUsd: 0.0005,
    handler: handleStatus,
  },
  {
    name: 'queue',
    description: 'List queued specs (numbered)',
    estimatedCostUsd: 0.0005,
    handler: handleQueue,
  },
  {
    name: 'done',
    description: 'Last 5 shipped specs',
    estimatedCostUsd: 0.0005,
    handler: handleDone,
  },
  {
    name: 'cost',
    description: 'Cost today + month-to-date',
    estimatedCostUsd: 0.0005,
    handler: handleCost,
  },
  {
    name: 'agents',
    description: '7-agent health line',
    estimatedCostUsd: 0.0005,
    handler: handleAgents,
  },
  {
    name: 'audit',
    description: 'Trigger verifier audit on a task ID',
    argHint: '<taskId>',
    minRole: 'operator',
    estimatedCostUsd: 0.05,
    handler: handleAudit,
  },
  {
    name: 'scrape',
    description: 'Trigger Adela scraper for a source',
    argHint: '<source>',
    minRole: 'operator',
    estimatedCostUsd: 0.02,
    handler: handleScrape,
  },
  {
    name: 'ingest',
    description: 'Trigger memory ingest of a knowledge source',
    argHint: '<source>',
    minRole: 'operator',
    estimatedCostUsd: 0.02,
    handler: handleIngest,
  },
  {
    name: 'help',
    description: 'List available commands',
    estimatedCostUsd: 0,
    handler: handleHelp,
  },
]

const VIEWER_COMMANDS = new Set(['status', 'queue', 'done', 'cost', 'agents', 'help'])

const PLAIN_WORD_COMMANDS = new Set(COMMANDS.map(c => c.name))

/**
 * Parse a slash command from inbound text. Recognizes:
 *
 *  - `/status`, `/status <args>` — leading slash
 *  - `slash status`, `atlas status` — voice-STT prefixes
 *  - bare `status` (or any other registered command name) when the entire
 *    message is JUST that single word — keeps "what's the build status"
 *    falling through to chat.
 *
 * Returns null when the input does not match any registered command.
 *
 * NEVER list compliance: filters OTP-looking 6-digit codes from the parsed
 * args so transcribed voice notes containing OTPs never propagate downstream.
 */
export function parseSlash(text: string): ParsedSlashCommand | null {
  if (!text) return null
  const raw = text.trim()
  if (!raw) return null

  // Form 1: leading slash.
  const slashMatch = raw.match(/^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/)
  if (slashMatch) {
    const name = slashMatch[1].toLowerCase()
    const argString = (slashMatch[2] ?? '').trim()
    if (!isKnownCommand(name)) return null
    return { name, args: tokenize(argString), raw }
  }

  // Form 2: "slash X" or "atlas X" prefix.
  const prefixMatch = raw.match(/^(?:slash|atlas)\s+([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/i)
  if (prefixMatch) {
    const name = prefixMatch[1].toLowerCase()
    const argString = (prefixMatch[2] ?? '').trim()
    if (!isKnownCommand(name)) return null
    return { name, args: tokenize(argString), raw }
  }

  // Form 3: bare command word — only when the WHOLE message is that single
  // word (avoids hijacking conversational use of "status", "help", etc.).
  const bareMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\.?$/)
  if (bareMatch) {
    const name = bareMatch[1].toLowerCase()
    if (PLAIN_WORD_COMMANDS.has(name)) {
      return { name, args: [], raw }
    }
  }

  return null
}

function tokenize(s: string): string[] {
  if (!s) return []
  // Strip 6-digit numeric tokens (likely OTP codes) so we never log them.
  return s.split(/\s+/).filter(tok => tok.length > 0 && !/^\d{6}$/.test(tok))
}

function isKnownCommand(name: string): boolean {
  return COMMANDS.some(c => c.name === name)
}

export async function dispatchSlashCommand(
  cmd: ParsedSlashCommand,
  principal: AuthPrincipal,
): Promise<SlashDispatchResult> {
  const spec = COMMANDS.find(c => c.name === cmd.name)
  if (!spec) {
    return { text: `Unknown command: /${cmd.name}. Send /help for the list.` }
  }

  // Role gate. Viewers can only invoke read-only commands.
  const minRole: Role = spec.minRole ?? 'viewer'
  if (!roleAtLeast(principal.role, minRole)) {
    return { text: `Sorry — /${cmd.name} requires role ${minRole}; you are ${principal.role}.` }
  }
  if (principal.role === 'viewer' && !VIEWER_COMMANDS.has(spec.name)) {
    return { text: `Sorry — /${cmd.name} is not available for viewer role.` }
  }

  // Cost-gate non-trivial commands.
  if (spec.estimatedCostUsd > 0.01) {
    const budget = await checkBudget(spec.estimatedCostUsd)
    if (!budget.allow) {
      return {
        text: `Budget gate hit, command skipped: ${budget.reason ?? budget.status}`,
        cost_usd: 0,
      }
    }
  }

  try {
    const text = await spec.handler(cmd.args, principal)
    return { text, cost_usd: spec.estimatedCostUsd }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `Command /${cmd.name} failed: ${msg}` }
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleStatus(_args: string[], _principal: AuthPrincipal): Promise<string> {
  const snap = await statusSnapshot() as {
    queuedSpecs: number
    inFlightSpecs: number
    doneSpecsTotal: number
    costTodayUsd: number
  }
  const cost = Number.isFinite(snap.costTodayUsd) ? snap.costTodayUsd : 0
  return `Queue: ${snap.queuedSpecs} | In flight: ${snap.inFlightSpecs} | Cost today: $${cost.toFixed(2)} | Done: ${snap.doneSpecsTotal}`
}

async function handleQueue(_args: string[], _principal: AuthPrincipal): Promise<string> {
  const { specs } = await builderListQueue()
  if (specs.length === 0) return 'Queue is empty.'
  const top = specs.slice(0, 20)
  const lines = top.map((s, i) => `${i + 1}. ${s.replace(/\.md$/, '')}`)
  const more = specs.length > top.length ? `\n…and ${specs.length - top.length} more.` : ''
  return `Queue (${specs.length}):\n${lines.join('\n')}${more}`
}

async function handleDone(args: string[], _principal: AuthPrincipal): Promise<string> {
  const filter = args[0]
  if (filter && !/^[a-zA-Z0-9._-]{1,80}$/.test(filter)) {
    return `Rejected: "${filter}" is not a valid filter (allowed: a-z, A-Z, 0-9, ._-, length 1-80).`
  }
  const { specs, count } = await builderListDone({ limit: 5, filter })
  if (specs.length === 0) {
    return filter ? `Nothing shipped matching "${filter}".` : 'Nothing shipped yet.'
  }
  // builderListDone returns ascending by name; take the last 5 (most recent
  // by lexicographic spec id).
  const recent = specs.slice(-5).reverse()
  const lines = recent.map((s, i) => `${i + 1}. ${s.replace(/\.md$/, '')}`)
  const header = filter
    ? `Last ${recent.length} shipped matching "${filter}" (of ${count} total):`
    : `Last ${recent.length} shipped (of ${count} total):`
  return `${header}\n${lines.join('\n')}`
}

async function handleCost(_args: string[], _principal: AuthPrincipal): Promise<string> {
  const burn = await getBurnRate()
  const byProv = Object.entries(burn.byProvider)
    .map(([p, v]) => `${p} $${v.toFixed(2)}`)
    .join(' · ')
  return `Today: $${burn.today.toFixed(2)} | MTD: $${burn.monthToDate.toFixed(2)} | Remaining: $${burn.capacity.toFixed(2)}${byProv ? `\n${byProv}` : ''}`
}

interface HeartbeatRow {
  agent: string
  state: string
  task: string | null
  updated_at: string
}

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  atlas: 'Atlas',
  builder: 'Builder',
  verifier: 'Verifier',
  designer: 'Designer',
  council: 'Council',
  memory: 'Memory',
  adela: 'Adela',
}

const STALE_AFTER_MS = 5 * 60 * 1000

async function handleAgents(_args: string[], _principal: AuthPrincipal): Promise<string> {
  const sb = getSupabaseClient()
  if (!sb) return 'Agent health unavailable (Supabase not configured).'
  const { data } = await sb
    .from('atlas_agent_heartbeats')
    .select('agent, state, task, updated_at')
  const rows = (data ?? []) as HeartbeatRow[]
  const byAgent = new Map<string, HeartbeatRow>()
  for (const r of rows) byAgent.set(r.agent, r)

  const now = Date.now()
  const parts: string[] = []
  for (const [key, label] of Object.entries(AGENT_DISPLAY_NAMES)) {
    const row = byAgent.get(key)
    if (!row) {
      parts.push(`${label} ⚪`)
      continue
    }
    const ageMs = now - new Date(row.updated_at).getTime()
    if (ageMs > STALE_AFTER_MS || row.state === 'unreachable' || row.state === 'stale') {
      parts.push(`${label} 🔴`)
    } else if (row.state === 'idle') {
      parts.push(`${label} 🟢`)
    } else {
      parts.push(`${label} 🟡`)
    }
  }
  return parts.join(' · ')
}

// Phase 1.10aw-rem — /audit <taskId>: triggers a fresh verifier run. Without a
// taskId we'd have to invent one (no good default), so we surface usage rather
// than guess. Operator-gated because verifier runs incur model cost and write
// to verifier_runs.
async function handleAudit(args: string[], _principal: AuthPrincipal): Promise<string> {
  const taskId = args[0]
  if (!taskId) {
    return 'Usage: /audit <taskId>  (e.g. /audit phase-1.10aw-rem)'
  }
  // Light validation — task ids are kebab-case identifiers; reject anything
  // that smells like an injection. The verifier service does its own checks
  // but failing fast here gives a clearer error.
  if (!/^[a-zA-Z0-9._-]{2,80}$/.test(taskId)) {
    return `Rejected: "${taskId}" is not a valid task id (allowed: a-z, A-Z, 0-9, ._-, length 2-80).`
  }
  try {
    const result = await verifierAudit(taskId) as {
      passed?: boolean
      gaps?: unknown[]
      verdict?: string
      mode?: string
      duration_ms?: number
    } | null
    if (!result) return `Verifier returned no payload for ${taskId}.`
    const passed = result.passed === true
    const gapCount = Array.isArray(result.gaps) ? result.gaps.length : 0
    const verdict = result.verdict ?? (passed ? 'pass' : 'fail')
    const dur = typeof result.duration_ms === 'number' ? `${result.duration_ms}ms` : 'n/a'
    return `Audit ${taskId}: ${passed ? '✅' : '❌'} ${verdict} | gaps: ${gapCount} | duration: ${dur}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Audit failed: ${msg}`
  }
}

// Phase 1.10aw-rem — /scrape <source>: kicks Adela for a named scraper.
// Operator-gated; sources accepted by Adela include usda-nass, abc-objective,
// news-rss, etc. Adela owns its own rate-limits so we don't enforce here.
async function handleScrape(args: string[], _principal: AuthPrincipal): Promise<string> {
  const source = args[0]
  if (!source) {
    return 'Usage: /scrape <source>  (e.g. /scrape usda-nass, /scrape abc-objective, /scrape news-rss)'
  }
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(source)) {
    return `Rejected: "${source}" is not a valid source name (lowercase, kebab-case, length 2-41).`
  }
  try {
    const result = await adelaTriggerScrape(source) as {
      ok?: boolean
      status?: string
      rows?: number
      error?: string
    } | null
    if (!result) return `Adela returned no payload for ${source}.`
    if (result.error) return `Scrape ${source} failed: ${result.error}`
    const status = result.status ?? (result.ok === false ? 'failed' : 'queued')
    const rows = typeof result.rows === 'number' ? ` | rows: ${result.rows}` : ''
    return `Scrape ${source}: ${status}${rows}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Scrape failed: ${msg}`
  }
}

// Phase 1.10aw-rem — /ingest <source>: kicks the memory service to (re)ingest
// a named knowledge source. Sources accepted by the memory service include
// master-plan, workflow-doc, audits, github-history, adrs, conversations,
// v2-codebase, v1-codebase, all. Operator-gated; memory ingest can drive
// embedding cost so we run it through the budget gate.
async function handleIngest(args: string[], _principal: AuthPrincipal): Promise<string> {
  const source = args[0]
  if (!source) {
    return 'Usage: /ingest <source>  (e.g. /ingest master-plan, /ingest workflow-doc, /ingest all)'
  }
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(source)) {
    return `Rejected: "${source}" is not a valid source name (lowercase, kebab-case, length 2-41).`
  }
  try {
    const result = await memoryIngest(source) as {
      ok?: boolean
      ingested?: number
      chunks?: number
      source?: string
      error?: string
    } | null
    if (!result) return `Memory returned no payload for ${source}.`
    if (result.error) return `Ingest ${source} failed: ${result.error}`
    const ingested = typeof result.ingested === 'number' ? result.ingested : null
    const chunks = typeof result.chunks === 'number' ? result.chunks : null
    const stats = [
      ingested !== null ? `ingested: ${ingested}` : null,
      chunks !== null ? `chunks: ${chunks}` : null,
    ].filter(Boolean).join(' | ')
    return `Ingest ${source}: ✅${stats ? ` | ${stats}` : ''}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Ingest failed: ${msg}`
  }
}

async function handleHelp(_args: string[], principal: AuthPrincipal): Promise<string> {
  // Viewers get only read-only commands; everyone else gets the full list.
  const visible = principal.role === 'viewer'
    ? COMMANDS.filter(c => VIEWER_COMMANDS.has(c.name))
    : COMMANDS
  const lines = visible.map(c => {
    const sig = c.argHint ? `/${c.name} ${c.argHint}` : `/${c.name}`
    return `  ${sig} — ${c.description}`
  })
  return `Available commands:\n${lines.join('\n')}\n\nVoice tip: say "slash <command>" or just "<command>".`
}
