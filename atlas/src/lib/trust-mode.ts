import { TrustMode } from '../types'
import { getSupabaseClient } from './supabase'

let _currentMode: TrustMode = (process.env.ATLAS_TRUST_MODE as TrustMode) ?? 'passive'
let _modeSetAt: Date = new Date()
let _modeSetBy: string = 'env-var-default'

export async function loadTrustModeFromDb(): Promise<void> {
  try {
    const sb = getSupabaseClient()
    if (!sb) {
      console.log(`[trust-mode] no Supabase client; using env default: ${_currentMode}`)
      return
    }
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

  try {
    const sb = getSupabaseClient()
    if (!sb) {
      console.warn('[trust-mode] no Supabase client; mode change active in-memory only')
      return
    }
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
