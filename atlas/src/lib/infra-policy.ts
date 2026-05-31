// Phase 1.0x — Infrastructure spec policy guard.
//
// Per policy declared 2026-05-23: agent infrastructure code changes
// (atlas/, verifier/, council/, agent/, designer/) go through Claude
// Code, NOT the autonomous Builder loop. Product code (src/, supabase/,
// memory/, adela/) ships via the Builder pipeline as before.
//
// This module supplies the detector. Callers — requeueWithGaps in
// plan-server.ts and autoRequeueOnVerifierFail in cron/conductor.ts —
// use the result to refuse to (re)queue infra specs and instead drop
// a `.agent/questions/<task-id>-q.md` so a human pipes the spec
// through Claude Code.
//
// Path extraction is delegated to extractFilesRequired in
// queue-validator.ts (Option 5 — reuse the existing second copy of the
// verifier parser rather than introduce a third). See the drift-pin
// test in infra-policy.test.ts for the parser-agreement contract.

import { access, mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { extractFilesRequired } from '../workshop/queue-validator'

// Five exact roots. memory/ and adela/ are product-adjacent (cockpit
// search and V1.0-beta data spine respectively) and explicitly excluded.
// Adding to this list expands the policy's reach and should require a
// matching change in atlas/src/lib/infra-policy.test.ts (the Adela/memory
// pass-through tests assert behavior at the boundary).
export const INFRA_PATH_PREFIXES = [
  'atlas/',
  'verifier/',
  'council/',
  'agent/',
  'designer/',
] as const

// Narrow infra-module token regex. Matches the actual module names of
// the cron/queue infrastructure. Does NOT match bare "queue" or
// "workshop" because both appear in legitimate product spec titles
// (queue display widgets, workshop CSS work).
//
// Only consulted when extractFilesRequired returns zero paths — i.e. a
// product spec listing src/ paths can have an infra-looking task_id
// and still requeue cleanly.
export const INFRA_TASKID_PATTERN =
  /\b(requeue|inheritance|plan[-_]server|queue[-_]orchestrator|conductor|verifier[-_]sync|workshop[-_](preflight|validator|engine)|council[-_]|designer[-_]audit)\b/i

export interface IsInfraSpecArgs {
  /** Spec body (already parsed out of YAML frontmatter). */
  body: string
  /** Task id derived from the spec filename without `.md`. */
  taskId: string
}

export interface IsInfraSpecResult {
  /** True if the spec is judged to touch infrastructure and must be refused. */
  infra: boolean
  /** Which layer fired the decision, or `'none'` when infra=false. */
  layer: 'A' | 'C' | 'none'
  /** Human-readable summary suitable for log lines + the question file. */
  reason: string
  /** Concrete items that triggered the match — file paths or token strings. */
  evidence: string[]
}

/**
 * Decide whether a spec is infrastructure (Atlas, Verifier, Council,
 * agent-loop scripts, Designer). Pure function — no I/O.
 *
 *   Layer A — extractFilesRequired against INFRA_PATH_PREFIXES.
 *             Any extracted path that startsWith an infra prefix → infra=true.
 *   Layer C — fall-through ONLY when Layer A produced zero paths.
 *             Match INFRA_TASKID_PATTERN against the task_id.
 *
 * Layer B (filename-basename match) is intentionally omitted: Layer A
 * subsumes it because every infra filename of interest lives under one
 * of the five prefixes.
 */
export function isInfraSpec(args: IsInfraSpecArgs): IsInfraSpecResult {
  const paths = extractFilesRequired(args.body)

  // Layer A — path prefix match.
  const matchedPaths: string[] = []
  for (const p of paths) {
    for (const prefix of INFRA_PATH_PREFIXES) {
      if (p.startsWith(prefix)) {
        matchedPaths.push(p)
        break
      }
    }
  }
  if (matchedPaths.length > 0) {
    return {
      infra: true,
      layer: 'A',
      reason: `spec lists ${matchedPaths.length} file${matchedPaths.length === 1 ? '' : 's'} under an infrastructure root`,
      evidence: matchedPaths,
    }
  }

  // Layer C — task_id fallback. ONLY when Layer A found zero paths so a
  // product spec with explicit src/ files can have an infra-looking task
  // id and still requeue cleanly.
  if (paths.length === 0) {
    const m = args.taskId.match(INFRA_TASKID_PATTERN)
    if (m) {
      return {
        infra: true,
        layer: 'C',
        reason: `spec has no filesRequired; task_id matches infra-module token "${m[0]}"`,
        evidence: [m[0]],
      }
    }
  }

  return {
    infra: false,
    layer: 'none',
    reason: paths.length > 0
      ? `${paths.length} path${paths.length === 1 ? '' : 's'} extracted, none start with an infrastructure prefix`
      : 'no filesRequired in body and no infra token in task_id',
    evidence: [],
  }
}

/**
 * Shape of a Verifier gap as observed by callers of this module.
 * Mirrors plan-server.VerifierGap but declared locally to avoid the
 * import cycle (plan-server imports buildInfraQuestionStub from here).
 */
interface VerifierGapShape {
  check?: string
  severity?: string
  actual?: string
  expected?: string
  remediation?: string
}

/**
 * Build the `.agent/questions/<task-id>-q.md` content emitted on
 * refusal. Includes the original Verifier gaps for context so the human
 * handler (Claude Code) sees what was unhappy without querying
 * verifier_runs themselves.
 *
 * Pure function — caller is responsible for the filesystem write.
 */
export function buildInfraQuestionStub(args: {
  taskId: string
  detection: IsInfraSpecResult
  gaps: VerifierGapShape[]
  remediationAttempt: number
}): string {
  const gapsLines =
    args.gaps.length === 0
      ? '_No structured Verifier gaps captured for this row._'
      : args.gaps
          .map(
            (g, i) =>
              `${i + 1}. **[${g.severity ?? 'warn'}] ${g.check ?? 'unknown'}**\n   actual: ${g.actual ?? '?'}\n   expected: ${g.expected ?? '?'}\n   remediation: ${g.remediation ?? '?'}`,
          )
          .join('\n\n')

  return `# Question — ${args.taskId}

**Blocking:** auto-requeue refused under the infra-via-Claude-Code policy
(declared 2026-05-23).

## Why refused

${args.detection.reason}. Matched on **Layer ${args.detection.layer}** \
(${args.detection.layer === 'A' ? 'filesRequired path prefix' : 'task_id token fallback'}).

This spec touches one of the five infrastructure roots (\`atlas/\`,
\`verifier/\`, \`council/\`, \`agent/\`, \`designer/\`) or carries a
task_id token reserved for infra modules. Per policy these changes
must go through Claude Code rather than the autonomous Builder loop.

## Matched evidence

${
  args.detection.evidence.length === 0
    ? '_(no evidence — this should never appear; bug if it does)_'
    : args.detection.evidence.map((e) => `- \`${e}\``).join('\n')
}

