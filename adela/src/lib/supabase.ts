/**
 * Supabase service-role client (lib wrapper).
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_KEY by default. Falls back to the
 * legacy V3_SUPABASE_URL / V3_SUPABASE_SECRET_KEY pair so this module is a
 * drop-in replacement for src/supabase.ts during the migration window.
 *
 * The sb_secret_ key format must be passed as both apikey header and Bearer
 * token — Supabase accepts either, but newer libraries default to apikey.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL ?? process.env.V3_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.V3_SUPABASE_SECRET_KEY

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL (or V3_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or V3_SUPABASE_SECRET_KEY) must be set"
  )
}

export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  },
})

export const STORAGE_BUCKET = "adela-raw"

/**
 * Ensure the adela-raw storage bucket exists. Idempotent — creates the
 * bucket if missing, returns silently if it already exists.
 */
export async function ensureStorageBucket(bucketName: string = STORAGE_BUCKET): Promise<void> {
  const { data: existing, error: getErr } = await supabase.storage.getBucket(bucketName)
  if (existing) return
  if (getErr && getErr.message && !getErr.message.toLowerCase().includes("not found")) {
    console.warn(`[supabase] getBucket('${bucketName}') warning:`, getErr.message)
  }

  const { error: createErr } = await supabase.storage.createBucket(bucketName, {
    public: false,
  })
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    console.warn(`[supabase] createBucket('${bucketName}') failed:`, createErr.message)
  }
}
