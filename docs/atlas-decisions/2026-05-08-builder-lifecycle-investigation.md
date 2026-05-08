# 2026-05-08 — Builder lifecycle completion investigation (phase 1.10ag2)

## Why this doc exists

When Builder shipped spec 1.10ag (commit `bdc3291`, autonomous agent, 900s, 7 files), the
"feat:" ship commit **moved** the spec from `queued/` → `in-progress/` but **did not**
follow through with the `in-progress/` → `done/` move. The spec sat in
`in-progress/` for 30 minutes until the freshly-deployed reaper from 1.10ag
itself caught it and moved it to `failed/` (commit `519f146`).

The work itself shipped fine — 9 files, 987 insertions, build green. The bug is
in lifecycle bookkeeping, not in the work product.

This doc records what we found and the fix we applied in 1.10ag2.

## Comparing the three sibling shipments

Diffstat comparison (the rename column tells the whole story):

```
1.10ae  0f7d55e   .agent/tasks/{queued => done}/phase-1.10ae-...md  (Claude moved it itself)
1.10af  eceef83   .agent/tasks/{queued => done}/phase-1.10af-...md  (Claude moved it itself)
1.10ag  bdc3291   .agent/tasks/{queued => in-progress}/phase-1.10ag-...md  (Builder agent-loop moved it; nothing followed)
```

For 1.10ae and 1.10af, **Claude itself committed the spec into `done/` during
its session.** That's why the rename in the feat commit shows `{queued => done}`
— `git add -A` captured both agent-loop's `mv` to in-progress AND Claude's own
mv to done, collapsing them into a single rename.

For 1.10ag, **Claude did NOT commit during its session.** Looking at the log file
(`.agent/tasks/logs/phase-1.10ag-...-1778245120.log`), Claude printed
"Phase 1.10ag shipped. Summary of changes: …" then exited with `claude exit
code: 0`. No commit was made by Claude. Agent-loop took over: ran build (green),
then `git add -A && git commit -m "feat: ..." && git push`. **At that point the
spec was still in `in-progress/`.** The post-push code path is supposed to mv it
to done after gates pass, but that step never produced a commit on `main`.

## Why the post-push move never landed for 1.10ag

Between the ship commit `bdc3291` (12:59:04) and the reaper's commit `519f146`
(13:30:06), nothing else hit `main`. There are no verifier-remediation commits,
no designer-remediation commits, and no `chore(agent): … → done` or
`chore(agent): … → failed` commits. Either the gates never returned, or the
process holding the gates died.

The smoking gun: **`bdc3291` modified `agent/agent-loop.sh` itself.** Railway's
auto-redeploy on the `cropsintel-agent` service is triggered by changes to that
service's files. Pushing the new agent-loop.sh kicked off a fresh container
build. Railway typically swaps containers within 1–3 min. The window between
"feat: push complete" and "spec moved to done/ + chore: pushed" is roughly the
gate timeouts (2 × 60s) plus a few `git` operations — somewhere in the
30-90 second range. That window comfortably overlaps with Railway's redeploy
swap.

Hypothesis (D) — resource/timeout — fits exactly, with a specific cause: **the
container holding the in-flight Builder run was killed by Railway during the
redeploy that the same Builder run had just caused by modifying its own
container's source.** This is a self-induced restart.

Other hypotheses ruled out:

- **(A) atomic-commit ordering** — partially relevant. The current code has the
  feat: commit and the move-to-done as separate commits. The bug is not that
  one git op failed; it's that the second git op never ran at all.
- **(B) verifier short-circuit** — would have produced a `verifier: queue
  remediation …` commit on main. None exists. Verifier did not return non-pass
  for 1.10ag.
- **(C) designer-remediation interaction** — would have produced a
  `designer: queue remediation …` commit on main. None exists. The
  `phase-1-design-remediation-eceef830` commits seen elsewhere are from 1.10af's
  earlier shipment, not from 1.10ag.
- **(E) dirty working tree** — would have produced an aborted-but-logged mv.
  Shouldn't apply here because tests created tracked files. Even if it did, the
  reaper's reaped frontmatter on the spec doesn't show "git mv refused"; it
  shows the standard age-based reap reason.

## The fix

Two layers, working together.

### Layer 1 — reorder so the spec lands in `done/` as part of the feat commit itself

