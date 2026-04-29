import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client

  const url = process.env.V3_SUPABASE_URL
  const key = process.env.V3_SUPABASE_SECRET_KEY

  if (!url) throw new Error('V3_SUPABASE_URL is not set')
  if (!key) throw new Error('V3_SUPABASE_SECRET_KEY is not set')

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}
