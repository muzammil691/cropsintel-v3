---
adr: 2026-05-07-verifier-cluster-failure
date: 2026-05-07
status: accepted
investigators: atlas-conductor, autonomous-agent
trigger: 4 Verifier failures within 30 minutes (cluster threshold tripped)
---

# ADR — Verifier cluster failure root cause (2026-05-07)

## Context

Atlas conductor flagged a Verifier-failure cluster of 4 tasks in a 30-minute window:

| time (UTC)        | task                                                                  | builder commit (files) |
|-------------------|-----------------------------------------------------------------------|------------------------|
| 2026-05-07 08:59  | `phase-1.6c-adela-supabase-client-wrapper-and-abc-scraper-completion` | `9db3201` (0 files)    |
| 2026-05-07 09:04  | `phase-1.6d-adela-scheduler-strata-news-scrapers`                     | `a2276f5` (0 files)    |
| 2026-05-07 09:12  | `phase-1.10b2-atlas-schema-complete-supabase-migration-rem2`          | `a901528` (0 files)    |
| 2026-05-07 09:18  | `phase-1.6b-adela-docker-railway-deployment-config-rem2`              | `df5b277` (5 files)    |

3-of-3 multi-brain agreement to investigate.

## Investigation (hypotheses checked)

| # | Hypothesis | Result |
|---|---|---|
| 1 | Recent migration broke a contract | **Ruled out.** Latest migrations (`20260507085227_atlas_schema_complete.sql`, `20260507120000_atlas_schema_complete.sql`) are idempotent atlas-schema DDL; verifier does not depend on these tables at parse/audit time. (Note: two same-name copies of the migration are present — a separate hygiene issue, see follow-up.) |
| 2 | Env var missing or rotated | **Ruled out.** Verifier's verdict path crashes deterministically on `readFileSync`, not on auth or API key path. Judges short-circuit when programmatic checks already fail. |
| 3 | Builder picked up a stale base | **Partially confirmed for tasks 1, 2, 3.** Three of four Builder commits shipped 0 files (`9db3201`, `a2276f5`, `a901528`). This is a Builder/agent-loop issue, not a Verifier bug. |
| 4 | Verifier prompt regression in `verifier/src/verifiers/` | **Ruled out.** No commits to `verifier/` since `ab69331` (phase-1.00f hardening, before the cluster window). The judges weren't reached for the failing tasks — programmatic checks failed first. |

## Root cause — two coincident bugs, not one

The cluster is not a single root cause. It's two distinct failure modes that fired in the same window:

### Bug A (primary, affects `-rem2` audits) — `verifier/src/server.ts` path-resolution race

`handleAudit` resolves the spec path **before** syncing the local clone:

1. `findTaskSpec(task_id)` reads the verifier's filesystem and returns e.g. `<repo>/.agent/tasks/queued/<task>-rem.md`.
2. `syncRepoToHead(REPO_ROOT, head_after)` runs `git fetch && git reset --hard head_after`. If `head_after` includes a commit that moved that spec out of `queued/` (to `in-progress/` or `done/`), the file no longer exists at the resolved path.
3. `verify(taskSpecPath, …)` calls `readFileSync(taskSpecPath)` → `ENOENT`. The catch-all in `verifier/src/verify.ts:151–181` produces a `verifier-unhandled-exception` gap.

Evidence: gap text in remediation spec for `phase-1.10b2-…-rem3`:

> Actual: Unhandled exception: ENOENT: no such file or directory, open '/workspace/cropsintel-v3/.agent/tasks/queued/phase-1.10b2-atlas-schema-complete-supabase-migration-rem2.md'

Same pattern in `phase-1.6b-…-rem3`. The path printed in the error is **inside `queued/`**, confirming the pre-sync resolution. After the sync, the spec had already been moved by the agent loop's bookkeeping commit, so the file at that path was gone.

This bug is silent under the common case (spec untouched in `head_after`); it surfaces specifically on remediation-attempt audits because the auto-requeue loop frequently moves the prior remediation file out of `queued/` in the same commit window.

### Bug B (secondary, affects `phase-1.6c` and `phase-1.6d`) — Builder shipping 0 files

Three commits in the cluster window shipped 0 files (`9db3201`, `a2276f5`, `a901528`), per the autonomous-agent commit messages. For `phase-1.6c` (14s wall time) and `phase-1.6d`, this means `checkFilesExist` deterministically failed because no spec-required file was created. This is not a Verifier defect — the Verifier correctly rejected the work.

