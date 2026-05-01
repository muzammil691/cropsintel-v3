// Phase 1.10al — Atlas smart diagnosis.
//
// Given an artifact failure (designer_audit gap, verifier_run row, open fork,
// workflow violation, pending spec), classify it into one of four actionable
// buckets so the Active Artifacts pane can render the right next-step UI:
//
//   • auto-remediate   — Atlas can queue a remediation spec via builder.queue_spec
//   • claude-code      — fix needs human-driven editing in src/, paste prompt into Claude Code
//   • in-app-action    — single button click resolves it (waive, env var, trust mode)
//   • discuss          — open chat with Atlas, pre-loaded with workflow trace
//
// Cheap pattern matches run first; only unhandled cases pay for a Claude call.
// Results are memoised in atlas_diagnosis_cache (24h) keyed by sha256(payload).

import { createHash } from 'crypto'
import { askClaude } from '../providers/claude'
import { recordCost } from './cost-log'
import { getSupabaseClient } from './supabase'

export type ArtifactKind =
  | 'designer_audit'
  | 'verifier_run'
  | 'workflow_violation'
  | 'open_fork'
  | 'pending_spec'

export type DiagnosisBucket =
  | { bucket: 'auto-remediate'; spec_filename: string; spec_body: string; reason: string }
  | { bucket: 'claude-code'; prompt: string; affected_files: string[]; reason: string }
  | {
      bucket: 'in-app-action'
      action_id: string
      label: string
      payload: Record<string, unknown>
      reason: string
    }
  | { bucket: 'discuss'; chat_seed: string; reason: string }

export interface ArtifactInput {
  kind: ArtifactKind
  ref: string
  payload: Record<string, unknown>
}

// Whitelist of action_ids the frontend knows how to render. The Claude
// classifier may only return these; anything else is downgraded to 'discuss'.
export const KNOWN_ACTION_IDS = [
  'mark-stub-intentional',
  'update-gemini-model',
  'update-anthropic-model',
  'flip-trust-mode',
  'rotate-api-key',
  'dismiss-as-waived',
] as const
export type KnownActionId = (typeof KNOWN_ACTION_IDS)[number]

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// Stable JSON for hashing — sort object keys so diff-only orderings hash same.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
  return '{' + parts.join(',') + '}'
}

interface DesignerGap {
  check?: string
  severity?: string
  description?: string
  fix?: string
  remediation?: string
  file?: string
  line?: number | string
  actual?: string
  expected?: string
}

// ─── Heuristic helpers ───────────────────────────────────────────────────────

function asGaps(payload: Record<string, unknown>): DesignerGap[] {
  const raw = payload['gaps']
  if (!Array.isArray(raw)) return []
  return raw.filter((g): g is DesignerGap => g !== null && typeof g === 'object')
}

function diagnoseDesignerAudit(input: ArtifactInput): DiagnosisBucket | null {
  if (input.kind !== 'designer_audit') return null
  const gaps = asGaps(input.payload)
  if (gaps.length === 0) return null

  // Auto-remediate: every gap is a low/medium severity with a check Atlas knows
  // how to fix via existing tooling.
  const autoFixableChecks = new Set([
    'mobile-responsive',
    'motion',
    'shadcn-usage',
    'a11y-aria',
    'tailwind-spacing',
  ])
  const allAutoFixable = gaps.every(
    g =>
      (g.severity === 'medium' || g.severity === 'low') &&
      g.check !== undefined &&
      autoFixableChecks.has(g.check),
  )
  if (allAutoFixable) {
    const taskId = (input.payload['task_id'] as string | undefined) ?? input.ref.slice(0, 8)
    const summary = gaps
      .map(g => `- [${g.severity}] ${g.check}: ${g.description ?? '(no description)'}`)
      .join('\n')
    const remediations = gaps
      .map(g => `  - ${g.fix ?? g.remediation ?? '(use the description as guidance)'}`)
      .join('\n')
    return {
      bucket: 'auto-remediate',
      spec_filename: `phase-${taskId.replace(/[^a-z0-9-]/gi, '-')}-designer-followup.md`,
      spec_body: `# Designer audit follow-up — ${taskId}\n\n${gaps.length} cosmetic gap${gaps.length === 1 ? '' : 's'} flagged by the designer. All are auto-fixable.\n\n## Gaps\n${summary}\n\n## Remediations\n${remediations}\n\n## Constraints\n- Touch only files referenced in the gap objects.\n- Use existing shadcn/ui + lucide-react components and Tailwind utilities already in the file.\n- Run \`npm run build\` before committing.\n`,
      reason: `${gaps.length} cosmetic gap(s) — all medium/low severity with known auto-fix checks.`,
    }
  }

  return null
}

