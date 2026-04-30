import { readdirSync } from 'fs'
import { resolve } from 'path'
import { getSupabaseClient } from './supabase'
import type { DispatchRequest } from './dispatch'

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