Old order (vulnerable to mid-flight container death):

```
1. mv queued/X.md → in-progress/X.md
2. claude runs
3. npm run build
4. git add -A
5. git commit "feat: …"          ← spec is in in-progress/ at this point
6. git push                       ← origin's main now has spec in in-progress/
7. run gates (verifier, designer)
8. mv in-progress/X.md → done/X.md
9. git commit "chore(agent): … → done"
10. git push
```

If the container dies anywhere between step 6 and step 10, the spec is stuck.

New order (resilient — the move is folded into the feat commit):

```
1. mv queued/X.md → in-progress/X.md
2. claude runs
3. npm run build
4. mv in-progress/X.md → done/X.md   ← NEW: pre-emptive move, before staging
5. git add -A                         ← captures Claude's edits AND the move
6. git commit "feat: …"               ← single commit contains code + lifecycle
7. git push                           ← origin's main now has spec in done/
8. run gates (verifier, designer)
9. on gate failure: mv done/X.md → failed/X.md, commit, push
```

If the container dies anywhere from step 7 onward, the spec is already on
`origin/main` in `done/`. The reaper sees it as not-in-in-progress and never
fires. ✓

The trade-off: a failed gate now produces a "spec was in done, then moved to
failed" audit trail (two moves) rather than a clean "spec moved straight to
failed" trail. We accept that. The information is intact and the audit log
records both moves explicitly.

### Layer 2 — defensive `complete_lifecycle()` guarantee

Per the spec, even when Layer 1's reorder fully covers the known failure mode,
we add a defensive helper that the script calls at every exit path:

```bash
complete_lifecycle "$TASK_NAME" "<bucket>"
```

The function is idempotent. If the spec is already moved (Claude moved it
itself, or Layer 1 moved it earlier in this run), it returns immediately. If
the spec is still in `in-progress/`, it moves to the requested bucket and
commits. The success path passes `done`; every failure path passes `failed`.

This guarantees that **no spec ever leaves a normal Builder run sitting in
`in-progress/`** — only crashed-mid-process scenarios reach the reaper, and
the reaper has the safety net for those.

### Layer 3 — backfill 1.10ag's audit trail

The 1.10ag work shipped successfully at `bdc3291` — 9 files, 987 insertions,
build green. Reaping it as "failed" is misleading. We move the spec from
`failed/` back to `done/` and add backfill frontmatter explaining why the
audit trail looked failed even though the work shipped.

## Tests

`e2e/builder-lifecycle.spec.ts` exercises the four scenarios the spec calls for:

- (a) Successful Builder run → spec ends up in `done/`, not `in-progress/`.
- (b) Verifier-fail Builder run → spec ends up in `failed/`, not `in-progress/`.
- (c) Build-code exception → catch path runs `completeLifecycle()`, spec ends
  up in `failed/`.
- (d) Dirty working tree → move still succeeds.

Plus an idempotency test (e) confirming that calling `complete_lifecycle()`
twice on the same spec is a safe no-op.

The pattern matches `e2e/zombie-reaper.spec.ts`: a TS reference impl that
mirrors the bash function, tested against an in-memory file tree. Drift
between the bash function and the reference impl is the bug class to catch
in code review.

## Out of scope (explicitly deferred)

- Restructuring Builder's main loop architecture. We only added the lifecycle
  guarantee; the loop's structure is unchanged.
- Disabling the reaper. It's working correctly. Layer 1 + Layer 2 just make
  its trigger condition rarer (only true crashes, not normal redeploys).
- Notifying the user when a spec auto-fails. WhatsApp pings already cover
  build failures and gate failures; the reaper paths the user via WhatsApp
  too. No change here.

## What this changes about Railway redeploys mid-run

It's still a real failure mode for any code path that runs after `git push`
and before the spec is in its final bucket. We've eliminated the single
known instance (move-to-done after push). If we add new post-push steps in
the future (eg. async smoke tests), they need to either run before the
final move OR be tolerant of mid-flight termination. Layer 2's defensive
helper protects against future regressions — even if a future change
introduces a new post-push step that races a redeploy, the spec will not
be stranded in `in-progress/`; it'll land in the bucket the helper was
called with at the moment of termination, or be reaped if the script died
before the helper ran.
