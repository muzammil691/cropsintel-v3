import { readdirSync } from 'fs'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getSupabaseClient } from './supabase'
import type { DispatchRequest } from './dispatch'

const execFileP = promisify(execFile)

export interface Violation {
  rule_id: string
  description: string
  severity: 'high' | 'medium' | 'low'
}

export interface InvariantCheck {
  allow: boolean
  violations: Violation[]
}

// ─── Rule 1: Phase order ──────────────────────────────────────────────────────

function checkPhaseOrder(args: { filename?: string }): Violation | null {
  if (!args.filename) return null
  const match = args.filename.match(/^phase-(\d+)\.(\d+)/)
  if (!match) return null
  const targetMajor = parseInt(match[1], 10)
  const targetMinor = parseInt(match[2], 10)

  const repoRoot = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
  let queued: string[] = []
  let inProgress: string[] = []
  try {
    queued = readdirSync(resolve(repoRoot, '.agent/tasks/queued')).filter(f => f.endsWith('.md'))
    inProgress = readdirSync(resolve(repoRoot, '.agent/tasks/in-progress')).filter(f => f.endsWith('.md'))
  } catch {
    return null
  }

  for (const f of [...queued, ...inProgress]) {
    const m = f.match(/^phase-(\d+)\.(\d+)/)
    if (!m) continue
    const mj = parseInt(m[1], 10)
    const mn = parseInt(m[2], 10)

    // Earlier minor in same major still pending → must finish before moving on
    if (mj === targetMajor && mn < targetMinor) {
      return {
        rule_id: 'phase_order',
        severity: 'high',
        description: `Cannot start Phase ${targetMajor}.${targetMinor} while Phase ${mj}.${mn} (${f}) is still pending`,
      }
    }

    // Previous major phase still pending → earlier major must complete first
    if (mj < targetMajor) {
      return {
        rule_id: 'phase_order',
        severity: 'high',
        description: `Cannot start Phase ${targetMajor}.${targetMinor} while Phase ${mj}.${mn} (${f}) is still pending`,
      }
    }
  }
  return null
}

// ─── Rule 2: Named layers stable ─────────────────────────────────────────────

const PROTECTED_NAMES = ['adela', 'atlas', 'zyra']

function checkProtectedNames(args: { filename?: string; body?: string }): Violation | null {
  const text = (args.filename ?? '') + ' ' + (args.body ?? '')
  for (const name of PROTECTED_NAMES) {
    const renamePattern = new RegExp(`\\b(rename|replace|deprecate)\\s+\\w*${name}\\b`, 'i')
    if (renamePattern.test(text)) {
      return {
        rule_id: 'named_layers',
        severity: 'high',
        description: `Refused: appears to rename/deprecate protected layer "${name}"`,
      }
    }
  }
  return null
}

// ─── Rule 3: No parallel restarts ────────────────────────────────────────────

function checkParallelRestart(args: { filename?: string; body?: string }): Violation | null {
  const text = (args.filename ?? '') + ' ' + (args.body ?? '')
  const patterns = [
    /\b(\w+)-2\.(ts|tsx|js|jsx|sql)\b/i,
    /\b(\w+)-v2\.(ts|tsx|js|jsx)\b/i,
    /\b(\w+)-new\.(ts|tsx|js|jsx)\b/i,
  ]
  for (const pat of patterns) {
    const m = text.match(pat)
    if (m) {
      return {
        rule_id: 'no_parallel_restart',
        severity: 'medium',
        description: `Suspected parallel restart: "${m[0]}" — should refactor original instead of creating second version`,
      }
    }
  }
  return null
}

// ─── Rule 4: Scope rules (NEVER list) ────────────────────────────────────────

const NEVER_KEYWORDS = [
  /\bsale\s+contract\s+(issu|generat|creat)/i,
  /\bpurchase\s+contract\s+(issu|generat|creat)/i,
  /\bbusiness\s+central\s+(post|integrat|sync)/i,
  /\bletter\s+of\s+credit\s+(workflow|posting)/i,
  /\bbank\s+document\s+(present|workflow)/i,
  /\bmulti.?tenant\s+saas/i,
]

