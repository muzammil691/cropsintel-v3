---
priority: 1
remediation: true
remediation-attempt: 2
source: ADR-2026-05-07-verifier-cluster-1778161030385.md (and 7 predecessor ADRs)
track: conductor
---
# Task: Conductor cluster-dedupe upgrade

**Master plan reference:** section 9.2 (Atlas — runtime nervous system, agent R3)
**V3-CODING-INSTRUCTIONS reference:** section 0 (anti-restart) + section 3 (information walls)
**Estimated effort:** 0.5 day

## Goal

Stop the Atlas conductor from queueing investigation tasks for verifier failure clusters that have **already** been investigated, closed, or remediated. On 2026-05-07 the conductor fired **eight identical investigation clusters in under three hours** for the same `phase-1.10af-workflow-quality-gates-fix` lineage that had already converged on a green build at `7466c3c`. Each cluster spawned a multi-brain debate (charged against the AI budget — see master plan 10.3) and an investigation task that produced an ADR identical to the predecessor. This burns the AI budget, churns the loop, and forces investigators into git archaeology because the cluster spec carries `no detail` per failure.

The dedupe `Set<string>` in `atlas/src/cron/conductor.ts:515` is in-process memory only — it is wiped every restart. It also has no awareness of (a) ADRs already closed on disk, (b) clusters queued or in-progress within the trailing 30 minutes, or (c) failure records whose remediation has shipped at HEAD.

## In scope

### Conductor changes

- `atlas/src/cron/conductor.ts` — replace the in-process `recentClusterKeys: Set<string>` at line 515 with a persistent dedupe gate that survives restarts. Source-of-truth precedence (highest first):
  1. **Closed ADRs**: scan `docs/atlas-decisions/ADR-*.md` for `cluster id <id>` or `duplicate-of: ADR-…-verifier-cluster-<id>` — if found, skip and log `cluster-dedupe: closed-adr`.
  2. **Queued or in-progress investigations**: scan `.agent/tasks/queued/` and `.agent/tasks/in-progress/` for `phase-1-CLUSTER-investigation-*.md` files modified in the trailing 30 minutes whose body lists the same task IDs in the failed-tasks bullet list — if matched, skip and log `cluster-dedupe: trailing-window`.
  3. **Remediated-at-HEAD failures**: for each `task_id` in `recentFails`, look up the matching task in `.agent/tasks/done/`. If a `*-rem*.md` task exists in `.agent/tasks/done/` newer than the latest failure timestamp, treat the lineage as already-remediated and skip with `cluster-dedupe: shipped-rem`.
  4. **In-process snapshot** (the existing `clusterKey`) — keep as the cheapest gate, but only after (1)–(3).

- `atlas/src/cron/conductor.ts` — when a cluster passes all four gates and the conductor proceeds with a debate, after `composeInvestigationSpec(...)` resolves `result.chosen === 'investigate'`, **embed the per-task gap text** in the spec so investigators do not see `no detail`. Today `r.gaps` is consulted only for the WhatsApp message; the spec body's `failBullets` reads `gaps?.[0]?.description ?? 'no detail'` from the same source but the gap rows for these clusters carry the verifier's structured `Gap[]` (with `check`, `expected`, `actual`, `remediation`) and not a `description` field. Update `composeInvestigationSpec` (line 517) to render `gaps[0]?.expected | gaps[0]?.actual | gaps[0]?.remediation` instead, falling back to `description` for backward compatibility.

### New conductor library

- `atlas/src/lib/cluster-dedupe.ts` — pure, unit-testable function:
  ```ts
  export interface DedupeGateInput {
    clusterKey: string
    taskIds: string[]
    failTimestamps: string[]
    repoRoot: string
  }
  export type DedupeOutcome =
    | { skip: true; reason: 'closed-adr' | 'trailing-window' | 'shipped-rem' | 'in-process'; evidence: string }
    | { skip: false }
  export async function checkClusterDedupe(input: DedupeGateInput): Promise<DedupeOutcome>
  ```
  - Reads filesystem only (no Supabase) — the conductor must keep working when the DB is down.
  - All evidence strings include the matching ADR/task filename so the audit log is grep-able.

### Tests

