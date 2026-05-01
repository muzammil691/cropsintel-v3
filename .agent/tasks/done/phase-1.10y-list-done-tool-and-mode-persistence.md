# Task: Phase 1.10y — `builder.list_done` tool + Atlas trust-mode persistence fix

**Master plan reference:** Atlas master spec §3 (trust modes), §7 (tools); discovered live 2026-05-01 morning during user verification of Atlas honesty mode (1.10q).
**Context:** Two real bugs found while testing 1.10q in production:

1. **Tool gap** — Atlas has `builder.list_queue` but NO `builder.list_done`. When user asked "what shipped overnight," Atlas got the count from `status.snapshot` (48) and master plan from `memory.search`, but couldn't enumerate WHICH 48 specs shipped. Result: Atlas reported Phase 1.3/1.4/1.5 as "not yet built" when in fact 1.3a-h, 1.4a-d, and 1.5a are all in `done/`. Honesty footer was correctly `verified: yes` for the tools called — the failure was a missing tool to answer the actual question.
2. **Trust mode persistence bug** — `setMode` in `atlas/src/lib/trust-mode.ts:47-62` writes to `atlas_config` table via Supabase upsert wrapped in try/catch. On any DB error (RLS, network, schema), it silently falls back to in-memory-only ("mode change active in-memory only"). When the Atlas service redeploys, in-memory state resets and `loadTrustModeFromDb` finds no row, falling back to `env-var-default = passive`. User flipped to chat 2026-04-30 23:53Z, Atlas redeployed at 09:37Z this morning, mode silently reverted to passive — user's choice was lost.

**Estimated effort:** ~25 min Builder time (small spec, 2 narrow fixes)
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — `builder.list_done` tool

New tool exposed via `atlas/src/lib/tools.ts`:

```typescript
export async function builderListDone(opts?: {
  limit?: number       // default 100
  filter?: string      // optional substring filter on filename, e.g. "phase-1.3"
}): Promise<{ specs: string[]; count: number }> {
  // Refresh repo state first (mirror builderListQueue pattern at lib/tools.ts:92-103)
  try {
    await execFileP('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT })
    await execFileP('git', ['reset', '--hard', 'origin/main'], { cwd: REPO_ROOT })
  } catch (err) {
    console.warn('[atlas-list-done] git refresh failed:', err)
  }
  const dir = resolve(REPO_ROOT, '.agent/tasks/done')
  const files = (await readdir(dir)).filter(f => f.endsWith('.md') && f !== '_template.md')
  let filtered = files
  if (opts?.filter) {
    filtered = files.filter(f => f.includes(opts.filter!))
  }
  filtered.sort()
  const limit = opts?.limit ?? 100
  return { specs: filtered.slice(0, limit), count: filtered.length }
}
```

Register in `TOOLS` registry at the same level as `builder.list_queue`. Mark as **read-only** in `dispatch.ts` `READ_ONLY_TOOLS` set so it works in `chat` mode.

Update Atlas's system prompt (the file 1.10q created — `atlas/src/lib/system-prompt.ts`) to mention this tool: when user asks "what shipped" or "what's done," Atlas should call `builder.list_done` first, not just `status.snapshot`.

### Part B — Trust mode persistence fix

Three sub-fixes:

1. **Make `setMode` failure visible** — currently catches errors silently. Change to throw on DB failure so the HTTP response reflects the truth ("mode could not be persisted; service-restart will revert"). Don't silently lie about success.

2. **Make `loadTrustModeFromDb` retry on boot** — if Atlas boots and Supabase isn't ready yet (transient), the load fails and we fall back to env. Add a 3-attempt retry with 1s/2s/4s backoff before falling back.

3. **Verify `atlas_config` table actually exists and Atlas can write to it** — read migration `20260430000001_atlas_config.sql` (created earlier in 1.10j); confirm RLS policy allows the service-role key to upsert. If schema is missing or RLS blocks, fix it.

Also: instrument the path so we can debug. Each `setMode` call logs `[trust-mode] writing to DB: mode=X by=Y`. Each successful upsert logs the returned row. Each failure logs the full error including any Postgres code.

### Part C — One-shot test that proves both fixes

After Builder ships this spec, the test sequence:

```bash
# 1. Confirm tool works (Atlas in chat mode)
curl -X POST https://courteous-simplicity-production.up.railway.app/atlas/chat \
  -H "Authorization: Bearer cropsintel-atlas-token-2026-04-30" \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"test-list-done","channel":"web","message":"List all done specs matching phase-1.3"}'
# Expected: streamed reply with tool_call event for builder.list_done; result includes 1.3a-h

# 2. Flip mode and verify persistence
curl -X POST .../atlas/mode -d '{"mode":"chat","setBy":"persistence-test"}'
# Then redeploy Atlas service via Railway
# Then check:
curl .../atlas/mode
# Expected: {"mode":"chat","setBy":"persistence-test"} — NOT env-var-default
```

## Files

- `atlas/src/lib/tools.ts` (extend — add `builderListDone`, register in `TOOLS`)
- `atlas/src/lib/dispatch.ts` (extend — add `'builder.list_done'` to `READ_ONLY_TOOLS` set)
- `atlas/src/lib/trust-mode.ts` (rewrite `setMode` to throw on persist failure; add retry to `loadTrustModeFromDb`)
- `atlas/src/lib/system-prompt.ts` (update — list new tool in honesty rules)
- `atlas/src/server.ts` (verify — `/atlas/mode` POST returns 500 not 200 when persist fails)
- `supabase/migrations/20260501040000_atlas_config_rls_check.sql` (NEW — re-confirm RLS policy on atlas_config; idempotent)

## Success criteria

- `npm run build` clean in `atlas/`
- Atlas in chat mode + asked "what's done in Phase 1.3" → calls `builder.list_done({filter: 'phase-1.3'})` → returns 8 entries → reports them honestly with `verified: yes`
- Atlas in chat mode + asked "what's left to build" → calls `builder.list_done()` and `memory.search('master plan phase 1')` → bridges the two correctly → reports remaining work as 1.6 onward (NOT 1.3/1.4/1.5)
- After Atlas redeploys, mode flip to `chat` survives the redeploy: `curl /atlas/mode` returns `chat` with the user's `setBy` value, not `env-var-default`
- If `atlas_config` table is missing or RLS blocks, the `/atlas/mode` POST returns HTTP 500 with the actual error message — no more silent in-memory-only success

## Risks + mitigations

- **Risk:** `builder.list_done` returns 100s of files, blowing context. **Mitigation:** default limit 100 + filter param; system prompt instructs Atlas to filter by phase prefix when relevant.
- **Risk:** `setMode` now throws — could break the dashboard's "Set Trust Mode" button if it doesn't handle 500s. **Mitigation:** WizardBar.tsx already wraps in try/catch (see line 75-81); honest 500 just shows the existing failure UX.
- **Risk:** RLS migration regresses something. **Mitigation:** migration is idempotent, only adds policies if not present, never drops existing.

## NEVER list

- Never silently succeed when DB persist fails — that's how the trust-mode bug got missed for hours.
- Never expand `list_done` into a write tool — read-only by definition.
- Never auto-upgrade trust mode on boot (must come from explicit user setMode call).
