import { supabase } from './supabase'

export type MigrationResult = {
  migrated: boolean
  legacy_source?: 'v1' | 'v2'
  reason?: string
}

export async function checkLegacyMigration(): Promise<MigrationResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { migrated: false }

  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-legacy-user`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      },
    )
    if (!res.ok) return { migrated: false }
    return await res.json()
  } catch {
    return { migrated: false }
  }
}
