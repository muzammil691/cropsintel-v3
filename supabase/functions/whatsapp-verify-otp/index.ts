// Edge function: whatsapp-verify-otp (Phase 1.3a)
//
// Verifies a 6-digit WhatsApp OTP and returns a magic-link the frontend exchanges
// for a Supabase session. On success, also runs the V1/V2 auth-bridge check and
// surfaces the result so the client can redirect into SetPassword if needed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const startedAt = Date.now()
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const { phone, code } = await req.json()
    if (!phone || !code || !/^\d{6}$/.test(code)) {
      return jsonError(400, 'Invalid input')
    }

    const { data: otp } = await supabase
      .from('whatsapp_otp_logs')
      .select('*')
      .eq('phone', phone)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!otp) {
      return jsonError(400, 'No pending OTP found or it has expired. Request a new one.')
    }

    if (otp.attempts >= otp.max_attempts) {
      return jsonError(429, 'Too many attempts. Request a new OTP.')
    }

    const codeHash = await sha256(code + phone)
    if (codeHash !== otp.code_hash) {
      await supabase
        .from('whatsapp_otp_logs')
        .update({ attempts: otp.attempts + 1 })
        .eq('id', otp.id)
      return jsonError(400, 'Invalid code')
    }

    await supabase
      .from('whatsapp_otp_logs')
      .update({ used_at: new Date().toISOString() })
      .eq('id', otp.id)

    const syntheticEmail = `${phone.replace(/[^0-9]/g, '')}@whatsapp.cropsintel.local`

    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const existingUser = listData?.users?.find(
      (u) => u.phone === phone || u.email === syntheticEmail,
    )

    let userId: string
    let isNewUser = false
    if (existingUser) {
      userId = existingUser.id
    } else {
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        phone,
        phone_confirm: true,
        email_confirm: true,
        user_metadata: { source: 'whatsapp_otp', whatsapp_number: phone },
      })
      if (createErr || !newUser?.user) {
        console.error('createUser error:', createErr)
        return jsonError(500, 'Failed to create user')
      }
      userId = newUser.user.id
      isNewUser = true
    }

    // Mark profile WhatsApp-verified
    await supabase
      .from('profiles')
      .update({ whatsapp_number: phone, whatsapp_verified: true, last_seen_at: new Date().toISOString() })
      .eq('id', userId)

    // Run V1/V2 bridge check on the phone (best-effort)
    let bridge: { found: boolean; set_password_required: boolean } = {
      found: false,
      set_password_required: false,
    }
    try {
      const { data: legacy } = await supabase
        .from('legacy_users')
        .select('id, source, email')
        .eq('phone', phone)
        .is('migrated_to_v3_user_id', null)
        .maybeSingle()
      if (legacy) {
        bridge = { found: true, set_password_required: isNewUser }
        await supabase.from('auth_bridge_log').insert({
          user_id: userId,
          v1_match_phone: legacy.source === 'v1' ? phone : null,
          v2_match_phone: legacy.source === 'v2' ? phone : null,
          bridge_method: 'whatsapp_match',
          set_password_required: isNewUser,
        })
      }
    } catch (err) {
      console.error('bridge check failed:', err)
    }

    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://muzammil691.github.io/cropsintel-v3'
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: syntheticEmail,
      options: { redirectTo: `${siteUrl}/auth/callback` },
    })

    if (linkErr || !linkData) {
      console.error('generateLink error:', linkErr)
      return jsonError(500, 'Failed to generate session link')
    }

    await supabase.from('agent_audit_log').insert({
      agent_name: 'auth',
      action_type: 'whatsapp_verify_otp',
      user_id: userId,
      payload: { phone, is_new_user: isNewUser, bridge_found: bridge.found },
      status: 'success',
      duration_ms: Date.now() - startedAt,
    })

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        action_link: linkData.properties?.action_link,
        hashed_token: linkData.properties?.hashed_token,
        email: syntheticEmail,
        is_new_user: isNewUser,
        bridge,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('whatsapp-verify-otp error:', err)
    return jsonError(500, 'Internal server error')
  }
})

function jsonError(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
