---
priority: 1
model: claude-opus-4-7
primary-domain: mixed
source: claude-code-build-prompt-2026-05-07
---

# Task: phase-1.10af-workflow-quality-gates-fix — bundle the 7 quality-gate bugs that block trustworthy autonomous shipping

**Master plan reference:** §11.2 Phase 1.10 (Atlas / Verifier / Designer hardening); foundation for WP-1+ in `.agent/specs/claude-code-build-prompt-2026-05-07.md`
**V3-CODING-INSTRUCTIONS reference:** §0 (the five immutable rules); §4 (verification before commit)
**Source plan:** `AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md` §4 — bundle of 7 fixes (D, B, C, G, E+F, H, I)
**Estimated effort:** ~150 min Builder time (this spec executes 7 sub-fixes in one pass)

---

## Goal

The autonomous build loop ships specs but the quality gates — Atlas trust-mode persistence, Designer audit, Verifier audit, the git serialization between cron jobs — are broken in seven specific ways. Every spec since 1.10s shipped without a real Verifier audit because Verifier was busy doing a 30-minute boot-time retro-audit. Designer no-ops every audit because of a missing DB table + stale clone. Atlas reverts to passive mode on every redeploy because the DB upsert silently failed. Atlas's own `git fetch + reset` cron passes race each other for the index.lock.

This spec bundles all 7 fixes into one ship so Builder + Verifier + Designer + Atlas converge on a coherent contract. After this lands, WP-0's acceptance criteria pass, and we can flip Atlas to `confirm` mode, then `auto`, with confidence the gates are honest.

## In scope

### §1 Atlas trust-mode persistence (Bug D)