function diagnoseVerifierRun(input: ArtifactInput): DiagnosisBucket | null {
  if (input.kind !== 'verifier_run') return null

  const passed = input.payload['passed']
  if (passed !== false) return null

  const gaps = asGaps(input.payload)
  const taskId = (input.payload['task_id'] as string | undefined) ?? input.ref.slice(0, 8)

  for (const g of gaps) {
    const actual = String(g.actual ?? '')

    // Stub page detected — offer the user a one-click waiver.
    if (actual.includes('<NotImplemented')) {
      return {
        bucket: 'in-app-action',
        action_id: 'mark-stub-intentional',
        label: 'Mark stub as intentional',
        payload: {
          verifier_run_id: input.ref,
          task_id: taskId,
          check_name: g.check ?? 'page-not-stub',
        },
        reason:
          'Verifier flagged a <NotImplemented/> placeholder. If this stub is the intended state for this phase, waive it.',
      }
    }

    // Misconfigured Gemini model env var — single-click bump.
    if (g.check === 'gemini-judgment' && actual.includes('404 Not Found')) {
      return {
        bucket: 'in-app-action',
        action_id: 'update-gemini-model',
        label: 'Update GEMINI_MODEL env var',
        payload: {
          current: actual.match(/models\/[\w.-]+/)?.[0] ?? 'unknown',
          recommended: 'gemini-2.5-pro',
        },
        reason: 'Gemini judgment call returned 404 — the configured model name is wrong or retired.',
      }
    }
  }

  return null
}

function diagnoseWorkflowViolation(input: ArtifactInput): DiagnosisBucket | null {
  if (input.kind !== 'workflow_violation') return null
  const invariant = String(input.payload['invariant'] ?? '')
  const taskId = (input.payload['task_id'] as string | undefined) ?? 'unknown'
  const sha = String(input.payload['commit_sha'] ?? '').slice(0, 8)

  if (invariant === 'verifier_audit_missing') {
    return {
      bucket: 'auto-remediate',
      spec_filename: `phase-${taskId.replace(/[^a-z0-9-]/gi, '-')}-rerun-verifier.md`,
      spec_body: `# Re-run verifier — ${taskId}\n\nVerifier did not run for commit ${sha}. Trigger a manual re-run via Atlas's verifier-rerun tool.\n\n## Why\n${input.payload['description'] ?? '(no description)'}\n\n## Action\n- Call \`verifier.rerun\` against commit ${sha}.\n`,
      reason: 'Verifier audit missing for a recent ship — Atlas can rerun it.',
    }
  }

  return null
}

function diagnoseOpenFork(input: ArtifactInput): DiagnosisBucket | null {
  if (input.kind !== 'open_fork') return null
  const decidedAt = String(input.payload['decided_at'] ?? '')
  if (!decidedAt) return null
  const ageMs = Date.now() - new Date(decidedAt).getTime()
  // 24h+ old, no movement → escalate to discuss.
  if (ageMs > 24 * 60 * 60 * 1000) {
    const question = String(input.payload['fork_question'] ?? '(unknown question)')
    const rationale = String(input.payload['rationale'] ?? '')
    return {
      bucket: 'discuss',
      chat_seed: `This fork has been open for ${Math.round(ageMs / 3_600_000)}h with no decision: "${question}".${rationale ? `\n\nOriginal rationale: ${rationale}` : ''}\n\nWhat do you want to do?`,
      reason: 'Cold fork (>24h since last activity) — needs a human nudge.',
    }
  }
  return null
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

async function readCache(kind: ArtifactKind, payloadSha: string): Promise<DiagnosisBucket | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  try {
    const { data } = await sb
      .from('atlas_diagnosis_cache')
      .select('result, expires_at')
      .eq('artifact_kind', kind)
      .eq('payload_sha', payloadSha)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (!data) return null
    const result = (data as { result: unknown }).result
    return result as DiagnosisBucket
  } catch {
    return null
  }
}

async function writeCache(kind: ArtifactKind, payloadSha: string, result: DiagnosisBucket): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  try {
    await sb.from('atlas_diagnosis_cache').upsert(
      {
        artifact_kind: kind,
        payload_sha: payloadSha,
        bucket: result.bucket,
        result,
        reason: 'reason' in result ? result.reason : null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'artifact_kind,payload_sha' },
    )
  } catch (err) {
    console.warn('[diagnose] cache write failed:', err)
  }
}

// ─── Claude fallback ─────────────────────────────────────────────────────────

interface ClaudeClassification {
  bucket: DiagnosisBucket['bucket']
  reason: string
  spec_filename?: string
  spec_body?: string
  prompt?: string
  affected_files?: string[]
  action_id?: string
  label?: string
  action_payload?: Record<string, unknown>
  chat_seed?: string
}

function safeJsonParse(text: string): ClaudeClassification | null {
  // Claude often wraps JSON in ```json fences — strip them.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    const obj = JSON.parse(stripped)
    if (obj && typeof obj === 'object' && typeof obj.bucket === 'string') {
      return obj as ClaudeClassification
    }
  } catch {
    // try to extract the first JSON object
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const obj = JSON.parse(match[0])
        if (obj && typeof obj === 'object' && typeof obj.bucket === 'string') {
          return obj as ClaudeClassification
        }
      } catch {
        // fall through
      }
    }
  }
  return null
}

