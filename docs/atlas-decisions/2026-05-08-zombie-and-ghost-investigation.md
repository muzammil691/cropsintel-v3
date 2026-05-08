# 2026-05-08 — Zombie & ghost-duplicate investigation (phase 1.10ag)

## Why this doc exists

Three coupled cron-layer problems:

1. **Builder zombies** — when Builder crashes mid-spec, the spec stays in `.agent/tasks/in-progress/` forever and the cockpit shows a fake "running" timer.
2. **No liveness signal** — the dashboard pipeline relies on the `mtime` of the in-progress file, which only proves "Builder picked this up", not "Builder is still alive."
3. **Ghost duplicates** — force-cancelling a spec moves the file from `in-progress/` → `cancelled/`, but the conductor's auto-requeue cron then re-creates the spec elsewhere (queued/ → in-progress/) from a stale list.

## Where the requeue actually lives

- **Producer:** `atlas/src/cron/conductor.ts → autoRequeueOnVerifierFail()` (lines ~1517–1603). Reads `verifier_runs` rows where `passed = false` AND `ran_at > now() - 1h`, dedupes by `task_id`, then calls `requeueWithGaps()` for each unique failure.
- **Writer:** `atlas/src/lib/plan-server.ts → requeueWithGaps()` (lines ~204–268). Creates `${taskId}-rem.md` (or `-rem<N>.md` for retries) under `.agent/tasks/queued/` with the gaps section appended.
- **Lineage parsing:** the conductor strips the `-rem<N>` suffix from `task_id` to compute `rootTaskId`, then increments `attempt`. The remediation's filename is therefore distinct from the original failed spec — but it is the same `taskId`-family that the user sees in WhatsApp pings.
- **Cap:** 3 attempts, then escalates via WhatsApp instead of queueing.

## What `requeueWithGaps` checks today

`findExistingSpecBucket(remFilename)` — covers `queued/`, `in-progress/`, and `done/`. Returns the bucket name if found.

- `queued` → idempotent no-op (don't double-queue).
- `in-progress` → idempotent no-op (Builder already running this remediation).
- `done` → bumps `attempt` and recurses (try `-rem2`, then `-rem3`).
- `failed` / `cancelled` → **NOT CHECKED.** The function happily re-queues a remediation whose previous copy was failed or force-cancelled.

## Why ghosts appear

Sequence that produced the 11 ghosts I cleaned up this morning:

1. `requeueWithGaps` writes `phase-X-rem.md` to `queued/`.
2. Builder picks it up → moves to `in-progress/`.
3. Operator force-cancels the in-progress copy → file moves to `cancelled/`.
4. Conductor's in-memory `autoRequeuedFailures` Set goes stale on Railway redeploy (it's a process-local `Set`, not persisted).
5. After redeploy, `autoRequeueOnVerifierFail` re-runs against the same recent `verifier_runs` row, sees the failure for `task_id = phase-X` is "new" (Set was reset), and calls `requeueWithGaps` again.
6. `requeueWithGaps` checks `queued/`, `in-progress/`, `done/` for `phase-X-rem.md`, finds nothing (the cancelled copy lives elsewhere), and writes a **fresh ghost copy** to `queued/`.
7. Builder picks the ghost up → moves to `in-progress/`. Now the operator has a "ghost" running on a spec they'd already cancelled.

The commit `8320b8f` (`atlas: requeue with gaps — phase-1-CLUSTER-investigation-1778146192564 (attempt 2)`) is exactly step 6.

## How spec-file content is sourced

`requeueWithGaps` reads the original failed spec from `.agent/tasks/failed/<taskId>.md`, falling back to `.agent/tasks/done/<taskId>.md`. It does NOT read from `cancelled/`. So when a remediation is force-cancelled, the original failure source is still intact in `failed/` — that's why the requeue can keep producing fresh ghost copies indefinitely.

There is no Supabase-side "what should be running" list — the bug is entirely file-system + in-memory dedup decay.

## The fix (shipped in 1.10ag)

1. **Builder heartbeat** — Builder posts state to `/atlas/agents/builder/heartbeat`; the receiver mirrors `{spec_id, beat_at, pid}` into `atlas_config.builder_heartbeat`. The reaper consults this row (not just file mtime) before reaping.
2. **Reaper** — adds `reapZombies()` to the conductor heartbeat. A spec >30 min old in `in-progress/` whose `spec_id` does NOT match the active heartbeat is moved to `failed/` with frontmatter recording why.
3. **safeRequeue** — new helper that checks `cancelled/`, `failed/`, `done/`, `in-progress/`, `queued/` before creating an `in-progress/` file. Refuses to recreate a spec already in a terminal state.
4. **safeRequeueWithReset** — explicit operator-only path that archives the prior copy (under `cancelled/.archive/<ts>/`) and creates fresh.
5. **POST /atlas/cleanup/ghosts** — one-shot endpoint that scans `in-progress/`, deletes any file whose name also exists in `cancelled/`, `failed/`, or `done/`, commits + pushes. Replaces the manual cleanup we did this morning.

`requeueWithGaps` itself adopts the strict check: if the remediation filename is already in `cancelled/` or `failed/`, the function refuses (with `ok:false, reason='already in <bucket>'`) and writes an `agent_audit_log` row so we can prove ghosts were blocked.

## Risk: cancelling a remediation now blocks legitimate retries

Mitigation: the conductor's existing 3-attempt counter is per-`rootTaskId`, so a cancelled `-rem` does NOT prevent the next attempt (`-rem2`) — the filename is distinct. Only the same exact filename is blocked. If the operator wants to retry a force-cancelled remediation, they call `safeRequeueWithReset` (admin-gated chat tool, not surfaced in cockpit yet).
