---
priority: 1
remediation: true
remediation-attempt: 2
---
feat(phase-1.2c): re-run foundation audit gate against live-DB snapshot — remediation attempt 2 (re-enumerate after requeue body reset)

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-1.2c-foundation-audit-rerun` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: empty-diff-guard
- Severity: `fail`
- Expected: Non-empty code diff to audit
- Actual: Shipped code summary is empty or whitespace-only
- Remediation: Verify that spec.filesRequired is populated and files exist in the repo

## Root cause — why attempt 1's enumeration was lost

The remediation attempt 1 task (`phase-1.2c-foundation-audit-rerun-rem`) DID enumerate the seven authoritative audit artifacts as backtick-quoted paths, and the spec parser extracted all seven correctly (verified locally via `parseTaskSpec`). However, the Verifier still emitted `empty-diff-guard`. Two paths were possible:

1. The Verifier service was running pre-enumeration code at audit time (cache / no redeploy).
2. `findTaskSpec` (`verifier/src/server.ts:53-68`) resolves a task id by `f === ${taskId}.md OR f.startsWith(taskId)` across `in-progress/ → done/ → queued/`. With `task_id='phase-1.2c-foundation-audit-rerun'` (the *root* task id used by the auto-requeue path), both `phase-1.2c-foundation-audit-rerun.md` (title-only) and `phase-1.2c-foundation-audit-rerun-rem.md` (enumerated) live in `done/`. `readdirSync` order is filesystem-dependent, so the verifier may have picked up the title-only original instead of the enumerated rem1 file.

The auto-requeue conductor (`atlas/src/cron/conductor.ts:1957-1993`) calls `requeueWithGaps({ taskId: rootTaskId, attempt: nextAttempt })` where `rootTaskId` strips the `-rem<N>` suffix. `requeueWithGaps` (`atlas/src/lib/plan-server.ts:237-296`) then reads the *original* spec body (the one-line title-only file) and writes the new remediation file using that body — so rem1's enumeration was NOT carried forward when rem2 was generated.

This is the same empty-diff-guard signature, but a fresh occurrence: the rem2 task file (this file) needs its OWN enumeration of the audit artifacts, because the conductor reseeds the body from the title-only original each round.

## Remediation — re-populate `spec.filesRequired` directly in this task

`findTaskSpec` with `task_id='phase-1.2c-foundation-audit-rerun-rem2'` matches ONLY `phase-1.2c-foundation-audit-rerun-rem2.md` (exact filename), so once this file lands in `.agent/tasks/done/` the Verifier is guaranteed to load THIS spec and parse its backtick paths.

### Files the Verifier should load as the shipped-code diff for this audit

The authoritative artifacts from the Phase 1.2c re-run (already on disk, unchanged in this pass) are:

- `.agent/audit/live-schema-snapshot-2026-05-23.json` — authoritative live-DB
  snapshot (`_meta.is_live_db_output: true`), 300 KB, 80 tables, 900
  columns, 50 FKs, 261 indexes, 155 RLS policies, 25 §4.1 entity rows.
- `.agent/audit/gate-result-2026-05-23.md` — gate result. PASS recorded
  across all four checks. Drift findings (none V1.0-alpha-blocking)
  documented. Carries a new `## Remediation attempt 2 — task-spec
  enumeration after auto-requeue body reset (phase-1.2c rem2)` section.
- `.agent/audit/gap-report-2026-05-23.md` — gap report with Live-DB column
  populated by the 1.2c re-run.
- `.agent/audit/open-questions-2026-05-23.md` — Q5 (DB-AHEAD) populated, Q6
  resolved, Q9/Q10/Q11 added.

Supporting artifacts:

- `.agent/runtime-state.md` — Phase 1.2c completion logged on line 12.
- `.agent/tasks/done/phase-1.2c-foundation-audit-rerun-rem.md` — the rem1
  remediation that already documents the audit work; preserved here as a
  belt-and-suspenders enumeration in case `findTaskSpec` resolves to a
  different filename via the `startsWith` fallback.

Supporting scripts (already in repo, unchanged in this pass):

- `scripts/audit-live-schema.sql` — read-only introspection SQL run against
  the live DB via pooled psql.

## Gate status after this remediation

Unchanged from commit `5b1aa7d`: `PASS (against authoritative live-DB snapshot)`. This remediation pass adds no new audit findings, no schema changes, no migration drafts. It strictly fixes the empty-diff-guard false-negative by re-enumerating the artifacts directly in *this* task file, since the auto-requeue path discards the prior remediation's body.

## Verification

- `npm run build` must succeed (TypeScript + Vite clean).
- `spec.filesRequired` must be non-empty when parsed from this file (verified locally: 8 paths extracted).
- All enumerated audit artifacts must exist on disk.
- `gate-result-2026-05-23.md` carries a new `## Remediation attempt 2 — task-spec enumeration after auto-requeue body reset (phase-1.2c rem2)` section documenting this pass.

## Master plan reference

- §4 (Data foundation) — the entities the audit walks
- §4.1 (Entity inventory) — the 25 entities checked
- §11.2 (Phase 1 sub-tasks) — Phase 1.2 = foundation audit
- V3-CODING-INSTRUCTIONS §0 (foundation-first rule)
