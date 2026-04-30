// Edge function: whatsapp-otp-verify
// Verifies a 6-digit OTP and returns a Supabase session for the phone owner.
// Phase 1.3d — CropsIntel V3

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { phone, code } = await req.json()
    if (!phone || !code || !/^\d{6}$/.test(code)) {
      return new Response(
        JSON.stringify({ error: 'Invalid input' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find the most recent pending OTP for this phone
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
      return new Response(
        JSON.stringify({ error: 'No pending OTP found or it has expired. Request a new one.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (otp.attempts >= otp.max_attempts) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Request a new OTP.' }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const codeHash = await sha256(code + phone)
    if (codeHash !== otp.code_hash) {
      await supabase
        .from('whatsapp_otp_logs')
        .update({ attempts: otp.attempts + 1 })
        .eq('id', otp.id)
      return new Response(
        JSON.stringify({ error: 'Invalid code' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // Mark OTP used
    await supabase
      .from('whatsapp_otp_logs')
      .update({ used_at: new Date().toISOString() })
      .eq('id', otp.id)

    // Find or create the Supabase Auth user for this phone.
    // We use a synthetic email (<digits>@whatsapp.cropsintel.local) so Supabase's
    // email-based magic link session handling works for phone-only users.
    const syntheticEmail = `${phone.replace(/[^0-9]/g, '')}@whatsapp.cropsintel.local`

    // Look up by phone first, then fall back to the synthetic email
    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const existingUser = listData?.users?.find(
      u => u.phone === phone || u.email === syntheticEmail
    )

    let userId: string
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
        return new Response(
          JSON.stringify({ error: 'Failed to create user' }),
          { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        )
      }
      userId = newUser.user.id
    }

    // Generate a magic link for the synthetic email — the hashed_token in its properties
    // lets the frontend call supabase.auth.verifyOtp() to establish a session.
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://muzammil691.github.io/cropsintel-v3'
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: syntheticEmail,
      options: { redirectTo: `${siteUrl}/auth/callback` },
    })

    if (linkErr || !linkData) {
      console.error('generateLink error:', linkErr)
      return new Response(
        JSON.stringify({ error: 'Failed to generate session link' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        action_link: linkData.properties?.action_link,
        hashed_token: linkData.properties?.hashed_token,
        email: syntheticEmail,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('whatsapp-otp-verify error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}
