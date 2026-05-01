import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client

  // Multi-name fallback (Railway uses V3_ prefix; original spec used unprefixed)
  const url = process.env.V3_SUPABASE_URL
    ?? process.env.SUPABASE_URL

  // Service-role keys (allowed to write designer_runs under RLS).
  const serviceKey = process.env.V3_SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_KEY

  // Anon fallback — read-only against RLS-protected tables. Logged so a
  // misconfigured Railway env doesn't silently swallow audit writes.
  const anonKey = process.env.SUPABASE_ANON_KEY

  const key = serviceKey ?? anonKey

  if (!url || !key) return null

  if (!serviceKey && anonKey) {
    console.warn(
      '[designer] No service-role key found (V3_SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_KEY). ' +
        'Falling back to anon key — designer_runs writes will be blocked by RLS.',
    )
  }

  _client = createClient(url, key)
  return _client
}
