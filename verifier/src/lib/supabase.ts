import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client

  // Accept multiple env var naming conventions (Railway uses V3_ prefix; original spec used unprefixed)
  const url = process.env.V3_SUPABASE_URL
    ?? process.env.SUPABASE_URL

  // CRITICAL: Only use SERVICE_ROLE_KEY, NEVER anon key.
  // The verifier writes to verifier_runs which requires service_role privileges.
  // Fallback to ANON_KEY was the root cause of db_write_failed (phase-1.10az).
  const key = process.env.V3_SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.V3_SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    console.error('[verifier] Missing Supabase credentials. Required: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    return null
  }

  _client = createClient(url, key)
  return _client
}
