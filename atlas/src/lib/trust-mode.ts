import { TrustMode } from '../types'
import { getSupabaseClient } from './supabase'

let _currentMode: TrustMode = (process.env.ATLAS_TRUST_MODE as TrustMode) ?? 'passive'
let _modeSetAt: Date = new Date()
let _modeSetBy: string = 'env-var-default'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function loadTrustModeFromDb(): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) {
    console.log(`[trust-mode] no Supabase client; using env default: ${_currentMode}`)
    return
  }

  // 3 attempts with 200ms / 600ms / 1.8s backoff before falling back to env default.
  // Transient boot races (Supabase connection pool not warm yet) shouldn't lose
  // the user's persisted mode — they'd silently revert to passive on every restart.
  // 1.10af tightened the timing from 1s/2s/4s after Bug D — 7s of sleep on cold
  // boot was making the conductor heartbeat fire against env-default before
  // the DB read completed.
  const delays = [200, 600, 1800]
  let lastErr: unknown = null
  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const { data, error } = await sb.from('atlas_config').select('*').eq('key', 'trust_mode').maybeSingle()
      if (error) throw error
      // Log the raw read so debugging doesn't have to infer the row from the
      // inferred mode. Bug D (2026-05-01) was masked by "no DB override" never
      // distinguishing between (a) row missing and (b) row present but empty.
      const rowCount = data ? 1 : 0
      const rawValue = data ? (data.value as string | null | undefined) ?? null : null
      const rawSetBy = data ? (data.set_by as string | null | undefined) ?? null : null
      console.log(`[trust-mode] DB read result: rowCount=${rowCount}, value=${rawValue ?? 'null'}, set_by=${rawSetBy ?? 'null'}`)
      if (data && data.value) {
        _currentMode = data.value as TrustMode
        _modeSetAt = new Date(data.updated_at as string)
        _modeSetBy = (data.set_by as string) ?? 'unknown'
        console.log(`[trust-mode] loaded from DB on attempt ${attempt + 1}: ${_currentMode} (set at ${_modeSetAt.toISOString()} by ${_modeSetBy})`)
      } else {
        console.log(`[trust-mode] no DB override; using env default: ${_currentMode}`)
      }
      return
    } catch (err) {
      lastErr = err
      console.warn(`[trust-mode] DB load attempt ${attempt + 1}/${delays.length} failed:`, err)
      if (attempt < delays.length - 1) {
        await sleep(delays[attempt])
      }
    }
  }
  console.warn('[trust-mode] all DB load attempts failed, using env default:', lastErr)
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

  console.log(`[trust-mode] writing to DB: mode=${newMode} by=${setBy}`)

  const sb = getSupabaseClient()
  if (!sb) {
    // No DB at all = honest hard-fail. We refuse to silently keep an in-memory
    // mode that vanishes on next restart — that's the bug that lost the user's
    // chat-mode flip overnight on 2026-04-30.
    throw new Error('trust-mode: no Supabase client configured; mode change cannot be persisted. Set V3_SUPABASE_URL + V3_SUPABASE_SECRET_KEY.')
  }

  const updatedAt = new Date().toISOString()
  const { data, error } = await sb.from('atlas_config').upsert({
    key: 'trust_mode',
    value: newMode,
    set_by: setBy,
    updated_at: updatedAt,
  }, { onConflict: 'key' }).select().maybeSingle()

  if (error) {
    const code = (error as { code?: string }).code ?? 'unknown'
    const detail = JSON.stringify(error)
    console.error(`[trust-mode] DB upsert FAILED code=${code}: ${detail}`)
    // Surface to the caller — the HTTP layer will turn this into a 500 so the
    // user doesn't see "success" while their mode change quietly evaporates.
    throw new Error(`trust-mode: persist failed (code=${code}): ${error.message ?? 'unknown'}`)
  }

  console.log(`[trust-mode] DB upsert OK; row=${JSON.stringify(data)}`)

  // Only mutate in-memory state once the DB write has succeeded. If it failed
  // above, we threw and never got here.
  _currentMode = newMode
  _modeSetAt = new Date(updatedAt)
  _modeSetBy = setBy
  console.log(`[trust-mode] set to ${newMode} by ${setBy}`)
}
