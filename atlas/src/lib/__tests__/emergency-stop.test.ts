import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEmergencyStopEnabled } from '../emergency-stop'

vi.mock('../supabase', () => ({
  getSupabaseClient: vi.fn(),
}))

const originalEmergencyStop = process.env.ATLAS_EMERGENCY_STOP
const originalTrustMode = process.env.ATLAS_TRUST_MODE

afterEach(() => {
  if (originalEmergencyStop === undefined) delete process.env.ATLAS_EMERGENCY_STOP
  else process.env.ATLAS_EMERGENCY_STOP = originalEmergencyStop

  if (originalTrustMode === undefined) delete process.env.ATLAS_TRUST_MODE
  else process.env.ATLAS_TRUST_MODE = originalTrustMode

  vi.clearAllMocks()
  vi.resetModules()
})

describe('Atlas emergency stop', () => {
  it.each(['true', 'TRUE', '1', 'yes', 'on'])('recognizes %s as enabled', (value) => {
    expect(isEmergencyStopEnabled({ ATLAS_EMERGENCY_STOP: value })).toBe(true)
  })

  it.each([undefined, '', 'false', '0', 'off', 'unexpected'])(
    'does not enable for %s',
    (value) => {
      expect(isEmergencyStopEnabled({ ATLAS_EMERGENCY_STOP: value })).toBe(false)
    },
  )

  it('forces stopped mode and never reads a persisted auto mode', async () => {
    process.env.ATLAS_EMERGENCY_STOP = 'true'
    process.env.ATLAS_TRUST_MODE = 'auto'

    const { getSupabaseClient } = await import('../supabase')
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error('database must not be read during an emergency stop')
    })

    const trustMode = await import('../trust-mode')

    expect(trustMode.resolveStartupTrustMode()).toBe('stopped')
    expect(trustMode.getCurrentMode()).toBe('stopped')
    await expect(trustMode.loadTrustModeFromDb()).resolves.toBeUndefined()
    expect(getSupabaseClient).not.toHaveBeenCalled()
  })

  it('blocks attempts to restore auto mode while the stop is active', async () => {
    process.env.ATLAS_EMERGENCY_STOP = 'true'
    const trustMode = await import('../trust-mode')

    await expect(trustMode.setMode('auto', 'test')).rejects.toThrow(
      'Atlas emergency stop is active',
    )
  })

  it('uses passive as the safe default for missing or invalid normal modes', async () => {
    delete process.env.ATLAS_EMERGENCY_STOP
    process.env.ATLAS_TRUST_MODE = 'not-a-mode'
    const trustMode = await import('../trust-mode')

    expect(trustMode.resolveStartupTrustMode()).toBe('passive')
  })
})
