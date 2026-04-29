import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client

  // Accept multiple env var naming conventions:
  // - V3_-prefixed (Railway convention)
  // - SUPABASE_SECRET_KEY (new Supabase naming, sb_secret_*)
  // - SUPABASE_SERVICE_KEY (legacy service_role JWT name)
  // - SUPABASE_ANON_KEY (anon/public; works for read-only flows)
  const url = process.env.V3_SUPABASE_URL
    ?? process.env.SUPABASE_URL

  const key = process.env.V3_SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_KEY
    ?? process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase credentials missing. Set V3_SUPABASE_URL/V3_SUPABASE_SECRET_KEY, ' +
      'or SUPABASE_URL/SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY).',
    )
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  })
  return _client
}
