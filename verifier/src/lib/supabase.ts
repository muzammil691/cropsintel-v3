import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function resolveCreds(): { url: string | undefined; key: string | undefined; anonLeak: boolean } {
  const url = process.env.V3_SUPABASE_URL
    ?? process.env.SUPABASE_URL

  // CRITICAL: Only use SERVICE_ROLE_KEY, NEVER anon key.
  // The verifier writes to verifier_runs which requires service_role privileges.
  // Fallback to ANON_KEY was the root cause of db_write_failed (phase-1.10az,
  // re-confirmed by phase-1.10bb). Names accepted, in priority order:
  //   V3_SUPABASE_SERVICE_ROLE_KEY > SUPABASE_SERVICE_ROLE_KEY >
  //   V3_SUPABASE_SECRET_KEY > SUPABASE_SECRET_KEY > SUPABASE_SERVICE_KEY
  const key = process.env.V3_SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.V3_SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_KEY

  // Detect the anti-pattern: anon key configured but no service-role key.
  // This is the exact misconfiguration phase-1.10bb is fixing — if an
  // operator wires only ANON_KEY, the Verifier would silently fall back
  // (in older revisions) or appear "configured" while RLS blocks writes.
  const anonLeak = !key && Boolean(
    process.env.SUPABASE_ANON_KEY
    ?? process.env.V3_SUPABASE_ANON_KEY,
  )

  return { url, key, anonLeak }
}

export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client

  const { url, key, anonLeak } = resolveCreds()

  if (!url || !key) {
    if (anonLeak) {
      console.error(
        '[verifier] SUPABASE_ANON_KEY is set but SUPABASE_SERVICE_ROLE_KEY is missing. '
          + 'Refusing to fall back to the anon key — verifier_runs INSERTs would be silently '
          + 'blocked by RLS. Set SUPABASE_SERVICE_ROLE_KEY (or V3_SUPABASE_SERVICE_ROLE_KEY) and restart.',
      )
    } else {
      console.error(
        '[verifier] Missing Supabase credentials. Required: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    return null
  }

  _client = createClient(url, key)
  return _client
}

// Strict variant for write paths (audit log, smoke tests). Throws a
// descriptive error at first call when env vars are missing or when only
// the anon key is configured. Use this from any code path that MUST
// succeed at writing to verifier_runs (the verifier's auditing pipeline);
// read-only callers should keep using getSupabaseClient() and skip on null.
export function requireSupabaseClient(): SupabaseClient {
  const { url, key, anonLeak } = resolveCreds()

  if (!url) {
    throw new Error(
      '[verifier] SUPABASE_URL (or V3_SUPABASE_URL) is required but not set. '
        + 'Configure it in the Verifier service env vars and restart.',
    )
  }
  if (!key) {
    if (anonLeak) {
      throw new Error(
        '[verifier] SUPABASE_SERVICE_ROLE_KEY is required but only SUPABASE_ANON_KEY is set. '
          + 'The Verifier writes to verifier_runs which requires service-role privileges; '
          + 'the anon key is silently blocked by RLS. Set SUPABASE_SERVICE_ROLE_KEY '
          + '(or V3_SUPABASE_SERVICE_ROLE_KEY) and restart.',
      )
    }
    throw new Error(
      '[verifier] SUPABASE_SERVICE_ROLE_KEY is required but not set. '
        + 'Accepted env var names (priority order): V3_SUPABASE_SERVICE_ROLE_KEY, '
        + 'SUPABASE_SERVICE_ROLE_KEY, V3_SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEY, '
        + 'SUPABASE_SERVICE_KEY.',
    )
  }

  if (!_client) {
    _client = createClient(url, key)
  }
  return _client
}
