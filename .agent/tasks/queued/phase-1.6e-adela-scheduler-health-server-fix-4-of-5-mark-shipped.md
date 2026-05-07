# Task: Mark phase-1.6e adela scheduler/health-server rem-chain as shipped

**Type:** tactical-cleanup (no code change required)
**Source:** `ADR-2026-05-07-verifier-cluster-1778153395522.md` follow-up #1 (also recommended in `ADR-2026-05-07-verifier-cluster-1778152873297.md` follow-up #1)
**Estimated effort:** 2 file moves + 1 commit.

## Background

The `phase-1.6e-adela-scheduler-health-server-fix-4-of-5*` rem-chain has caused **at least two duplicate Verifier failure clusters** (`1778152873297`, `1778153395522`) on 2026-05-07. The implementation work the spec asks for was **already shipped** in two earlier dev-authored commits:

- `1dd90dd` — `feat: Adela scheduler & health server with ai-analyst job (phase-1.6e)` — adds `adela/src/scheduler.ts`, `adela/src/index.ts`, and the `node-cron` dep in `adela/package.json`.
- `1b0e75d` — `fix: add missing docs symlinks (phase-1.6e-adela-scheduler-health-server-fix-4-of-5-rem)` — adds the `docs/master-plan.md` symlink.

Because the deliverables already exist on disk when the autonomous Builder picks up the rem spec, the Builder commits 0 functional files (Bug B1) and the Verifier's AI judges then read the empty diff as "missing implementation" (Bug B2). Atlas auto-requeues forever.

The proper fix for B1/B2 is on a separate track. This task is the **tactical short-circuit**: close out the rem-chain in the queue so the loop stops firing.

## Pre-flight verification (the agent must perform before any moves)

Confirm all of the following are true at HEAD. If any check fails, do **not** proceed with the moves; instead write a question file and stop.

1. `adela/src/scheduler.ts` exists.
2. `adela/src/index.ts` exists.
3. `adela/package.json` contains `"node-cron"` under `dependencies`.
4. `docs/master-plan.md` exists (a symlink is acceptable).
5. `git log --oneline 1dd90dd^..HEAD -- adela/src/scheduler.ts adela/src/index.ts adela/package.json` is non-empty (the implementation is reachable from HEAD).

## Acceptance criteria

1. Move these spec files from `.agent/tasks/in-progress/` to `.agent/tasks/done/`:
   - `phase-1.6e-adela-scheduler-health-server-fix-4-of-5-rem2.md`
   - `phase-1.6e-adela-scheduler-health-server-fix-4-of-5-rem3.md`
   (`-rem` is already in `done/` per current state; do **not** touch it.)

2. If any `phase-1.6e-adela-scheduler-health-server-fix-4-of-5-rem*.md` file currently sits in `.agent/tasks/queued/`, move it to `done/` as well.

3. Commit with message exactly:
   ```
   chore: mark phase-1.6e-adela-scheduler-health-server-fix-4-of-5 rem-chain as shipped (1dd90dd + 1b0e75d)

   Closes the auto-requeue loop documented in
   docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-1778152873297.md and
   docs/atlas-decisions/ADR-2026-05-07-verifier-cluster-1778153395522.md.
   No functional code change.
   ```

4. Run `npm run build` to verify nothing regressed (this commit shouldn't affect the build, but the contract requires a green build before push).

5. Push to `main`.

## Out of scope

- Do **not** edit the spec contents, only move them.
- Do **not** attempt to fix Bug B1 or Bug B2 here — those are tracked on the agent-loop and verifier tracks respectively.
- Do **not** touch the `phase-1.6e-adela-ai-analyst-daily-brief-generator` chain (already in `done/`).

## If preflight fails

Write `.agent/questions/phase-1.6e-adela-scheduler-health-server-fix-4-of-5-mark-shipped-q.md` documenting which check failed, and stop. Do not move any files.