- `atlas/src/lib/__tests__/cluster-dedupe.test.ts` — unit tests covering all four gates with synthetic temp directories. Specifically:
  1. closed-ADR gate matches when an ADR file contains the cluster id.
  2. trailing-window gate matches when a queued cluster file has the same task IDs.
  3. shipped-rem gate matches when a done `*-rem*.md` file is newer than the failure timestamp.
  4. in-process gate matches on identical `clusterKey`.
  5. `skip: false` is returned when none of the above apply.

### Audit log

- Conductor must call `logDecision({ fork_question: 'cluster dedupe', chosen_option: outcome.reason, rationale: outcome.evidence })` for every skipped cluster. This converts the eight-ADR-per-day pattern into eight audit-log rows costing nothing.

## Out of scope

- Removing the existing in-process Set (kept as gate 4 — cheapest check, no I/O).
- Cross-conductor coordination (multiple conductor instances). V3 runs one conductor per Railway service per master plan section 9; multi-instance is phase 4 (R11 / Atlas-Pro).
- Changing the verifier's `empty-diff-guard` (`verifier/src/verify.ts:85-105`) — it is correct; the bug is upstream in the conductor's spec composition.
- Bulk back-fill of historical clusters. The dedupe gates only fire forward.

## Acceptance criteria

1. `atlas/src/lib/cluster-dedupe.ts` exists with the signature above and is imported by `atlas/src/cron/conductor.ts`.
2. `atlas/src/cron/conductor.ts:detectFailureClusters` calls `checkClusterDedupe` before `debate(...)` and short-circuits with `logDecision` + WhatsApp note `🟢 Cluster <id> already addressed (<reason>) — skipped` when `skip: true`.
3. `atlas/src/cron/conductor.ts:composeInvestigationSpec` emits `gaps[0]?.expected/actual/remediation` (with fallback) so cluster specs no longer say `no detail`.
4. `atlas/src/lib/__tests__/cluster-dedupe.test.ts` covers all four gates and passes under `npx vitest run`.
5. `npm run build` is clean.
6. Conventional commits, one per logical chunk: `feat(atlas-conductor): persistent cluster dedupe gate`, `feat(atlas-conductor): embed verifier gap text in cluster specs`.

## Foundation check (do this BEFORE starting)

Before implementing, verify:
- ✅ `atlas/src/cron/conductor.ts:515` still uses `const recentClusterKeys = new Set<string>()` (the lineage of this fix).
- ✅ `atlas/src/lib/` exists (or create it under the conductor's existing `atlas/src/` tree).
- ✅ `verifier/src/verify.ts:85-105` still emits `empty-diff-guard` failures as `gaps[]` rows (unchanged from `de58d26`).
- ✅ `docs/atlas-decisions/` contains at least the eight 2026-05-07 cluster ADRs that motivate this work.

If any are missing, STOP and write `.agent/questions/phase-conductor-cluster-dedupe-upgrade-q.md`.

## Suggested order

1. Add `atlas/src/lib/cluster-dedupe.ts` with the four-gate implementation.
2. Add `atlas/src/lib/__tests__/cluster-dedupe.test.ts` and run vitest until green.
3. Wire the gate into `atlas/src/cron/conductor.ts:detectFailureClusters`.
4. Patch `composeInvestigationSpec` to render structured Verifier gaps.
5. `npm run build` + commit.

## Notes

- This is the **canonical fix** for the recurring URGENT Follow-up #1 in eight predecessor ADRs (`ADR-2026-05-07-verifier-cluster-1778147114729.md` through `ADR-2026-05-07-verifier-cluster-1778161525828.md`).
- It also closes Bug B3 candidate as it manifests in cluster investigation tasks: with embedded gap text + dedupe, investigation specs become specific enough that the empty-diff-guard does not fire on legitimate investigations either.
- Pattern to follow: `verifier/src/lib/spec-parser.ts` is a good reference for filesystem-only, pure scanning logic that survives restart and degrades gracefully.

---

**Done condition:** all acceptance criteria met, build green, vitest green on the new test file, commit message references this task ID.

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-conductor-cluster-dedupe-upgrade` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: docs/atlas-decisions/ADR-*.md exists
- Actual: docs/atlas-decisions/ADR-*.md is missing
- Remediation: Create docs/atlas-decisions/ADR-*.md per task spec

