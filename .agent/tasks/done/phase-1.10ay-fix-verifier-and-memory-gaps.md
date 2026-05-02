---
priority: 1
depends-on: []
---

# Task: Phase 1.10ay — Fix verifier+memory workflow-trace gaps (write row on unknown, fetch on cron)

**Master plan reference:** Workflow-trace invariants from 1.10ad.

**Context:** Atlas surfaced 4+ workflow trace gaps over the last hour:

```
🚨 Workflow trace gaps detected:
  - verifier_audit_missing on f58f116a
  - memory_ingest_missing on f58f116a
  - verifier_audit_missing on a3f284b7
  - memory_ingest_missing on a3f284b7
  - verifier_audit_missing on 87f44cca (phase-1.10as feat ship — 6 min ago)
```

Diagnosis:

**Verifier**: when `findTaskSpec(taskId)` returns null (e.g., Verifier's clone hasn't synced to a commit where the spec exists), the server short-circuits with `verdict=unknown, audit_run_id=randomUUID()` and **does NOT write to `verifier_runs`**. So every "unknown" verdict is invisible to the workflow-trace invariant checker. Fix: write a row even on unknown verdict, with `passed=null` semantically meaning "no signal".

**Memory**: its ingest cron iterates "new commits since last_ingested_sha" but the clone never fetches. So `total_commits = 0` every run. Fix: `git fetch origin main && git reset --hard origin/main` at the START of each ingest pass, same pattern Designer + Verifier use.

**Estimated effort:** ~25 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Verifier: always write a row

`verifier/src/server.ts` — find the `findTaskSpec` short-circuit (early `json(res, 200, { verdict: 'unknown', ... })`).

Change to: still write a `verifier_runs` row with `passed = null` (or use a separate `mode = 'unknown'` value), so the workflow-trace invariant checker can confirm the audit happened even when the spec wasn't found.

If `verifier_runs.passed` is `NOT NULL`, add a migration to make it nullable. Otherwise change `mode` to capture the unknown state.

Update the row schema if needed to record the unknown reason: `unknown_reason text` column on `verifier_runs` (e.g., 'spec_not_found' / 'sync_failed' / 'judge_unreachable').

### Part B — Memory: fetch before each cron pass

`memory/src/cron/ingest.ts` (or wherever the ingest loop lives) — wrap the start of the pass in:

```typescript
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

async function syncRepoBeforeIngest(repoRoot: string): Promise<void> {
  try {
    await execFileP('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: repoRoot })
    await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: repoRoot })
    console.log('[memory-ingest] synced clone to origin/main')
  } catch (err) {
    console.warn('[memory-ingest] sync failed:', err)
  }
}
```

Call before every ingest pass. If sync fails, still attempt the ingest with the stale clone (don't bail).

### Part C — Memory ingest writes a `memory_runs` row even on zero-commit pass

Currently `memory_runs` shows `total_commits: 0` every run (so it IS writing) — but the workflow-trace invariant checker keys on `memory_runs.metadata.commit_shas` containing the just-shipped sha. Fix: when the ingest pass actually processes a commit, ensure `metadata.commit_shas: [sha1, sha2, ...]` is populated. Currently it's only writing aggregate counts.

`memory/src/cron/ingest.ts` (extend): after processing N commits, set `metadata = { total_commits: N, commit_shas: [...] }` on the inserted row.

### Part D — Verifier sync improvements

Verifier already syncs to head_after at audit start (1.10ag pattern). Verify the sync is actually working — log the post-sync HEAD vs requested head_after. If they differ, the sync silently failed and the early-return path triggers.

Add a 1-line log: `[verifier-server] post-sync HEAD: <sha> (requested <head_after>)`.

If post-sync HEAD ≠ head_after, the row should still write with `unknown_reason: 'sync_failed'`.

## Files

- `verifier/src/server.ts` (extend — write row on early-return, sync verification log)
- `verifier/src/lib/audit.ts` (extend if writeVerifierRun needs to accept `passed: null`)
- `supabase/migrations/20260502170000_verifier_unknown_reason.sql` (NEW — `unknown_reason` column + nullable `passed`)
- `memory/src/cron/ingest.ts` (extend — fetch before pass, populate commit_shas array in metadata)

## Success criteria

- `npm run build` clean (verifier + memory)
- Migration applies; `verifier_runs.passed` nullable; `unknown_reason` column exists
- Smoke test: POST `/audit` with `task_id="smoke"` (no spec file) → returns `verdict=unknown` AND a `verifier_runs` row exists with `unknown_reason='spec_not_found'`
- Memory cron logs `[memory-ingest] synced clone to origin/main` and processes >0 commits when there are new ships
- After next Builder ship, `memory_runs.metadata.commit_shas` includes the ship's sha
- Atlas's workflow-trace invariant checker stops flagging `verifier_audit_missing` and `memory_ingest_missing` for shipped commits

## Risks + mitigations

- **Risk:** Nullable `passed` breaks existing queries that assume boolean. **Mitigation:** Audit any `WHERE passed = true/false` in atlas/conductor.ts and treat null as "no signal" (skip).
- **Risk:** Memory cron's git fetch races with Atlas's git operations. **Mitigation:** wrap in withGitLock pattern (already exported from atlas; copy or replicate in memory).

## NEVER list

- Never silently swallow a sync failure — log loudly.
- Never write a `verifier_runs` row with `passed=true` when verdict is unknown — the column truth must reflect the actual signal.
- Never fetch with `git pull` (causes merge conflicts) — always `fetch + reset --hard origin/main`.
