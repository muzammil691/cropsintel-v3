import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client

  // Accept multiple env var naming conventions (Railway uses V3_ prefix; original spec used unprefixed)
  const url = process.env.V3_SUPABASE_URL
    ?? process.env.SUPABASE_URL

  const key = process.env.V3_SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_KEY
    ?? process.env.SUPABASE_ANON_KEY

  if (!url || !key) return null

  _client = createClient(url, key)
  return _client
}