function checkNeverList(args: { body?: string }): Violation | null {
  const text = args.body ?? ''
  for (const pat of NEVER_KEYWORDS) {
    if (pat.test(text)) {
      return {
        rule_id: 'scope_never',
        severity: 'high',
        description: `Spec mentions item on the master plan §11.6 NEVER list (matched pattern: ${pat.source})`,
      }
    }
  }
  return null
}

// ─── Rule 5: AI cost cap ─────────────────────────────────────────────────────
// No-op: already enforced by checkBudget in dispatch.ts before invariants run.

// ─── Rule 6: Verified-tier gating ────────────────────────────────────────────

async function checkVerifiedTierGating(args: { body?: string }): Promise<Violation | null> {
  const text = args.body ?? ''
  const mentionsVerified = /\bverified[\s_-]+(tier|user|access)\b/i.test(text)
  if (!mentionsVerified) return null

  const sb = getSupabaseClient()
  if (!sb) {
    return {
      rule_id: 'verified_gating',
      severity: 'high',
      description: 'Spec mentions verified-tier features but cannot verify `verified_review_queue` table exists (no Supabase client)',
    }
  }

  try {
    const { data, error } = await sb
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', 'verified_review_queue')
    if (error || !data || data.length === 0) {
      return {
        rule_id: 'verified_gating',
        severity: 'high',
        description: 'Spec mentions verified-tier features but `verified_review_queue` admin table does not exist yet (master plan 1.11b prerequisite)',
      }
    }
  } catch {
    return {
      rule_id: 'verified_gating',
      severity: 'high',
      description: 'Spec mentions verified-tier features but `verified_review_queue` admin table does not exist yet (master plan 1.11b prerequisite)',
    }
  }
  return null
}

// ─── Rule 7: No client-side AI keys ──────────────────────────────────────────