async function classifyWithClaude(input: ArtifactInput): Promise<DiagnosisBucket> {
  const prompt = `You are Atlas, classifying a CropsIntel V3 artifact failure into one of four actionable buckets.

ARTIFACT KIND: ${input.kind}
ARTIFACT REF: ${input.ref}
PAYLOAD:
${JSON.stringify(input.payload, null, 2).slice(0, 6000)}

Classify into exactly one of:

1. "auto-remediate" — Atlas's existing tools (builder.queue_spec, designer.review_spec) can fix this WITHOUT touching src/ files. Pick this for spec-rewrite, re-runs, or pure config-data fixes.
2. "claude-code" — fix requires editing TypeScript/React source files in src/. Atlas runs sandboxed and cannot write to src/, so the user must paste a prompt into Claude Code in VS Code locally.
3. "in-app-action" — a SINGLE button click resolves this. Action MUST be one of: mark-stub-intentional, update-gemini-model, update-anthropic-model, flip-trust-mode, rotate-api-key, dismiss-as-waived. If no listed action_id fits, do NOT invent one — pick "discuss" instead.
4. "discuss" — anything else; the user should chat with Atlas.

Respond as JSON ONLY (no prose, no fences) with shape:
{
  "bucket": "auto-remediate" | "claude-code" | "in-app-action" | "discuss",
  "reason": "<one sentence>",
  // for auto-remediate:
  "spec_filename": "<phase-...-followup.md>",
  "spec_body": "<markdown>",
  // for claude-code:
  "prompt": "<the prompt to paste into Claude Code, self-contained>",
  "affected_files": ["src/..."],
  // for in-app-action:
  "action_id": "<one of the whitelisted ids>",
  "label": "<button text>",
  "action_payload": { ... },
  // for discuss:
  "chat_seed": "<message to seed the chat>"
}`

  const res = await askClaude({ prompt, model: 'claude-opus-4-7' })
  if (res.costUsd > 0) {
    await recordCost('anthropic', 'atlas-diagnose', 'claude-opus-4-7', res.inputTokens, res.outputTokens, res.costUsd)
  }

  const parsed = safeJsonParse(res.content)
  if (!parsed) {
    return {
      bucket: 'discuss',
      chat_seed: `I tried to classify a ${input.kind} but Claude didn't return valid JSON. Raw response:\n\n${res.content.slice(0, 500)}\n\nWhat do you want to do?`,
      reason: 'Claude classifier returned unparseable response — falling back to discuss.',
    }
  }

  return materializeBucket(parsed, input)
}

function materializeBucket(c: ClaudeClassification, input: ArtifactInput): DiagnosisBucket {
  const reason = c.reason || `Classified by Claude as ${c.bucket}.`

  if (c.bucket === 'auto-remediate' && c.spec_filename && c.spec_body) {
    return {
      bucket: 'auto-remediate',
      spec_filename: c.spec_filename,
      spec_body: c.spec_body,
      reason,
    }
  }

  if (c.bucket === 'claude-code' && c.prompt) {
    return {
      bucket: 'claude-code',
      prompt: c.prompt,
      affected_files: Array.isArray(c.affected_files) ? c.affected_files : [],
      reason,
    }
  }

  if (c.bucket === 'in-app-action' && c.action_id && c.label) {
    if ((KNOWN_ACTION_IDS as readonly string[]).includes(c.action_id)) {
      return {
        bucket: 'in-app-action',
        action_id: c.action_id,
        label: c.label,
        payload: c.action_payload ?? {},
        reason,
      }
    }
    // Unknown action_id → safety net: downgrade to discuss.
    return {
      bucket: 'discuss',
      chat_seed: `Classifier suggested in-app-action "${c.action_id}" but it isn't in the whitelist. Original reason: ${reason}\n\nWhat do you want to do?`,
      reason: `Unknown action_id "${c.action_id}" — downgraded to discuss.`,
    }
  }

  // Default discuss path.
  const seed =
    c.chat_seed ??
    `I'm looking at a ${input.kind} (${input.ref.slice(0, 8)}) and I'm not sure how to fix it. ${reason}`
  return { bucket: 'discuss', chat_seed: seed, reason }
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function diagnose(input: ArtifactInput): Promise<DiagnosisBucket> {
  const payloadSha = sha256(canonicalJson(input.payload))

  // 1. Cache hit?
  const cached = await readCache(input.kind, payloadSha)
  if (cached) return cached

  // 2. Cheap heuristics.
  const heuristic =
    diagnoseDesignerAudit(input) ??
    diagnoseVerifierRun(input) ??
    diagnoseWorkflowViolation(input) ??
    diagnoseOpenFork(input)
  if (heuristic) {
    await writeCache(input.kind, payloadSha, heuristic)
    return heuristic
  }

  // 3. Claude fallback.
  const classified = await classifyWithClaude(input)
  await writeCache(input.kind, payloadSha, classified)
  return classified
}
