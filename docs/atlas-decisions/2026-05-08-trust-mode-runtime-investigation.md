# Trust-mode runtime persistence — investigation (Phase 1.10ae)

Date: 2026-05-08
Investigator: CropsIntel V3 autonomous agent
Spec: `.agent/tasks/in-progress/phase-1.10ae-trust-mode-runtime-fix.md`

## TL;DR

At investigation time the chain is healthy: `atlas_config.trust_mode` row exists in
prod, the running Atlas service reports the same mode in `/health`, direct UPSERTs
succeed against the prod REST API, and the boot sequence already awaits
`loadTrustModeFromDb()` before `server.listen()`. None of the four fix-branches
(A/B/C/D) needed to fire. The runtime self-check from the spec was added anyway —
it is a permanent boot-time guard so the next regression fails loudly instead of
silently reverting users to `passive`.

## Diagnostic step results

### 1. Does `atlas_config` exist in Supabase prod (project `hzrnohsxigrqlmzegwlb`)?

YES. Direct outbound `psql` to the pooler is blocked from this Railway VPS
(`Tenant or user not found` / `ENOTFOUND` on every region), so verification was
performed via PostgREST using the service-role key:

```
GET ${V3_SUPABASE_URL}/rest/v1/atlas_config?select=key,value,set_by,updated_at&limit=20
→ [{"key":"trust_mode","value":"auto","set_by":"web-ui","updated_at":"2026-05-08T12:04:28.294+00:00"}]
```

Schema (per `supabase/migrations/20260430000001_atlas_config.sql` and
`20260501040000_atlas_config_rls_check.sql`):

| column      | type                | nullable | default |
|-------------|---------------------|----------|---------|
| key         | text PRIMARY KEY    | no       | —       |
| value       | text                | no       | —       |
| set_by      | text                | yes      | —       |
| updated_at  | timestamptz         | no       | now()   |

**Note:** the spec's expected schema mentions `value jsonb`. The actual schema
uses `value text` and the runtime code (`atlas/src/lib/trust-mode.ts`) writes a
plain mode string ("auto", "chat", …). This is intentional: `trust_mode` is a
single enum-ish string, not a JSON object. No schema change was made.

RLS is enabled. Policies in place:
- `Anyone can read config` — `FOR SELECT USING (true)`
- `service_role can insert config` — `FOR INSERT TO service_role WITH CHECK (true)`
- `service_role can update config` — `FOR UPDATE TO service_role USING (true) WITH CHECK (true)`

Service role bypasses RLS, but the explicit policies are the belt-and-braces
fix from Phase 1.10y.

### 2. Migrations folder

Two migrations create / re-assert the table:

- `20260430000001_atlas_config.sql` — original create (Phase 1.10j).
- `20260501040000_atlas_config_rls_check.sql` — idempotent re-check + service_role
  write policies (Phase 1.10y).

Both have run on prod (the row above proves the table exists with the expected
columns).

### 3. Direct UPSERT test

```
POST ${V3_SUPABASE_URL}/rest/v1/atlas_config
  Prefer: resolution=merge-duplicates,return=representation
  body: {"key":"_trust_mode_self_check_diag","value":"diag","set_by":"diagnostic"}
→ HTTP 201
  [{"key":"_trust_mode_self_check_diag","value":"diag","set_by":"diagnostic","updated_at":"2026-05-08T12:06:02.281563+00:00"}]
```

Cleanup:

```
DELETE ${V3_SUPABASE_URL}/rest/v1/atlas_config?key=eq._trust_mode_self_check_diag
→ HTTP 204
```

The service-role key persists writes correctly. **Branch B does not apply.**

### 4. Boot sequence — is `loadTrustModeFromDb()` awaited before `app.listen()`?

YES. `atlas/src/server.ts`:

- Line 2001: `await loadTrustModeFromDb()` inside `startServer()` immediately
  after `validateEnv()`.
- Line 4388: `server.listen(PORT, …)` at the very end of `startServer()`, after
  CRON loops and WebSocket attachment.

So the DB load completes before the HTTP server accepts connections.
**Branch C does not apply.**

### 5. Dashboard mode-toggle behavior

`src/components/atlas/AtlasHeader.tsx#handleSetTrust` (lines 99–108):

```ts
async function handleSetTrust(mode: TrustMode) {
  setTrustUpdating(true)
  try {
    await setMode(mode)        // POSTs /atlas/mode and awaits the response
    onTrustModeChange(mode)    // only mutates UI state on success
  } finally {
    setTrustUpdating(false)
    setTrustDialogOpen(false)
  }
}
```

The dashboard awaits the API response before updating the badge. After every
status poll (5 s, `useAtlasStatus`), `status.trust_mode` from `/atlas/status`
becomes the source of truth via:

```ts
const trustMode: TrustMode = trustOverride ?? status?.trust_mode ?? 'passive'
```

`trustOverride` is the optimistic local mirror; on page reload it resets to
`undefined` and the badge falls back to `status.trust_mode` (which is the Atlas
server's in-memory mode, hydrated from DB at boot). This is correct.
**Branch D does not apply.**

### Sanity-check on the live service

```
GET https://courteous-simplicity-production.up.railway.app/health
→ {"status":"ok","service":"cropsintel-atlas","version":"0.1.0","trust_mode":"auto",…}
```

Server in-memory `trust_mode` = DB row `trust_mode` = `auto`. The chain is
intact at investigation time.

## Verdict

The trust-mode persistence chain is currently working end-to-end. The spec
acknowledges this is possible — the WP-0 fix from 2026-05-07 (which tightened
error surfacing in `setMode()` and the `/atlas/mode` POST handler) appears to
have resolved the original silent-revert behaviour.

What we cannot confirm from outside the running container is whether
`loadTrustModeFromDb()` is **always** succeeding on cold boot. Transient
boot races (Supabase connection pool not warm yet) would be invisible to a
post-hoc REST check. Phase 1.10af already added 200 ms / 600 ms / 1.8 s retry
backoff for that exact reason.

## Action taken

Per the spec, the **runtime self-check is REQUIRED regardless of which branch
fires**. Added to `atlas/src/server.ts` boot sequence, before `server.listen()`:

- Writes a unique `_trust_mode_self_check_<ts>` key.
- Reads it back.
- Deletes it.
- Logs `[boot] trust-mode persistence self-check: ok` on success.
- On failure: logs `[boot] FATAL: trust-mode persistence broken: …` and
  continues to listen in degraded mode while logging once per minute. We do
  not exit — Atlas can still answer chat with the env-default mode — but the
  loud log makes any future regression obvious in Railway logs.

This means the next deploy that loses the table, RLS access, or service-role
key will fail loudly instead of silently reverting users to `passive`.

## Followups (out of scope here)

- If the boot self-check ever logs FATAL, Phase 1.10af's retry policy plus the
  spec's degraded-mode behaviour should buy time to investigate. A dedicated
  pager hook (Slack / WhatsApp) could be added later.
- The mode-change audit log (`atlas_config_audit` if it exists, otherwise
  `atlas_audit_log`) should already cover who flipped the mode and when —
  not investigated here as it is explicitly out of scope.
