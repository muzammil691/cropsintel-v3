---
priority: 3
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
