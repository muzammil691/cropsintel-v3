// Edge function: auth-bridge (Phase 1.3a)
//
// Detects whether an inbound email/phone matches a V1 or V2 legacy user that has
// not yet been migrated to V3. Returns { found, set_password_required, hint_*}.
// The frontend uses this when Supabase says "user not found" so it can route
// the visitor through SetPassword instead of an "unknown user" error.
//
// This function is intentionally read-only on the user space — it does NOT
// create accounts. It only writes to auth_bridge_log when a match is found.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BridgeRequest {
  email?: string
  phone?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const body = (await req.json()) as BridgeRequest
    const email = body.email?.trim().toLowerCase()
    const phone = body.phone?.trim()

    if (!email && !phone) {
      return jsonError(400, 'Provide at least one of email or phone')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let legacy: {
      id: string
      source: string
      email: string | null
      phone: string | null
    } | null = null

    if (email) {
      const { data } = await supabase
        .from('legacy_users')
        .select('id, source, email, phone')
        .ilike('email', email)
        .is('migrated_to_v3_user_id', null)
        .maybeSingle()
      legacy = data ?? null
    }

    if (!legacy && phone) {
      const { data } = await supabase
        .from('legacy_users')
        .select('id, source, email, phone')
        .eq('phone', phone)
        .is('migrated_to_v3_user_id', null)
        .maybeSingle()
      legacy = data ?? null
    }

    if (!legacy) {
      return new Response(
        JSON.stringify({ found: false, set_password_required: false }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    // Check whether a V3 auth.users record already exists for this identity.
    // If yes, set_password_required = false (user already finished the bridge).
    // If no, set_password_required = true (SetPassword flow is needed).
    let setPasswordRequired = true
    if (legacy.email) {
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
      const exists = list?.users?.some((u) => u.email?.toLowerCase() === legacy!.email!.toLowerCase())
      if (exists) setPasswordRequired = false
    }

    const bridgeMethod =
      email && legacy.email && legacy.email.toLowerCase() === email
        ? 'email_match'
        : 'phone_match'

    await supabase.from('auth_bridge_log').insert({
      v1_match_email: legacy.source === 'v1' ? legacy.email : null,
      v1_match_phone: legacy.source === 'v1' ? legacy.phone : null,
      v2_match_email: legacy.source === 'v2' ? legacy.email : null,
      v2_match_phone: legacy.source === 'v2' ? legacy.phone : null,
      bridge_method: bridgeMethod,
      set_password_required: setPasswordRequired,
    })

    return new Response(
      JSON.stringify({
        found: true,
        set_password_required: setPasswordRequired,
        hint_email: maskEmail(legacy.email),
        hint_phone: maskPhone(legacy.phone),
        legacy_source: legacy.source,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('auth-bridge error:', err)
    return jsonError(500, 'Internal server error')
  }
})

function jsonError(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}

function maskEmail(email: string | null): string | null {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!domain) return email
  const visible = local.slice(0, 1)
  return `${visible}${'•'.repeat(Math.max(local.length - 1, 3))}@${domain}`
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  if (phone.length <= 4) return phone
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 5)}${phone.slice(-2)}`
}
