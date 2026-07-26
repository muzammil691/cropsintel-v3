/**
 * Process-level kill switch for Atlas.
 *
 * This setting is deliberately independent from the persisted trust mode:
 * a database row must never be able to override an operator's Railway-level
 * emergency stop.
 */
export function isEmergencyStopEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.ATLAS_EMERGENCY_STOP?.trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}
