# Task: Phase 1.10j — Atlas trust mode runtime flag + kill switch

**Master plan reference:** `.agent/specs/atlas-master-spec.md` §3 (trust modes)
**Context:** Trust mode currently reads from `process.env.ATLAS_TRUST_MODE` per request. Changing the env var on Railway works but triggers redeploy (~30s downtime). For production-grade flipping (especially the kill switch), we want runtime change without redeploy.
**Estimated effort:** ~15 min
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Make trust mode flippable at runtime via:
1. In-memory cache that's the source of truth for the running process (initialized from env var at boot)
2. `POST /atlas/mode` endpoint that updates the in-memory cache (auth-gated)
3. Persistent override in `atlas_config` table (so restart doesn't lose user-set mode)

## Implementation

### atlas/src/lib/trust-mode.ts

```ts
import { TrustMode } from '../types'
import { getSupabaseClient } from './supabase'

let _currentMode: TrustMode = (process.env.ATLAS_TRUST_MODE as TrustMode) ?? 'passive'
let _modeSetAt: Date = new Date()
let _modeSetBy: string = 'env-var-default'

export async function loadTrustModeFromDb(): Promise<void> {
  // On boot, check atlas_config for a persisted override
  try {
    const sb = getSupabaseClient()
    const { data } = await sb.from('atlas_config').select('*').eq('key', 'trust_mode').maybeSingle()
    if (data && data.value) {
      _currentMode = data.value as TrustMode
      _modeSetAt = new Date(data.updated_at as string)
      _modeSetBy = (data.set_by as string) ?? 'unknown'
      console.log(`[trust-mode] loaded from DB: ${_currentMode} (set at ${_modeSetAt.toISOString()} by ${_modeSetBy})`)
    } else {
      console.log(`[trust-mode] no DB override; using env default: ${_currentMode}`)
    }
  } catch (err) {
    console.warn('[trust-mode] DB load failed, using env default:', err)
  }
}

export function getCurrentMode(): TrustMode {
  return _currentMode
}

export function getModeMetadata() {
  return { mode: _currentMode, setAt: _modeSetAt, setBy: _modeSetBy }
}

export async function setMode(newMode: TrustMode, setBy: string): Promise<void> {
  const valid: TrustMode[] = ['passive', 'chat', 'confirm', 'auto', 'stopped']
  if (!valid.includes(newMode)) {
    throw new Error(`Invalid trust mode: ${newMode}. Must be one of: ${valid.join(', ')}`)
  }

  _currentMode = newMode
  _modeSetAt = new Date()
  _modeSetBy = setBy

  // Persist to DB
  try {
    const sb = getSupabaseClient()
    await sb.from('atlas_config').upsert({
      key: 'trust_mode',
      value: newMode,
      set_by: setBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    console.log(`[trust-mode] set to ${newMode} by ${setBy}`)
  } catch (err) {
    console.error('[trust-mode] DB persist failed (mode change still active in-memory):', err)
  }
}
```

### Add atlas_config table to schema (if not in 1.10b)

If `atlas_config` doesn't exist from 1.10b, add a small migration here:

```sql
CREATE TABLE IF NOT EXISTS public.atlas_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  set_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atlas_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read config" ON public.atlas_config FOR SELECT USING (true);
```

If 1.10b already has it (it doesn't in the master spec), check for existence and skip the table creation. Either way, this task ensures atlas_config exists.

### Update dispatch.ts and chat handler

Replace direct env reads:
```ts
// OLD
const trustMode = (process.env.ATLAS_TRUST_MODE ?? 'passive') as TrustMode

// NEW
import { getCurrentMode } from './trust-mode'
const trustMode = getCurrentMode()
```

### Add /atlas/mode endpoint

```ts
if (url === '/atlas/mode' && method === 'GET') {
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
  json(res, 200, getModeMetadata())
  return
}

if (url === '/atlas/mode' && method === 'POST') {
  if (!authenticate(req)) { json(res, 401, { error: 'Unauthorized' }); return }
  const body = await readBody(req)
  let payload: { mode: TrustMode; setBy?: string }
  try { payload = JSON.parse(body) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
  try {
    await setMode(payload.mode, payload.setBy ?? 'api')
    json(res, 200, { ...getModeMetadata(), success: true })
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : String(err) })
  }
  return
}
```

### Boot: call loadTrustModeFromDb

In `startServer()`:

```ts
import { loadTrustModeFromDb } from './lib/trust-mode'

export async function startServer(): Promise<void> {
  // ... existing validateEnv ...
  await loadTrustModeFromDb()
  startSnapshotCron()
  // ... existing listen() ...
}
```

## Acceptance criteria

After this task ships:

1. `atlas/src/lib/trust-mode.ts` exists with `getCurrentMode`, `setMode`, `loadTrustModeFromDb`.
2. `atlas_config` table exists (created here if not in 1.10b).
3. `GET /atlas/mode` returns current mode + metadata.
4. `POST /atlas/mode {mode: "chat", setBy: "muzammil"}` flips mode in-memory AND persists to DB.
5. Restart Atlas service — mode loaded from DB, not from env var.
6. dispatcher and chat handler now read from `getCurrentMode()`, not `process.env`.
7. Setting `mode=stopped` immediately blocks all dispatches (kill switch).

## Out of scope

- UI affordance for flipping mode (1.10k frontend handles this)
- Audit log of mode changes (atlas_config has updated_at; richer log later)
- Authorization granularity (right now any Bearer token holder can flip mode; tighten later)

## Notes

- The kill switch (`mode=stopped`) is the most important piece — it must work even if Atlas is otherwise wedged. Test that explicitly.
- env var still acts as initial bootstrap default. If atlas_config is empty AND no env var, defaults to `passive`.
- Multiple Atlas replicas (future scale) would need broadcasting for in-memory consistency. For v0.1 single-replica, in-memory is fine.