function checkClientSideKeys(args: { body?: string }): Violation | null {
  const text = args.body ?? ''
  const dangerous = [
    /\bVITE_(ANTHROPIC|OPENAI|GEMINI|ELEVENLABS)_API_KEY/i,
    /\bprocess\.env\.(ANTHROPIC|OPENAI|GEMINI)_API_KEY\b.*\bsrc\//i,
    /import.*from\s+['"`].*api-key.*['"`]/i,
  ]
  for (const pat of dangerous) {
    if (pat.test(text)) {
      return {
        rule_id: 'no_client_keys',
        severity: 'high',
        description: `Spec appears to put AI API keys in client bundle (V2's mistake — never repeat). Match: ${pat.source}`,
      }
    }
  }
  return null
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function checkInvariants(req: DispatchRequest): Promise<InvariantCheck> {
  const args = req.arguments as { filename?: string; body?: string }

  const syncViolations: Array<Violation | null> = [
    checkPhaseOrder(args),
    checkProtectedNames(args),
    checkParallelRestart(args),
    checkNeverList(args),
    checkClientSideKeys(args),
  ]

  const asyncViolations = await Promise.all([
    checkVerifiedTierGating(args),
  ])

  const violations = [...syncViolations, ...asyncViolations].filter((v): v is Violation => v !== null)

  const allow = violations.every(v => v.severity !== 'high')

  // Log medium/low violations that don't block (warnings)
  if (allow && violations.length > 0) {
    const sb = getSupabaseClient()
    if (sb) {
      try {
        await sb.from('atlas_decisions').insert({
          fork_question: `Invariant warnings on ${req.tool}`,
          options_considered: { proposed: req.arguments },
          chosen_option: 'ALLOWED_WITH_WARNINGS',
          rationale: violations.map(v => `[${v.rule_id}/${v.severity}] ${v.description}`).join('; '),
          decided_by: 'atlas-auto',
        })
      } catch { /* non-fatal: DB may be unavailable */ }
    }
  }

  return { allow, violations }
}

// ─── Workflow-trace runtime invariants ───────────────────────────────────────
//
// These run on every Atlas conductor heartbeat (per phase-1.10ad spec). They
// answer: did the 7-agent choreography actually happen for each recently
// shipped commit? If not, we log to atlas_decisions and ping the user.
//
// Invariants enforced:
//   1. Every committed spec must have a verifier_runs row within 5 min of HEAD update
//   2. Every UI commit must have a designer_runs row within 5 min
//   3. Every shipped spec must trigger memory.ingest within 10 min
//
// Output: an array of WorkflowTraceViolation. The conductor logs them and pings.

export interface WorkflowTraceViolation {
  invariant: 'verifier_audit_missing' | 'designer_audit_missing' | 'memory_ingest_missing'
  commit_sha: string
  commit_subject: string
  shipped_at: string
  age_minutes: number
  description: string
}

interface ShipCommit {
  sha: string
  subject: string
  changedFiles: string[]
  timestampIso: string
}

async function getRecentShips(repoRoot: string, sinceMinutes: number): Promise<ShipCommit[]> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', `--since=${sinceMinutes} minutes ago`, '--pretty=format:%H%x09%cI%x09%s'],
      { cwd: repoRoot },
    )
    const lines = stdout.split('\n').filter(Boolean)
    const ships: ShipCommit[] = []
    for (const line of lines) {
      const [sha, ts, ...subjectParts] = line.split('\t')
      const subject = subjectParts.join('\t') ?? ''
      // A "ship" = a feature commit by the autonomous Builder. Cleanup commits
      // (chore(agent): → done, fix(*), etc.) don't change source files in a way
      // that needs Verifier/Designer/memory audits, so skip them — otherwise
      // the invariant checker fires false-positive WhatsApp pings on every
      // bookkeeping push.
      const isShip = /^feat:.*\(autonomous agent/.test(subject)
      if (!isShip) continue
      let changedFiles: string[] = []
      try {
        const { stdout: files } = await execFileP(
          'git',
          ['show', '--name-only', '--pretty=format:', sha],
          { cwd: repoRoot },
        )
        changedFiles = files.split('\n').filter(Boolean)
      } catch {
        // ignore; treat as no files
      }
      ships.push({ sha, subject, changedFiles, timestampIso: ts ?? '' })
    }
    return ships
  } catch (err) {
    console.warn('[invariants] git log for workflow-trace failed:', err)
    return []
  }
}

