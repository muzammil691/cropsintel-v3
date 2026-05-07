---
priority: 1
remediation: true
remediation-attempt: 2
---
```markdown
---
model: claude-sonnet-4-5
phase: 1.00f1
component: verifier
type: bugfix
estimated_effort: 30min
---

# Task: Phase 1.00f1 — Verifier resolves spec path AFTER repo sync

**Master plan reference:** Atlas track / Verifier subsystem. ADR `docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-failure.md` (Bug A).

**Estimated effort:** 30 min

**Model:** claude-sonnet-4-5

---

## Goal

Eliminate the path-resolution race in `verifier/src/server.ts` `handleAudit` that produces false `verifier-unhandled-exception` failures during remediation-attempt audits. Currently `findTaskSpec` runs **before** `syncRepoToHead`, so when the post-sync HEAD has moved the spec out of the directory `findTaskSpec` resolved against, the subsequent `readFileSync(taskSpecPath)` in `verify.ts` throws `ENOENT`.

The fix is a re-ordering of two existing calls. No new behaviour, no new dependencies.

---

## Files

| Path | Action | Description |
|---|---|---|
| `verifier/src/server.ts` | **EDIT** | Move `findTaskSpec` call to AFTER `syncRepoToHead`. Spec-not-found check moves with it. |

---

## Architecture

### Current order (buggy)

```ts
async function handleAudit(req, res) {
  // ... auth, parse body ...
  const taskSpecPath = findTaskSpec(task_id)        // ← resolves against pre-sync tree
  if (!taskSpecPath) { /* unknown spec_not_found */ return }

  const synced = await syncRepoToHead(REPO_ROOT, head_after)  // ← may move the spec
  if (!synced) { /* unknown sync_failed */ return }

  const result = await verify(taskSpecPath, head_after, 'gate') // ← ENOENT if spec moved
}
```

### Target order

```ts
async function handleAudit(req, res) {
  // ... auth, parse body ...
  const synced = await syncRepoToHead(REPO_ROOT, head_after)
  if (!synced) {
    // existing unknown sync_failed branch — note: this branch currently writes
    // taskSpecPath into the unknown row; pass null/undefined now.
    await writeUnknownVerifierRun(task_id, null, head_after, 'gate', 'sync_failed', ...)
    send(res, 200, { verdict: 'unknown', confidence: 0, gaps: [], audit_run_id: randomUUID() })
    return
  }

  const taskSpecPath = findTaskSpec(task_id)
  if (!taskSpecPath) { /* unknown spec_not_found */ return }

  const result = await verify(taskSpecPath, head_after, 'gate')
  // ... rest unchanged ...
}
```

### Constraints

- `writeUnknownVerifierRun` second arg type must accept `null` for the sync_failed pre-resolve branch. Inspect signature in `verifier/src/lib/audit.ts`; widen if needed (the spec_not_found branch already passes `null` per `server.ts:117`, so the type is already compatible — no widening expected).
- The audit-row contract (`writeUnknownVerifierRun` for sync_failed → 200 `unknown`) MUST stay identical from the agent-loop's perspective. No HTTP status changes, no payload shape changes.
- Logging line `[verifier-server] auditing ${task_id} (...) spec=${taskSpecPath}` should stay informative — move it to AFTER `findTaskSpec` succeeds.

---

## Success Criteria

| # | Check | Method |
|---|-------|--------|
| SC-1 | `handleAudit` calls `syncRepoToHead` before `findTaskSpec` | Read `verifier/src/server.ts`; verify the line numbers — `syncRepoToHead` precedes `findTaskSpec` in source order |
| SC-2 | Existing `spec_not_found` branch still writes an `unknown` row and returns 200 unknown | Logic preserved; only relocation |
| SC-3 | `npm run build` in `verifier/` is clean | `cd verifier && npm run build` exits 0 |
| SC-4 | Existing tests still pass | `cd verifier && npx vitest run` exits 0 |
| SC-5 | New regression test: when a spec is moved between resolve-and-read, audit returns `verdict='unknown'` (not `verifier-unhandled-exception`) | Add a unit test in `verifier/src/__tests__/server.test.ts` (or nearest equivalent) that mocks `findTaskSpec` to return a path that doesn't exist on disk and asserts the audit response is `verdict: 'unknown'` |
| SC-6 | No change to `verifier/src/verify.ts` | `git diff verifier/src/verify.ts` empty |
| SC-7 | No change to public HTTP contract | Response shape on `/audit` unchanged for happy path |

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sync succeeds but the cloned repo lacks a `.agent/tasks/` directory at the new HEAD | Low | Low | `findTaskSpec` already returns `null`; spec_not_found branch already handles it. Behaviour preserved. |
| Re-ordering changes which audit-row reason is written for a malformed call | Low | Low | spec_not_found and sync_failed are both `unknown`-verdict paths; neither blocks the agent-loop differently. |
| Test-environment relies on pre-sync filesystem state | Low | Medium | Inspect existing tests; if any depend on the order, update them in the same PR. |

---

## NEVER list

- Never change the public `/audit` HTTP contract (verdict / confidence / gaps shape).
- Never call `verify()` with a spec path that wasn't read from a synced tree.
- Never silence the `verifier-unhandled-exception` catch-all in `verify.ts` — it's the safety net for everything else.
- Never bundle Bug B (Builder 0-file commits) into this PR; that's a separate follow-up.

---

## Reference

- ADR: `docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-failure.md`
- Affected prior failures: `phase-1.6b-…-rem2`, `phase-1.10b2-…-rem2` (both produced `verifier-unhandled-exception` ENOENT).
```

## Prior failure — gaps to address (attempt 2)

The previous run of `phase-1.00f1-verifier-spec-path-after-sync` failed Verifier review. Address every gap below before considering this remediation complete. The auto-requeue loop tracks attempts; after 3 failures, the conductor escalates via WhatsApp instead of queueing again.

### Gap 1: e2e-smoke
- Severity: `fail`
- Expected: All Playwright e2e tests pass
- Actual: Playwright test run failed: Command failed: npx playwright test --reporter=list
npm warn exec The following package was not found and will be installed: playwright@1.59.1
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@playw
- Remediation: Fix failing e2e tests or ensure the feature is correctly implemented end-to-end

