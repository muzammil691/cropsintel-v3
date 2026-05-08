---
phase: 1.10ag2
title: Builder lifecycle completion — ensure shipped specs land in done/
status: planned
gate: in-progress count <= 2
order: follow-up to 1.10ag
estimated_builder_minutes: 60
estimated_cost_usd: 2
master_plan_section: 11.7
---

# Phase 1.10ag2 — Builder lifecycle completion fix

## Why this exists

When Builder ships spec 1.10ag (commit `bdc3291`, 900s, 9 files, 987 insertions), the "feat:" ship commit **modified** the spec file in `in-progress/` but **did not move it** to `done/`. The file stayed stuck in `in-progress/` until the freshly-deployed reaper from 1.10ag itself caught it 30 minutes later and moved it to `failed/`.

Compare:
- 1.10ae ship commit `0f7d55e`: `rename .agent/tasks/{queued => done}/phase-1.10ae-...` ✅
- 1.10af ship commit `eceef83`: `rename .agent/tasks/{queued => done}/phase-1.10af-...` ✅
- 1.10ag ship commit `bdc3291`: `.agent/tasks/in-progress/phase-1.10ag-... | 0` (modified, not moved) ❌

Builder's move-to-done step ran for the two smaller specs but failed for the larger one. We don't know why. Until we find out, **every large spec Builder ships could silently fail to complete its lifecycle**, get reaped 30 min later as a "zombie," and end up in `failed/` despite shipping correctly. The reaper is a safety net but the audit trail will be wrong.

This spec finds and fixes the root cause, plus backfills 1.10ag's audit trail.

## Foundation-first check

- ✅ Builder process exists (in `cropsintel-agent` Railway service or `agent/` folder).
- ✅ 1.10ae and 1.10af are in `done/` (proves the move-to-done logic exists and works for some specs).
- ✅ 1.10ag is in `failed/` with `reaped_at` front matter (the reaper logic from 1.10ag itself works).
- ❓ Why did the move-to-done step skip for 1.10ag specifically? UNKNOWN — diagnostic step finds out.

## Diagnostic step (Builder runs FIRST)

Document findings in `docs/atlas-decisions/2026-MM-DD-builder-lifecycle-investigation.md`.

1. **Locate the move-to-done logic.** Search `agent/`, `cropsintel-agent` repo, and `atlas/` for the code that moves a spec from `queued/` (or `in-progress/`) to `done/` after a successful build. Likely candidates: a `runSpec()` helper, an `afterShipCommit()` step, or inline logic in the agent loop. Document the file path, function name, and the exact sequence of operations.

2. **Inspect the 1.10ag log file.** Open `.agent/tasks/logs/phase-1.10ag-zombie-reaper-builder-heartbeat-1778245120.log`. Look for:
   - The "ship commit" event — what was the exit code?
   - Whether a "move to done" log line appears AFTER the ship commit.
   - Any error or timeout in the post-ship phase.
   - Whether Verifier or Designer ran and what their verdicts were.

3. **Compare with 1.10ae and 1.10af logs.** `.agent/tasks/logs/phase-1.10ae-trust-mode-runtime-fix-1778242194.log` and `.agent/tasks/logs/phase-1.10af-dashboard-live-state-truth-1778242908.log`. Find the move-to-done event in both. Document what's different in 1.10ag's log.

4. **Form a hypothesis.** Possible root causes:
   - **(A) Atomic-commit ordering bug:** the move and the file edits happen in the same commit; if file edits succeed but the rename git op fails, the spec stays put.
   - **(B) Verifier-blocking bug:** Verifier ran on 1.10ag, returned a non-pass verdict, and the move-to-done logic short-circuited (correctly per design) — but then nothing else moved the spec to `failed/` either. So Verifier is partly to blame.
   - **(C) Designer-remediation interaction:** Designer's auto-remediation cycle started right when 1.10ae/af shipped (we saw `phase-1-design-remediation-eceef830` in the log). Maybe Designer's remediation interrupted 1.10ag's lifecycle.
   - **(D) Resource exhaustion:** 9 files changed and 987 insertions overran a Builder timeout, killing the post-ship steps before move-to-done ran.
   - **(E) Working-tree dirty:** tests created untracked files, so the move git op refused.

Document which hypothesis matches the log evidence.

## Fix branches

### Branch A — atomic-commit ordering

