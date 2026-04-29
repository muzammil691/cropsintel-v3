import { createClient } from "@supabase/supabase-js"

const url = process.env.V3_SUPABASE_URL
const key = process.env.V3_SUPABASE_SECRET_KEY

if (!url || !key) {
  throw new Error("V3_SUPABASE_URL and V3_SUPABASE_SECRET_KEY must be set")
}

// Use the sb_secret_ key format — must be passed as apikey header (not Bearer JWT)
export const supabase = createClient(url, key, {
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