function isUiCommit(files: string[]): boolean {
  return files.some(f => /^src\/(pages|components|styles)\//.test(f) || f === 'src/index.css')
}

function ageMinutes(timestampIso: string): number {
  if (!timestampIso) return 999999
  return (Date.now() - new Date(timestampIso).getTime()) / 60000
}

export async function checkWorkflowTraceInvariants(opts?: { repoRoot?: string }): Promise<WorkflowTraceViolation[]> {
  const repoRoot = opts?.repoRoot ?? process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
  const sb = getSupabaseClient()
  if (!sb) {
    return [] // can't verify without DB; log only at caller's discretion
  }

  // Look back 30 min — enough that the 5/10 min thresholds catch real misses
  // but recent enough we don't double-log violations from prior heartbeats.
  const ships = await getRecentShips(repoRoot, 30)
  if (ships.length === 0) return []

  const violations: WorkflowTraceViolation[] = []

  // Pre-fetch verifier_runs and designer_runs by commit_sha across the ship window.
  const shaSet = ships.map(s => s.sha)
  let verifierRuns: Array<{ commit_sha: string; ran_at: string }> = []
  let designerRuns: Array<{ created_at: string; ai_judgment?: Record<string, unknown> | null }> = []
  let memoryRuns: Array<{ ran_at: string; metadata?: Record<string, unknown> | null }> = []
  try {
    const { data: vr } = await sb
      .from('verifier_runs')
      .select('commit_sha, ran_at')
      .in('commit_sha', shaSet)
    verifierRuns = (vr ?? []) as typeof verifierRuns
  } catch (err) {
    console.warn('[invariants] verifier_runs lookup failed:', err)
  }
  try {
    const { data: dr } = await sb
      .from('designer_runs')
      .select('created_at, ai_judgment, task_id')
      .order('created_at', { ascending: false })
      .limit(100)
    designerRuns = (dr ?? []) as typeof designerRuns
  } catch (err) {
    console.warn('[invariants] designer_runs lookup failed:', err)
  }
  try {
    const { data: mr } = await sb
      .from('memory_runs')
      .select('ran_at, metadata')
      .gte('ran_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    memoryRuns = (mr ?? []) as typeof memoryRuns
  } catch (err) {
    console.warn('[invariants] memory_runs lookup failed:', err)
  }

  for (const ship of ships) {
    const shipAge = ageMinutes(ship.timestampIso)

    // Invariant 1: verifier_runs row within 5 min of HEAD update
    if (shipAge >= 5) {
      const hasVerifier = verifierRuns.some(v => v.commit_sha === ship.sha)
      if (!hasVerifier) {
        violations.push({
          invariant: 'verifier_audit_missing',
          commit_sha: ship.sha,
          commit_subject: ship.subject,
          shipped_at: ship.timestampIso,
          age_minutes: shipAge,
          description: `Commit ${ship.sha.slice(0, 8)} (${ship.subject}) shipped ${Math.round(shipAge)} min ago but no verifier_runs row exists for that commit_sha. Verifier may be unreachable or misconfigured.`,
        })
      }
    }

    // Invariant 2: designer_runs within 5 min for UI commits
    if (shipAge >= 5 && isUiCommit(ship.changedFiles)) {
      // designer_runs doesn't store commit_sha directly — check for any audit-commit
      // run after the ship timestamp. Match loosely on time window.
      const shipTime = new Date(ship.timestampIso).getTime()
      const hasDesigner = designerRuns.some(d => {
        const runTime = new Date(d.created_at).getTime()
        return runTime >= shipTime && runTime <= shipTime + 10 * 60 * 1000
      })
      if (!hasDesigner) {
        violations.push({
          invariant: 'designer_audit_missing',
          commit_sha: ship.sha,
          commit_subject: ship.subject,
          shipped_at: ship.timestampIso,
          age_minutes: shipAge,
          description: `UI commit ${ship.sha.slice(0, 8)} (${ship.subject}) shipped ${Math.round(shipAge)} min ago but no designer_runs row exists. Designer may be unreachable or skipped.`,
        })
      }
    }

    // Invariant 3: memory.ingest within 10 min of every ship
    if (shipAge >= 10) {
      const shipTime = new Date(ship.timestampIso).getTime()
      const hasIngest = memoryRuns.some(m => {
        const runTime = new Date(m.ran_at).getTime()
        return runTime >= shipTime && runTime <= shipTime + 15 * 60 * 1000
      })
      if (!hasIngest) {
        violations.push({
          invariant: 'memory_ingest_missing',
          commit_sha: ship.sha,
          commit_subject: ship.subject,
          shipped_at: ship.timestampIso,
          age_minutes: shipAge,
          description: `Commit ${ship.sha.slice(0, 8)} (${ship.subject}) shipped ${Math.round(shipAge)} min ago but no memory_runs row appeared in the 15 min after. Memory ingest may have failed silently.`,
        })
      }
    }
  }

  return violations
}

// In-memory dedupe: don't re-log the same violation every heartbeat.
const loggedWorkflowViolations = new Set<string>()

export function consumeNewWorkflowViolations(violations: WorkflowTraceViolation[]): WorkflowTraceViolation[] {
  const fresh: WorkflowTraceViolation[] = []
  for (const v of violations) {
    const key = `${v.invariant}:${v.commit_sha}`
    if (loggedWorkflowViolations.has(key)) continue
    loggedWorkflowViolations.add(key)
    fresh.push(v)
  }
  // Cap memory to prevent unbounded growth
  if (loggedWorkflowViolations.size > 500) {
    const first = loggedWorkflowViolations.values().next().value
    if (first !== undefined) loggedWorkflowViolations.delete(first)
  }
  return fresh
}
