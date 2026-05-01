---
priority: 1
depends-on: []
---

# Task: Phase 1.10ag — Designer fixes (designer_runs migration + clone sync)

**Master plan reference:** AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md §3 items 3, 5 (priority CRITICAL + HIGH).
**Context:** Designer service has two bugs surfaced by 2026-05-01 log audit:

**Bug B — `designer_runs` table missing in V3 Supabase.** Logs:
```
[designer] Failed to write audit log: Could not find the table 'public.designer_runs' in the schema cache
```
The 1.10n spec described the migration but it was never applied. Every audit call succeeds against ElevenLabs/Anthropic but fails silently on log persistence — no audit trail.

**Bug C — Designer's local repo clone is stale.** When Builder pushes a commit and immediately POSTs to `/designer/audit-commit` with `head_before..head_after`, Designer's container hasn't pulled yet:
```
[designer-server] audit-commit phase-1.10z-... (e662f60..dacd1aba)
fatal: Invalid revision range e662f60..dacd1aba
[designer] git diff failed → falling back to working tree
```
Designer falls back to "working tree" diff which doesn't represent what Builder actually changed. Audits run on stale code; Designer can't catch real defects in the new commit.

**Estimated effort:** ~40 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Ship designer_runs migration (Bug B)

1. **Verify whether the migration file exists.** Look in `supabase/migrations/` for any `*designer_runs*` file. The 1.10n spec mentioned it but Builder may have written the spec without committing the migration. Most likely: migration content is inline in the spec doc but no actual `.sql` file exists.
2. **If missing, write `supabase/migrations/20260501120000_designer_runs.sql`:**
   ```sql
   CREATE TABLE IF NOT EXISTS public.designer_runs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     task_id text NOT NULL,
     operation text NOT NULL,        -- 'review-spec' | 'audit-commit'
     verdict text NOT NULL,           -- 'pass' | 'fail' | 'unknown'
     confidence numeric(3,2),         -- 0.00 to 1.00
     gaps jsonb DEFAULT '[]'::jsonb,
     ai_judgment jsonb DEFAULT '{}'::jsonb,
     cost_usd numeric(10,4) DEFAULT 0,
     duration_ms int,
     head_before text,
     head_after text,
     screenshot_url text,
     created_at timestamptz NOT NULL DEFAULT now()
   );

   ALTER TABLE public.designer_runs ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "designer_runs_service_role_write"
     ON public.designer_runs FOR ALL
     USING (auth.role() = 'service_role')
     WITH CHECK (auth.role() = 'service_role');

   CREATE POLICY "designer_runs_admin_team_read"
     ON public.designer_runs FOR SELECT
     USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team') OR auth.role() = 'service_role');

   CREATE INDEX IF NOT EXISTS idx_designer_runs_task ON public.designer_runs (task_id, created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_designer_runs_verdict ON public.designer_runs (verdict, created_at DESC);
   ```
3. **Apply the migration to V3 Supabase.** Builder must run `npx supabase db push` (already in agent loop) and verify success. Log line `[builder] migration 20260501100000 applied` should appear.
4. **Designer must use service-role key.** Read `designer/src/lib/supabase.ts` (or equivalent) and confirm it uses `SUPABASE_SECRET_KEY` (the env var I just standardized) so RLS write policy allows inserts. If it's using publishable/anon, fix.

### Part B — Clone sync before each audit (Bug C)

1. **Modify `designer/src/server.ts`'s `audit-commit` handler** to ALWAYS run `git fetch origin main && git checkout <head_after>` before computing the diff. Use the new git-mutex pattern from 1.10af (`atlas/src/lib/git-mutex.ts`) — port the helper into `designer/src/lib/git-mutex.ts` (same code, different package).
2. **Sequence:**
   ```
   1. POST /designer/audit-commit { task_id, head_before, head_after }
   2. withGitLock('audit-commit', async () => {
        await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
        await execFileP('git', ['checkout', head_after], { cwd: REPO_ROOT })
        const { stdout: diff } = await execFileP('git', ['diff', head_before, head_after, '--name-only'], { cwd: REPO_ROOT })
        // proceed with audit using actual diff
      })
   3. After audit: git checkout main (return to default branch state)
   ```
3. **Idempotency:** if `head_after` is already the local HEAD, skip fetch (saves ~2s). Check via `git rev-parse HEAD`.
4. **Failure mode:** if fetch fails (network/auth), log loudly and return `verdict: unknown` with `error: 'fetch failed: <reason>'` — don't silently fall back to working-tree diff (current bug).

### Part C — Same-pattern fix for `review-spec` if needed

The `review-spec` endpoint reads the spec markdown directly from request body, not from git, so it's unaffected. But verify by reading `designer/src/server.ts`. If review-spec also touches git, apply the same fix.

## Files

- `supabase/migrations/20260501120000_designer_runs.sql` (NEW)
- `designer/src/server.ts` (extend — add fetch+checkout in audit-commit handler)
- `designer/src/lib/git-mutex.ts` (NEW — port from atlas/src/lib/git-mutex.ts)
- `designer/src/lib/supabase.ts` (verify service-role key usage; fix if wrong)
- `designer/src/lib/audit.ts` if exists (verify writes go to designer_runs and use service-role)

## Success criteria

- `npx supabase db push` from Builder applies the new migration cleanly. Verify by running `select count(*) from public.designer_runs` in Supabase SQL editor — query returns 0 rows but DOESN'T error with "table does not exist".
- After fix ships, next UI commit triggers Designer audit, audit succeeds, log line `[designer] audit row written id=<uuid>` appears, AND querying `select * from designer_runs order by created_at desc limit 1` shows the audit.
- Logs for `audit-commit` show `git fetch ok / git checkout <sha> ok / diff returned N files` instead of `Invalid revision range`.
- Logs do NOT show `falling back to working tree` for any post-fix audit.
- Designer service doesn't crash if Supabase is briefly unavailable (logs error, returns verdict, retries write next call).

## Risks + mitigations

- **Risk:** `git checkout <sha>` puts the repo in detached-HEAD state, then next audit fetches but is on a detached HEAD. **Mitigation:** Always `git checkout main` after the diff is computed; comment in code explains.
- **Risk:** RLS policy blocks Designer's writes if service-role key isn't configured. **Mitigation:** I just standardized SUPABASE_SECRET_KEY in the env-var blocks — Designer now has it. The supabase.ts client must read from this var.
- **Risk:** Migration name collision with another spec's migration filename. **Mitigation:** date-prefixed `20260501100000_` is unique to this spec; verify no conflict in `supabase/migrations/` before adding.

## NEVER list

- Never let Designer fall back silently to working-tree diff when git refs are bad — that hid this bug for hours. Always surface the failure as `verdict: unknown` with the explicit reason.
- Never log the Anthropic API key value (the 401 we just fixed had the failed key in a redacted form, but be careful in error formatting).
- Never write to designer_runs from anywhere except the designer service itself — single source of truth.
