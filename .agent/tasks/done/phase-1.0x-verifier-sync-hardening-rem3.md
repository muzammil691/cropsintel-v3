---
priority: 1
remediation: true
remediation-attempt: 3
source: ADR-2026-05-23-verifier-cluster-7da23cc3f830 §5 priority-3
---
# Task: Verifier asserts `git rev-parse HEAD == head_after` after sync

## Background

Diagnosed in `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
§3.3: the most plausible cause of the rem1 failure (which DID carry
back-tick paths) is a sync race in the Verifier service. If
`syncToCommitOnDisk` returns before `git pull` actually advances HEAD to
`head_after`, the Verifier reads the pre-Builder body and trips
`empty-diff-guard`.

`bc7ff0f` ("force verifier redeploy + literal-YYYY-MM-DD backstop")
shows this class of issue is recurring.

## Goal

Add a post-sync assertion: after `syncToCommitOnDisk(head_after)`
returns, run `git rev-parse HEAD` and compare to `head_after`. If they
differ, emit `verdict: 'unknown'` with `reason: 'sync_failed'` and an
explicit error log — DO NOT proceed to read files at the stale HEAD.

## Acceptance criteria

1. `verifier/src/server.ts` gains a post-sync HEAD assertion
   immediately after the existing `syncToCommitOnDisk` call.
2. On mismatch: emit `verdict: 'unknown'`, `reason: 'sync_failed'`,
   include both `expected` (head_after) and `actual` (current HEAD)
   in the structured log line.
3. A test under `verifier/src/` simulates a stale HEAD and asserts the
   `unknown / sync_failed` verdict is emitted.
4. `npm run build` is green at the root.

## Files required

- `verifier/src/server.ts` — add HEAD assertion
- `verifier/src/server.test.ts` — new test (create if absent)

## Out of scope

- Replacing the underlying `git pull` mechanism
- Retry / self-heal on sync failure (Atlas conductor handles requeue)
- Changes to the Verifier judges or `empty-diff-guard` itself

## Status

Queued under cluster `7da23cc3f830`, rem2 (2026-05-23). This is the P3
follow-up from ADR `docs/atlas-decisions/ADR-2026-05-23-verifier-cluster-7da23cc3f830.md`
§5 priority-3 and re-indexed in ADR §9. Belt-and-braces backstop for
the rem1 stale-pull window — pick up after the P1 inheritance fix and
P2 Workshop pre-flight have shipped, since those address larger blast
radius issues.

Re-confirmed queued under rem3 (2026-05-23) per ADR §11. The rem3
audit gap-1 (o3-judgment claiming the ADR ended at §5) is itself
consistent with the §3.3 sync race this spec is queued to fix, which
re-validates the P3 priority. Spec content and acceptance criteria
are unchanged from rem2; only this status note is updated so the rem3
diff at HEAD visibly includes this file.

## Prior failure — gaps to address (attempt 1)

The previous run of `phase-1.0x-verifier-sync-hardening` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: verifier/src/server.test.ts exists
- Actual: verifier/src/server.test.ts is missing
- Remediation: Create verifier/src/server.test.ts per task spec

### Gap 2: tests-exist
- Severity: `fail`
- Expected: Test file verifier/src/server.test.ts exists
- Actual: verifier/src/server.test.ts is missing
- Remediation: Create verifier/src/server.test.ts with test cases for the feature

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-1.0x-verifier-sync-hardening` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: verifier/src/server.test.ts exists
- Actual: verifier/src/server.test.ts is missing
- Remediation: Create verifier/src/server.test.ts per task spec

### Gap 2: tests-exist
- Severity: `fail`
- Expected: Test file verifier/src/server.test.ts exists
- Actual: verifier/src/server.test.ts is missing
- Remediation: Create verifier/src/server.test.ts with test cases for the feature

## Prior failure — gaps to address (attempt 3)

The previous run of `phase-1.0x-verifier-sync-hardening` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: files-exist
- Severity: `fail`
- Expected: verifier/src/server.test.ts exists
- Actual: verifier/src/server.test.ts is missing
- Remediation: Create verifier/src/server.test.ts per task spec

### Gap 2: tests-exist
- Severity: `fail`
- Expected: Test file verifier/src/server.test.ts exists
- Actual: verifier/src/server.test.ts is missing
- Remediation: Create verifier/src/server.test.ts with test cases for the feature