The Builder 0-file pattern likely correlates with one of:
- agent prematurely declaring "done" without writing files (no enforcement of "files ≥ 1" on commit);
- agent writing files in a sub-dir not committed (e.g. `node_modules/` exclusions);
- agent loop's `git add` scope not catching new directories.

Diagnosis of Bug B is out of scope for this ADR; Verifier's behaviour was correct. Tracked as a separate follow-up.

## Decision

Bug A is in scope for an immediate fix follow-up because it produces false-negative `fail` verdicts that consume the 3-attempt remediation budget without ever giving the Builder a real signal. After 3 such crashes, the conductor escalates via WhatsApp — wasting the budget and a human alert.

Bug B is a separate Builder-side bug; tracked but not bundled.

## Fix in scope (next task)

`phase-1.00f1-verifier-spec-path-after-sync` — sync the repo first, then resolve the spec path. Two-line surface area:

```ts
// in handleAudit, BEFORE findTaskSpec:
const synced = await syncRepoToHead(REPO_ROOT, head_after)
if (!synced) { /* unknown row + 200 unknown */ return }

// THEN resolve:
const taskSpecPath = findTaskSpec(task_id)
```

This guarantees `findTaskSpec` reads the same tree that `verify()` will `readFileSync`. The `unknown` early-return on sync failure already exists; reordering does not weaken it.

Acceptance: verifier rejects deliberately-deleted spec with `verdict='unknown'` (spec_not_found), not `verifier-unhandled-exception`.

## Follow-up tasks created

1. **`phase-1.00f1-verifier-spec-path-after-sync`** (queued separately; this ADR is the rationale).
2. **Builder 0-file diagnosis** — investigate why `phase-1.6c`/`phase-1.6d` autonomous-agent runs committed 0 files. Owner: agent-loop track.
3. **Migration filename collision** — `20260507085227_atlas_schema_complete.sql` vs `20260507120000_atlas_schema_complete.sql` are duplicates from two separate remediation attempts. Decide which is canonical and remove the other before `npx supabase db push`. Owner: phase-1.10b2 follow-up.

## Status

**Closed.** Root cause documented; one fix queued; two adjacent issues handed off.

## Postmortem — gap recorded on this ADR's own attempt 1 (added 2026-05-07)

Attempt 1 of `phase-1-CLUSTER-investigation-1778146192564` was rejected by Verifier with a single `verifier-unhandled-exception` gap:

> Unhandled exception: ENOENT: no such file or directory, open '/workspace/cropsintel-v3/.agent/tasks/queued/phase-1-CLUSTER-investigation-1778146192564.md'

This is **the same Bug A this ADR diagnoses, observed on the ADR's own audit**. Concrete chain:

1. The investigation commit `757fa92` placed the spec at `queued/phase-1-CLUSTER-investigation-1778146192564.md`.
2. Agent loop later moved that file to `in-progress/` and pushed `531fa15` as `head_after`.
3. The Verifier deployment in production was still running pre-fix `server.ts` (the fix `7a339ce` had not yet been redeployed). It called `findTaskSpec` first, resolving against the verifier clone's stale tree that still had the spec in `queued/`, then `syncRepoToHead` advanced HEAD to `531fa15` where the spec is in `in-progress/`. `readFileSync('queued/…')` then `ENOENT`'d.

Resolution applied:

- **Code**: fix is in main at commit `7a339ce` (and verified present in `verifier/src/server.ts:115-139` — `syncRepoToHead` runs before `findTaskSpec`).
- **Tests**: regression tests added in `verifier/src/__tests__/server.test.ts` (commit `7a339ce`).
- **Operational requirement**: Verifier service on Railway must redeploy from main for the fix to take effect at audit time. Until that redeploy, identical ENOENT crashes are expected on any task whose spec moves between `queued/` ↔ `in-progress/` ↔ `done/` between Builder push and Verifier audit. Tracked as a deployment-side concern, not a code defect.

**Conclusion:** the gap on attempt 1 is fully explained by the diagnosis already captured above. No further code change is in scope for this investigation task. The follow-up `phase-1.00f1-verifier-spec-path-after-sync` (already shipped) is the canonical fix.