If the move-rename and the file edits are in the same git commit and the rename failed, change the Builder loop to:
1. Run all build code edits + commit them ("feat: <spec>").
2. **Then in a separate commit**, do the rename: `git mv .agent/tasks/in-progress/X.md .agent/tasks/done/X.md && git commit -m "atlas: complete <spec> lifecycle"`.
3. Push both commits.

Separate commits make the failure mode clearer and idempotent on retry.

### Branch B — Verifier short-circuit without fallthrough

If Verifier returned `fail` or `unknown` and the move-to-done correctly didn't fire, but no fallback moved the spec to `failed/`, add an explicit fallback:

```typescript
async function completeLifecycle(spec, verdict) {
  const targetBucket = verdict.pass ? 'done' : 'failed'
  await fs.rename(
    `.agent/tasks/in-progress/${spec}.md`,
    `.agent/tasks/${targetBucket}/${spec}.md`
  )
  await git.add('-A')
  await git.commit(`atlas: complete ${spec} lifecycle → ${targetBucket}`)
  await git.push()
}
```

Always call `completeLifecycle()` at the end of every Builder run, regardless of pass/fail. No spec leaves Builder's hands without a final-state file move.

### Branch C — Designer interaction

If Designer's remediation cycle is racing the Builder's post-ship steps, serialize them: Builder must finish lifecycle completion (move + commit + push) BEFORE Designer can be invoked.

### Branch D — timeout/resource

If the Builder timeout killed the post-ship steps, the move-to-done logic must run earlier in the sequence (before any optional post-ship work like log archiving), so the most-important step is also the most-likely-to-complete step.

### Branch E — working tree dirty

If tests left untracked files, add `git add -A` before the rename to clean up, OR add tests to a `.gitignore`d directory, OR make the move-to-done robust against dirty trees.

## Required action regardless of branch — backfill 1.10ag

The work in 1.10ag genuinely shipped — git history shows 9 files committed at `bdc3291`. The reaper moved the spec to `failed/` based on lifecycle bookkeeping, not actual failure. Move it to `done/` with an audit note:

```bash
git mv .agent/tasks/failed/phase-1.10ag-zombie-reaper-builder-heartbeat.md \
       .agent/tasks/done/phase-1.10ag-zombie-reaper-builder-heartbeat.md
```

Update its front matter to add:

```yaml
backfilled_to_done_at: 2026-05-08T<runtime>
backfilled_reason: |
  Work shipped successfully at bdc3291 (9 files, 987 insertions). Reaped at 519f146 due to Builder lifecycle completion bug — fixed in 1.10ag2.
```

Commit with message: `chore(audit): backfill 1.10ag from failed/ to done/ — shipped at bdc3291, reaped due to lifecycle bug fixed in 1.10ag2`.

## Hard requirement — `completeLifecycle()` at the end of every run

Even if the diagnostic identifies a single specific bug, the spec MUST also add a defensive `completeLifecycle()` step that is the absolute last thing Builder does on every spec run. This is a guarantee: no spec ever leaves Builder's hands sitting in `in-progress/`. Add an integration test that proves it.

## Tests

`e2e/builder-lifecycle.spec.ts` (new):

- (a) Mock a Builder run that ships successfully → assert spec ends up in `done/`, not `in-progress/`.
- (b) Mock a Builder run that fails Verifier → assert spec ends up in `failed/`, not `in-progress/`.
- (c) Mock a Builder run where the build code throws an exception → assert the catch block still runs `completeLifecycle()` and spec ends up in `failed/`.
- (d) Mock a Builder run with a dirty working tree → assert the move still succeeds.

## Acceptance criteria

- Diagnostic doc exists in `docs/atlas-decisions/`.
- Root cause identified and documented with log evidence.
- Branch fix applied per diagnostic findings.
- `completeLifecycle()` (or equivalent guarantee) added as last step of every Builder run.
- 1.10ag moved from `failed/` to `done/` with backfill note in front matter.
- No spec ever lands in `in-progress/` and stays there longer than the Builder run itself (modulo the reaper safety net for genuine crashes).
- `e2e/builder-lifecycle.spec.ts` 4 scenarios green.
- `npm run build` passes.

## Out of scope

- Restructuring Builder's main loop architecture (this spec only adds the lifecycle guarantee, not a redesign).
- Disabling the reaper (it's working correctly; this spec just makes its trigger condition rarer).
- Notifying user when a spec auto-fails (separate spec if needed).
- Audit-log entries for backfills beyond the front matter note.

## Dependencies

- 1.10ae, 1.10af, 1.10ag shipped (all true; visible in repo).