## Original Verifier gaps (context — NOT auto-applied)

Remediation attempt ${args.remediationAttempt}; this is why the spec
landed in \`failed/\` and triggered auto-requeue:

${gapsLines}

## Next steps

1. **Have Claude Code audit + reauthor the spec.** This is the default
   path per policy. Use this file as a starting point — copy the
   relevant gaps into the new spec body and re-queue manually.
2. **If this is a false positive** (a product spec mis-matched by the
   guard's path prefixes or task_id regex), narrow the filter in
   \`atlas/src/lib/infra-policy.ts\` and document the case as a
   regression test before re-attempting.

— atlas auto-requeue policy guard
`
}

/**
 * Write the infra-refusal question file at
 * `<repoRoot>/.agent/questions/<taskId>-q.md`. Shared by both hook A
 * (requeueWithGaps in plan-server.ts) and hook B (autoRequeueOnVerifierFail
 * in cron/conductor.ts) so a refused requeue leaves the same artifact
 * regardless of which hook fired.
 *
 * Skip-if-exists semantics: if the file is already present (a prior
 * cron cycle wrote it, or hook A already ran on a previous attempt),
 * we DO NOT overwrite. The earliest write wins. Caller can check the
 * `written` flag to log appropriately.
 */
export async function writeInfraRefusalQuestion(args: {
  taskId: string
  detection: IsInfraSpecResult
  gaps: VerifierGapShape[]
  remediationAttempt: number
  repoRoot: string
}): Promise<{ written: boolean; path: string; reason?: string }> {
  const questionsDir = resolve(args.repoRoot, '.agent/questions')
  const path = resolve(questionsDir, `${args.taskId}-q.md`)
  try {
    await access(path)
    // Exists → skip-if-exists. Earliest write wins; later cycle leaves it.
    return { written: false, path, reason: 'already exists' }
  } catch {
    /* not present → fall through to write */
  }
  const stub = buildInfraQuestionStub({
    taskId: args.taskId,
    detection: args.detection,
    gaps: args.gaps,
    remediationAttempt: args.remediationAttempt,
  })
  await mkdir(questionsDir, { recursive: true })
  await writeFile(path, stub, 'utf-8')
  return { written: true, path }
}
