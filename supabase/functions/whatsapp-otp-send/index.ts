// Edge function: whatsapp-otp-send
// Generates a 6-digit OTP, stores it hashed in whatsapp_otp_logs, sends via Twilio WhatsApp.
// Phase 1.3d — CropsIntel V3

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER')!
const TWILIO_OTP_TEMPLATE_SID = Deno.env.get('TWILIO_OTP_TEMPLATE_SID')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { phone } = await req.json()
    if (!phone || !/^\+\d{6,16}$/.test(phone)) {
      return new Response(
        JSON.stringify({ error: 'Invalid phone format. Use E.164 like +971501234567' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Enforce: 1 OTP per phone per 60 seconds (prevent spam)
    const { data: recent } = await supabase
      .from('whatsapp_otp_logs')
      .select('created_at')
      .eq('phone', phone)
      .is('used_at', null)
      .gt('created_at', new Date(Date.now() - 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()

    if (recent) {
      return new Response(
        JSON.stringify({ error: 'Please wait 60 seconds before requesting a new code.' }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = await sha256(code + phone)

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? null

    await supabase.from('whatsapp_otp_logs').insert({
      phone,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ip_address: ip,
    })

    // Send via Twilio WhatsApp template (24h-window-safe)
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
    const params = new URLSearchParams({
      From: `whatsapp:${TWILIO_FROM_NUMBER}`,
      To: `whatsapp:${phone}`,
      ContentSid: TWILIO_OTP_TEMPLATE_SID,
      ContentVariables: JSON.stringify({ '1': code }),
    })

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    )

    if (!twilioRes.ok) {
      const detail = await twilioRes.text()
      console.error('Twilio error:', detail)
      return new Response(
        JSON.stringify({ error: 'Failed to send WhatsApp OTP', detail }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, expires_in_seconds: 600 }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('whatsapp-otp-send error:', err)
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
