---
priority: 1
depends-on: []
---

# Task: Phase 1.10af — Atlas trust-mode persistence + git mutex (workflow fix)

**Master plan reference:** AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md §3 items 1, 6 (priority CRITICAL + HIGH).
**Context:** Atlas service has two production bugs surfaced by 2026-05-01 log audit:

**Bug D — trust mode reverts to passive on every redeploy.** Logs show `[trust-mode] no DB override; using env default: passive` even after the user explicitly set mode=chat via `POST /atlas/mode` last night. 1.10y was supposed to fix this but evidence says either (a) the `atlas_config` table doesn't exist / row never written, or (b) `setMode`'s upsert silently no-op'd on RLS or schema error, or (c) `loadTrustModeFromDb` looks at the wrong column. Result: every Atlas redeploy wipes the user's mode flip; conductor stays in passive forever.

**Bug E + F — git lock race condition every heartbeat.** Logs show repeated `[atlas-queue-order] git refresh failed: Error: Command failed: git reset --hard origin/main → fatal: Unable to create '.git/index.lock': File exists. Another git process seems to be running...`. The snapshot cron (every 5 min) and the conductor heartbeat (every 5 min) both call git fetch+reset on the same `/workspace/cropsintel-v3` clone simultaneously. They collide on the index.lock. Result: queue-order computation fails every heartbeat; Atlas can't see the queue accurately; spec-author tool would also fail when it tries to commit a new spec.

**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Trust-mode persistence (Bug D)

1. **Diagnose first, then patch.** Read the current state of:
   - `atlas/src/lib/trust-mode.ts` — confirm `setMode` and `loadTrustModeFromDb` are wired per the 1.10y spec
   - `supabase/migrations/` — find the migration that creates `atlas_config`. If missing or never applied, that's the root cause.
   - `atlas/src/lib/supabase.ts` — confirm the supabase client uses the SECRET key (not anon) so RLS doesn't block writes.
2. **If `atlas_config` table is missing or has wrong schema:** ship a new migration `supabase/migrations/20260501110000_atlas_config_table.sql` with the canonical schema:
   ```sql
   CREATE TABLE IF NOT EXISTS public.atlas_config (
     key text PRIMARY KEY,
     value text NOT NULL,
     set_by text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   ALTER TABLE public.atlas_config ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "atlas_config_service_role_write"
     ON public.atlas_config FOR ALL
     USING (auth.role() = 'service_role')
     WITH CHECK (auth.role() = 'service_role');
   CREATE POLICY "atlas_config_admin_team_read"
     ON public.atlas_config FOR SELECT
     USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team') OR auth.role() = 'service_role');
   ```
3. **`setMode` must throw on persist failure** (per 1.10y intent). Current code catches and warns; change it to throw a structured error so the HTTP 500 response surfaces the truth instead of silently lying about success. Update `server.ts` `/atlas/mode` POST handler to return `{ ok: false, error: <msg> }` with HTTP 500 on persist failure.
4. **`loadTrustModeFromDb` retry with exponential backoff** (3 attempts: 200ms, 600ms, 1.8s). On transient Supabase errors at boot, this prevents falling back to env-var-default unnecessarily.
5. **Log the full read** at boot: `[trust-mode] DB read result: rowCount=N, value=X, set_by=Y`. Currently only logs the inferred mode; we want the raw row visible for debugging.
6. **Manual one-shot smoke test** in spec acceptance criteria: flip mode to `chat`, force-redeploy Atlas, verify `GET /atlas/mode` returns `chat` not `passive`.

### Part B — Git mutex (Bug E + F)

1. **Single-process file-lock helper at `atlas/src/lib/git-mutex.ts`.** Wraps any git operation in an in-memory mutex (since all Atlas code runs in the same Node process):
   ```typescript
   let lockChain: Promise<unknown> = Promise.resolve()

   export function withGitLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
     const next = lockChain.then(async () => {
       console.log(`[git-mutex] acquiring for ${label}`)
       const start = Date.now()
       try {
         const result = await fn()
         console.log(`[git-mutex] released ${label} after ${Date.now() - start}ms`)
         return result
       } catch (err) {
         console.error(`[git-mutex] released ${label} after error:`, err)
         throw err
       }
     })
     // chain even on rejection so subsequent calls don't all reject
     lockChain = next.catch(() => undefined)
     return next as Promise<T>
   }
   ```
2. **Wrap every git op in `atlas/src/lib/tools.ts`** with `withGitLock`:
   - `gitCommitAndPush` → wrap entire function
   - `builderListQueue` → wrap the `git fetch + reset` block
   - Any other git invocation in tools.ts
3. **Wrap `atlas/src/cron/conductor.ts` git ops** the same way:
   - `getRecentUiCommits` (calls `git log` and `git show`)
4. **Wrap `atlas/src/cron/snapshot.ts`** if it does git ops — verify by reading it first.
5. **Stale-lock recovery** — at every Atlas boot, run `rm -f /workspace/cropsintel-v3/.git/index.lock` once before starting cron. Defensive cleanup in case a previous container died mid-git-op.

## Files

- `atlas/src/lib/trust-mode.ts` (extend per Part A 3-5)
- `atlas/src/lib/git-mutex.ts` (NEW)
- `atlas/src/lib/tools.ts` (extend — wrap git ops)
- `atlas/src/cron/conductor.ts` (extend — wrap git ops)
- `atlas/src/cron/snapshot.ts` (extend if has git ops)
- `atlas/entrypoint.sh` or boot script (add `rm -f .git/index.lock` before cron start)
- `atlas/src/server.ts` (extend — `/atlas/mode` POST returns 500 on persist failure)
- `supabase/migrations/20260501110000_atlas_config_table.sql` (NEW — only if `atlas_config` was missing)

## Success criteria

- `npm run build` passes in `atlas/`
- After ship + Atlas redeploy: `curl /atlas/mode` shows the persisted mode, not env-var-default
- Force-redeploy Atlas, immediately re-check `curl /atlas/mode` → mode persists across the restart (not reverted to passive)
- `tail -100` of Atlas logs shows ZERO `[atlas-queue-order] git refresh failed: ... index.lock: File exists` messages over a 30-min window
- `tail -100` shows `[git-mutex] acquiring for X / released X after Nms` around every git op
- `/atlas/mode` POST with bad payload returns HTTP 500 with structured error body (not lying-200)

## Risks + mitigations

- **Risk:** Mutex serializes all git ops, slowing Atlas down. **Mitigation:** Most ops are <500ms; total queue depth at peak is 2-3; serialization is fine. Logging shows acquire/release time so we can spot pathological waits.
- **Risk:** Migration on a populated atlas_config breaks existing rows. **Mitigation:** Use `CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING` for any seed data.
- **Risk:** `rm -f .git/index.lock` on boot is destructive if a real git op is mid-flight. **Mitigation:** Container start = no other processes; safe by definition. Document in entrypoint comment.

## NEVER list

- Never make the supabase client use the publishable (anon) key — must be service-role for atlas_config writes.
- Never silently swallow setMode persist errors — caller must know if mode didn't persist.
- Never skip the lock on a "fast" git op — even fast ops can race.