- `atlas/src/lib/trust-mode.ts` — read the current `loadTrustModeFromDb` and `setMode` implementations.
- `setMode(mode, setBy)`:
  - Must do an UPSERT into `atlas_config`: `INSERT INTO atlas_config (key, value, updated_at) VALUES ('trust_mode', jsonb_build_object('mode', $1, 'set_by', $2), now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.
  - Surface insert errors via thrown Error AND `console.error` — no silent no-op. The caller (`POST /atlas/mode` route) returns 500 on failure.
  - Log the success path: `[trust-mode] persisted mode=${mode} setBy=${setBy} to atlas_config`.
- `loadTrustModeFromDb()`:
  - SELECTs `value` from `atlas_config WHERE key='trust_mode'`. If row exists, parse `value.mode`. If absent, fall through to `process.env.ATLAS_TRUST_MODE ?? 'passive'`.
  - Log which path took: `[trust-mode] loaded mode=${mode} from db` or `[trust-mode] no DB override; using env default: ${envMode}`.
- `supabase/migrations/<ts>_atlas_config.sql` — if `atlas_config` table doesn't already exist, create it: `(key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())` with RLS service-role-only.
- Test: `POST /atlas/mode` with `{mode:"chat", setBy:"wp0-test"}`, verify the `atlas_config` row has `value->>'mode' = 'chat'`. Force a Railway redeploy of Atlas. Verify `GET /atlas/mode` still returns `chat`, NOT reverted to `passive`.

### §2 Designer `designer_runs` migration (Bug B)

- Inspect `supabase/migrations/` for any existing `designer_runs` migration. If absent, write `supabase/migrations/<ts>_designer_runs.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS public.designer_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id text NOT NULL,
    operation text NOT NULL CHECK (operation IN ('review-spec', 'audit-commit')),
    head_after text,
    verdict text NOT NULL CHECK (verdict IN ('pass', 'fail', 'warn', 'unknown')),
    confidence numeric,
    gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
    claude_review jsonb,
    gpt_review jsonb,
    cost_usd numeric,
    duration_ms integer,
    screenshot_url text,
    audited_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS designer_runs_task_id_idx ON public.designer_runs (task_id);
  CREATE INDEX IF NOT EXISTS designer_runs_created_at_idx ON public.designer_runs (created_at DESC);
  ALTER TABLE public.designer_runs ENABLE ROW LEVEL SECURITY;
  -- Service-role writes; no public reads.
  CREATE POLICY designer_runs_service_role_all ON public.designer_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  ```
- `agent/agent-loop.sh` (Builder loop) — before each Verifier+Designer audit cycle, if `npx supabase migration list --linked --password "$SUPABASE_DB_PASSWORD"` shows pending migrations, run `npx supabase db push --linked --password "$SUPABASE_DB_PASSWORD" --include-all` so the migration is applied automatically. Best-effort; failure logs but does not block the audit.
- Test: after spec ships, `psql $DATABASE_URL -c "\d designer_runs"` returns the table definition (not an error). Designer's `audit-commit` and `review-spec` endpoints insert rows successfully.

### §3 Designer git fetch-before-audit (Bug C)

- `designer/src/server.ts` — find the `/designer/audit-commit` handler. Before computing the diff:
  - `git fetch origin` (with timeout 30s)
  - `git checkout <head_after>` (or `git reset --hard <head_after>` if checkout fails)
  - Log: `[designer] synced workspace to ${head_after}`.
- Wrap the git ops in a per-request mutex so two concurrent `audit-commit` requests don't fight over the workspace. Pattern: import a shared `Mutex` (or implement a tiny one with a `Promise` chain).
- The same handler must also handle `review-spec` calls (those don't need git ops since they take spec markdown directly — leave that path unchanged).
- Test: queue two simultaneous `audit-commit` requests with different `head_after`. Both succeed without `fatal: Invalid revision range` or `falling back to working tree`.

### §4 Verifier disable boot retro-audit (Bug G)

- `verifier/src/index.ts` (or `verifier/src/server.ts` — wherever the boot sequence runs) — find the `audit-all` invocation that fires on container start.
- Gate it behind `process.env.VERIFIER_RETRO_AUDIT_ON_BOOT === 'true'`. Default off. Log on boot: `[verifier] retro-audit on boot: ${enabled ? 'enabled' : 'disabled (default)'}`.
- The on-demand `POST /audit` endpoint must work immediately on boot — no blocking on retro-audit. Verify by hitting `/audit` within 5s of container start (a unit test or integration test).
- Test: cold-start Verifier locally (`cd verifier && npm run dev`). Within 10 seconds of boot, hit `POST /audit` with a small task — must return a verdict, not block waiting on retro-audit.

### §5 Atlas git mutex audit (Bugs E + F)

- `atlas/src/lib/git-mutex.ts` already exists. Audit it:
  - The `withGitLock(label, fn)` helper must serialize ALL git operations process-wide.
  - Verify it uses a single shared lock (not per-call): the mutex state lives in module scope.
- Audit every `git fetch`, `git reset`, `git checkout`, `git log`, `git diff`, `git pull`, `git push`, `git rev-parse`, `git add`, `git commit` in:
  - `atlas/src/lib/tools.ts`
  - `atlas/src/lib/plan-server.ts`
  - `atlas/src/cron/conductor.ts`
  - `atlas/src/cron/snapshot.ts` (if present)
  - All other `atlas/src/cron/*.ts` files
  - `atlas/src/lib/build-attempts.ts` (if it touches git)
- Every git op MUST be wrapped via `withGitLock`. Add unit test: `atlas/src/lib/__tests__/git-mutex.test.ts` (or `.spec.ts` matching project convention) that:
  - Spawns 5 concurrent `withGitLock('test', () => execFileP('git', ['rev-parse', 'HEAD'], {cwd}))` calls
  - Asserts they serialize (each completes after the previous releases the lock)
  - Asserts none throw with `Unable to create '.git/index.lock'`
- Run the test: `cd atlas && npx vitest run src/lib/__tests__/git-mutex.test.ts`. Must pass.

### §6 Verifier stub-detector whitelist (Bug H)

- Find the stub-detector regex in `verifier/src/checks/stub-detector.ts` (or wherever the `<NotImplemented[\s/]` pattern check lives).
- Whitelist the following as legitimate placeholders (NOT stubs):
  - `<NotImplemented />` — closing tag form
  - `<NotImplemented\s+phase=` — props form (e.g. `<NotImplemented phase="1.5" />`)
  - `<NotImplemented[\s/]` general — must allow when used as a JSX component
  - `placeholder phase=` — text-pattern variant
- Pattern: in the stub-detector, if the surrounding context indicates a JSX component usage (look for `import.*NotImplemented` in the file, or surrounding `<` and `>`), do NOT report as a stub.
- Add a unit test in `verifier/src/checks/__tests__/stub-detector.test.ts` that:
  - Asserts a file containing `<NotImplemented phase="1.5" />` is reported as 0 stubs (legitimate placeholder)
  - Asserts a file containing `// TODO: implement` IS reported as a stub (regression guard — don't over-broaden the whitelist)
  - Asserts a file with `function foo() { throw new Error('not implemented') }` IS reported as a stub
- Test: `cd verifier && npx vitest run src/checks/__tests__/stub-detector.test.ts`. Must pass.

### §7 Verifier context loader (Bug I)

- Find the audit context-loading code in `verifier/src/lib/context-loader.ts` (or equivalent — search for where `verifier/src` reads task source files into the audit prompt).
- Behavior change: when assembling the audit prompt:
  - Prioritize loading whole files for any file ≤ 2,000 lines.
  - Compute total context size before truncating. Truncate ONLY if total context would exceed model limit (use 180_000 chars as a safe ceiling for claude-opus-4-7 at 200k tokens).
  - When truncating, log explicitly: `[verifier-context] truncated ${path} (${origLines} → ${keptLines} lines) to fit model context`.
- Add a unit test asserting:
  - A 1,800-line file is loaded whole, no truncation log.
  - A 5,000-line file in a context that's already near 180k chars IS truncated, with the explicit log.
- Test: `cd verifier && npx vitest run src/lib/__tests__/context-loader.test.ts`. Must pass.

### §8 RUN_AFTER_SHIP.md — manual end-to-end verification protocol

Write `RUN_AFTER_SHIP.md` at the repo root, documenting the 5-step manual test from `AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md` §5 Step C:

```markdown
# RUN_AFTER_SHIP — phase-1.10af workflow quality gates

After this spec ships and Railway redeploys all services, run these 5 steps
in order to verify the loop is healthy. Stop and report if any fails.

1. **Service health (all 6 must return 200):**
   ```bash
   for s in courteous-simplicity zucchini-friendship believable-warmth just-reflection cooperative-rejoicing rare-happiness; do
     curl -s -o /dev/null -w "$s: %{http_code}\n" https://$s-production.up.railway.app/health
   done
   ```

2. **Designer review-spec returns a real verdict (not 401):**
   ```bash
   curl -sX POST https://zucchini-friendship-production-392d.up.railway.app/designer/review-spec \
     -H "Authorization: Bearer cropsintel-designer-token-2026-05-01" \
     -H "Content-Type: application/json" \
     -d '{"task_id":"test-fix","spec_markdown":"# Test"}' | jq .verdict
   ```
   Expect: `"approved"` / `"rejected"` / `"warn"`. NOT 401.

3. **Atlas trust mode survives redeploy:**
   ```bash
   curl -sX POST https://courteous-simplicity-production.up.railway.app/atlas/mode \
     -H "Authorization: Bearer cropsintel-atlas-token-2026-04-30" \
     -H "Content-Type: application/json" -d '{"mode":"chat","setBy":"wp0-test"}'
   # Force a Railway redeploy of atlas-conductor (or just wait through the next Railway maintenance window).
   sleep 90
   curl -s https://courteous-simplicity-production.up.railway.app/atlas/mode | jq .mode
   ```
   Expect: `"chat"`. NOT `"passive"`.

4. **Verifier returns real verdict (not 'unknown'):**
   - Queue a tiny test spec (`echo "# Test\n\nMinimal change." > .agent/tasks/queued/phase-test-verdict.md && git add . && git commit -m "test: verifier verdict" && git push`).
   - Wait 5 min for Builder to ship.
   - Query: `psql $DATABASE_URL -c "SELECT verdict FROM verifier_runs ORDER BY created_at DESC LIMIT 1;"`
   - Expect: `pass` or `fail`, NOT `unknown`.

5. **No git lock errors in Atlas logs:**
   - On Railway dashboard, open Atlas service → Logs → last 30 min.
   - Search for `Unable to create '.git/index.lock'`.
   - Expect: zero entries.

If all five pass, WP-0 is done. Promote Atlas to `confirm` (then later, `auto`) per `claude-code-build-prompt-2026-05-07.md` §0.
```

## Out of scope

- Atlas's confirm/auto promotion flow (manual step, the user does it after this spec passes).
- The 47 retroactive Verifier failures from the boot retro-audit (those specs already shipped; we move forward, not backward — see `AUTONOMOUS_BUILD_WORKFLOW_FIX_PLAN.md` §7).
- Council /health endpoint (cosmetic; Council serves its real endpoints fine).
- Adela's `notify-whatsapp.sh` path (has working fallback; address when 1.6 ships).
- Anthropic API key replacement on Designer (manual step the user did via Railway dashboard before this spec was written — Step A in the fix plan).

## Acceptance criteria

1. §1 — `atlas_config` table exists. `setMode` UPSERTs successfully. `loadTrustModeFromDb` reads from DB before falling back to env. After a Railway redeploy, the persisted mode survives. Logs on both paths show which was taken.
2. §2 — `designer_runs` table exists in V3 Supabase. Designer service can write to it (manual `curl` to `/designer/review-spec` produces a row). Builder loop applies pending migrations before audit cycles.
3. §3 — Designer's `audit-commit` handler does `git fetch + checkout <head_after>` before computing the diff. Concurrent audits serialize via mutex. Logs no longer say "falling back to working tree".
4. §4 — Verifier boot does NOT run `audit-all` by default. `VERIFIER_RETRO_AUDIT_ON_BOOT=true` opts back in. On-demand `/audit` works within 10s of cold-start.
5. §5 — Every git op in `atlas/src/lib/{tools,plan-server}.ts` and `atlas/src/cron/*.ts` is wrapped via `withGitLock`. Unit test `git-mutex.test.ts` passes (5 concurrent ops serialize, none lock-error).
6. §6 — Stub-detector treats `<NotImplemented />` and `<NotImplemented phase="…" />` as legitimate placeholders. Unit test `stub-detector.test.ts` passes (3 cases: NotImplemented OK, TODO flagged, throw-not-implemented flagged).
7. §7 — Verifier loads files ≤ 2000 lines whole. Truncates only when total context approaches 180k chars; logs explicitly. Unit test `context-loader.test.ts` passes (1.8k whole, 5k truncated).
8. §8 — `RUN_AFTER_SHIP.md` exists at repo root with the 5-step protocol verbatim from the spec.
9. `npm run build` passes (project root).
10. `cd atlas && npm run build` passes (Atlas service).
11. `cd verifier && npm run build` passes (Verifier service).
12. `cd designer && npm run build` passes (Designer service).
13. All Verifier unit tests pass: `cd verifier && npx vitest run`.
14. All Atlas unit tests pass: `cd atlas && npx vitest run`.
15. Conventional commits, one per section (so we can revert any single fix in isolation if needed): `fix(atlas): trust mode persistence (1.10af §1)`, `fix(designer): designer_runs migration (1.10af §2)`, etc.

## Foundation check (do this BEFORE starting)

Before implementing, verify these exist:
- ✅ `atlas/src/lib/git-mutex.ts` already exports `withGitLock(label, fn)` — confirm and reuse.
- ✅ `atlas/src/lib/trust-mode.ts` already has `loadTrustModeFromDb` + `setMode` — confirm shape, harden inside.
- ✅ `verifier/src/checks/stub-detector.ts` exists (or equivalent location) — find before patching.
- ✅ Supabase project link works: `npx supabase migration list --linked` returns a list (NOT an auth error). If link is missing, run `npx supabase link --project-ref hzrnohsxigrqlmzegwlb` first.

If any are missing, STOP and write `.agent/questions/2026-05-07-1.10af-foundation-gap.md` describing the gap with three options (skip / patch around / new spec).

## Suggested order

1. §5 Atlas git mutex audit FIRST — many of the other sections will trigger Builder cron passes that race the audit; better to land mutex coverage before doing more git ops.
2. §1 Atlas trust-mode persistence — independent of others, validates Atlas-side persistence path.
3. §2 Designer migration — small, gates §3.
4. §3 Designer git fetch-before-audit — depends on §2 (the migration must apply before Designer can write rows).
5. §4 Verifier retro-audit gate — independent.
6. §6 Stub-detector whitelist — independent, small.
7. §7 Verifier context loader — independent.
8. §8 RUN_AFTER_SHIP.md — last, captures the verification recipe.

## Notes

- Each section commits separately. If a single section fails verification post-ship, we can revert it without losing the others.
- The Verifier retro-audit gate (§4) is cost-saving: each boot retro-audit was burning $5-10 in AI calls. After this ships, the savings are immediate.
- Bug A (Designer Anthropic API key) is NOT in this spec — that was a manual Railway-dashboard fix the user did before queueing this spec. If the key is still bad post-ship, §3's tests will surface it; report and stop.
- Atlas's git mutex (§5) audit may find ops already wrapped (recent commits like 1.10aa added a lot of `withGitLock` coverage). If so, the work for §5 is mostly verification + the unit test — fewer code changes than expected.

## Risks + mitigations

- **Risk:** §1's `atlas_config` migration may already exist from 1.10y. **Mitigation:** check first; if it exists, just verify the schema matches and only patch the upsert logic in `trust-mode.ts`.
- **Risk:** §4's `VERIFIER_RETRO_AUDIT_ON_BOOT` default-off means newly-promoted-to-`auto` Verifier won't catch latent issues in old specs. **Mitigation:** the user can set the env var to `true` for a single boot if they want a one-time retro-audit; default-off prevents it from re-running on every redeploy.
- **Risk:** §5's mutex test may flake on slower CI. **Mitigation:** use `Promise.all` with explicit awaits, not race timing assertions; the test asserts serialization by a counter, not by elapsed time.
- **Risk:** §7's 180k-char ceiling may be too aggressive for some specs. **Mitigation:** logging makes this observable; if real specs hit truncation, raise the ceiling in a follow-up.

## NEVER list (required)

- NEVER auto-flip Atlas to `auto` mode as part of this spec — that's the user's decision after acceptance.
- NEVER backfill the 47 retro-audit failures (out-of-scope, see §7 of the source plan).
- NEVER store AI provider keys in `VITE_*` env vars (Rule 4 — they live in service env vars on Railway / Supabase secrets only).
- NEVER fabricate test pass results — if a unit test fails, fix the underlying bug or report it. Do not skip the test.

## Done conditions (required)

All 15 acceptance criteria above met, all four `npm run build` runs green, all unit tests passing, commit messages reference `1.10af` per the conventional-commits convention. `RUN_AFTER_SHIP.md` exists at repo root.

## Files to change (required)

- `atlas/src/lib/trust-mode.ts` — harden setMode + loadTrustModeFromDb
- `supabase/migrations/<ts>_atlas_config.sql` — new (if absent)
- `supabase/migrations/<ts>_designer_runs.sql` — new
- `agent/agent-loop.sh` — pre-audit migration push
- `designer/src/server.ts` — git fetch-before-audit + mutex
- `verifier/src/index.ts` (or wherever boot lives) — gate retro-audit
- `verifier/src/checks/stub-detector.ts` — whitelist NotImplemented
- `verifier/src/checks/__tests__/stub-detector.test.ts` — new
- `verifier/src/lib/context-loader.ts` (or equivalent) — whole-file priority
- `verifier/src/lib/__tests__/context-loader.test.ts` — new
- `atlas/src/lib/git-mutex.ts` — audit (likely no changes)
- `atlas/src/lib/__tests__/git-mutex.test.ts` — new
- `atlas/src/lib/tools.ts` — verify all git ops wrapped
- `atlas/src/lib/plan-server.ts` — verify all git ops wrapped
- `atlas/src/cron/*.ts` — verify all git ops wrapped
- `RUN_AFTER_SHIP.md` — new (at repo root)

---

**Done condition:** all acceptance criteria met, builds green, tests pass, commit messages reference `1.10af`. `RUN_AFTER_SHIP.md` documents the manual verification recipe.
