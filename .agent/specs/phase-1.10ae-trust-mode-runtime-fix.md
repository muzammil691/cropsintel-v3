---
phase: 1.10ae
title: Trust-mode runtime persistence — verify and re-fix
status: planned
gate: in-progress count <= 2
order: 1-of-4
estimated_builder_minutes: 60
estimated_cost_usd: 2
master_plan_section: 11.7
---

# Phase 1.10ae — Trust-mode runtime persistence (re-fix)

## Why this exists

WP-0 shipped a "fix" for trust-mode persistence on 2026-05-07. Code in `atlas/src/lib/trust-mode.ts` correctly reads from and writes to `atlas_config` table. Yet in production, every Atlas refresh reverts mode to `passive`. So the code is right, but something else is wrong.

Three failure modes are possible. This spec investigates each and fixes whichever applies, plus adds a runtime self-check so we never silently regress again.

## Foundation-first check

- ✅ `atlas/src/lib/trust-mode.ts` exists, correctly reads/writes `atlas_config`.
- ✅ Trust-mode is imported by `atlas/src/server.ts`.
- ❓ `atlas_config` table existence in Supabase prod project `hzrnohsxigrqlmzegwlb` — UNVERIFIED. This may be the bug.
- ❓ Migration that creates `atlas_config` — UNKNOWN whether it ran on Supabase prod.

## Diagnostic step (Builder runs FIRST before fixing anything)

Builder must execute these checks in order and document findings in `docs/atlas-decisions/2026-MM-DD-trust-mode-runtime-investigation.md`:

1. **Check Supabase prod for `atlas_config` table.** Run `psql "$SUPABASE_DB_URL" -c "\d atlas_config"` (using the service-role connection string from Railway env). Document: does the table exist? Does it have columns `key text PRIMARY KEY, value jsonb, updated_at timestamptz default now()`?

2. **Check migrations folder.** `ls supabase/migrations/ | grep -i atlas_config`. Document: is there a migration that creates the table? Has it been applied to prod?

3. **Test the UPSERT directly.** Run `psql "$SUPABASE_DB_URL" -c "INSERT INTO atlas_config (key, value) VALUES ('trust_mode_test', '\"chat\"') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now() RETURNING *;"`. Document: does it succeed? If yes, delete the test row.

4. **Read the boot sequence.** Inspect `atlas/src/server.ts` startup. Is `loadTrustModeFromDb()` called before the HTTP server starts accepting connections? Is its result awaited? Document the call site.

5. **Inspect the dashboard mode-toggle.** Read `src/components/atlas/AtlasHeader.tsx` (or wherever the mode badge lives). When user clicks "Auto," does it call `POST /atlas/mode` and wait for the response before updating the UI badge? Or does it optimistically update UI then fire-and-forget the API call?

## Fix branches based on findings

### Branch A: `atlas_config` table missing in prod

Write a migration `supabase/migrations/<ts>_atlas_config.sql`:

```sql
create table if not exists public.atlas_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists atlas_config_updated_at_idx on public.atlas_config (updated_at desc);

-- RLS: only service role can read/write. No public access.
alter table public.atlas_config enable row level security;
```

Apply via `npx supabase db push`. Verify the table exists post-push.

### Branch B: Table exists but UPSERT fails silently

Audit `atlas/src/lib/trust-mode.ts` line 81. The current UPSERT swallows errors with `if (error)` then logs but doesn't surface. Change to: if UPSERT fails, throw an error that propagates to the API response. The dashboard's "Auto" button must show a red banner on failure, not silently succeed. Acceptance: trying to switch mode when `atlas_config` is read-only must return HTTP 500 + visible error to the user.

### Branch C: Boot sequence calls `loadTrustModeFromDb` AFTER HTTP listen

If diagnostic step 4 shows the load is fire-and-forget or after `app.listen()`, fix: `await loadTrustModeFromDb()` must complete before `app.listen()`. Add a startup log line confirming what mode was loaded from DB and from which source (DB row vs. env fallback).

### Branch D: Dashboard optimistic UI overrides DB state on every page refresh

If diagnostic step 5 shows the UI shows mode from local component state rather than the API, fix: the mode badge must read from `GET /atlas/mode` on every mount. Cache for 5 seconds max. On the toggle click, call `POST /atlas/mode`, await the response, then update UI from the response payload (not from optimistic local state).

## Runtime self-check (REQUIRED regardless of which branch fires)

Add to `atlas/src/server.ts` boot sequence, BEFORE `app.listen()`:

```typescript
async function verifyTrustModePersistence() {
  const sb = supabase()
  // Test write
  const testKey = `_trust_mode_self_check_${Date.now()}`
  const { error: writeErr } = await sb.from('atlas_config').upsert({
    key: testKey,
    value: 'check'
  })
  if (writeErr) throw new Error(`atlas_config write failed: ${writeErr.message}`)
  // Test read
  const { data, error: readErr } = await sb.from('atlas_config').select('*').eq('key', testKey).single()
  if (readErr || !data) throw new Error(`atlas_config read failed: ${readErr?.message ?? 'no row'}`)
  // Cleanup
  await sb.from('atlas_config').delete().eq('key', testKey)
  console.log('[boot] trust-mode persistence self-check: ok')
}

// In main():
try {
  await verifyTrustModePersistence()
} catch (e) {
  console.error('[boot] FATAL: trust-mode persistence broken:', e)
  // Do NOT exit — let Atlas run in degraded mode but log loudly every minute
  setInterval(() => console.error('[boot] trust-mode degraded — atlas_config not writable'), 60000)
}
```

This means future deploys fail loudly if the table is missing or RLS broke.

## Acceptance criteria

- Diagnostic doc exists in `docs/atlas-decisions/`.
- `atlas_config` table confirmed present and writable in prod via `psql` or Supabase Studio.
- Setting mode to `auto` via dashboard → refresh page → mode is still `auto`. Verify 3 times in a row.
- Setting mode via direct API call → `curl GET /atlas/mode` returns the new mode.
- Trigger a Railway redeploy of Atlas → wait 90s → `curl GET /atlas/mode` returns the previously-set mode (not env-default).
- Boot logs show `[boot] trust-mode persistence self-check: ok`.
- `npm run build` passes.
- No new e2e test needed (trust-mode is admin-only system behavior).

## Out of scope

- Changing the mode state machine itself (passive → chat → confirm → auto → stopped).
- WhatsApp slash-command for mode change (separate spec).
- Mode change audit log (already exists).

## Dependencies

None. This must ship FIRST of the four runtime-truth specs, because the dashboard truth fixes (1.10af) need a stable mode-API to test against.
