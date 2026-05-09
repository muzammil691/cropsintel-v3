// Edge function: whatsapp-send-otp (Phase 1.3a)
//
// Sends a 6-digit OTP via Twilio WhatsApp. Wraps Phase 1.3d's whatsapp-otp-send
// with V3-spec naming + per-user rate limiting via agent_rate_limits + per-call
// audit log entry. AI/provider keys live in Supabase secrets — never in VITE_*.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM_NUMBER =
  Deno.env.get('TWILIO_WHATSAPP_FROM') ?? Deno.env.get('TWILIO_FROM_NUMBER')!
const TWILIO_OTP_TEMPLATE_SID = Deno.env.get('TWILIO_OTP_TEMPLATE_SID') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_MAX_PER_HOUR = 5

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
    const { phone } = await req.json()
    if (!phone || !/^\+\d{6,16}$/.test(phone)) {
      return jsonError(400, 'Invalid phone format. Use E.164 like +971501234567')
    }

    // Rate limit: 5 requests per phone per hour (uses agent_rate_limits)
    const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const { data: recentSends } = await supabase
      .from('whatsapp_otp_logs')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .gt('created_at', windowStart)

    if (recentSends && (recentSends as unknown as { length: number }).length >= RATE_MAX_PER_HOUR) {
      return jsonError(429, 'Too many OTP requests. Try again later.')
    }

    // Spam guard: 60s between sends to the same phone
    const { data: recent } = await supabase
      .from('whatsapp_otp_logs')
      .select('created_at')
      .eq('phone', phone)
      .is('used_at', null)
      .gt('created_at', new Date(Date.now() - 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()

    if (recent) {
      return jsonError(429, 'Please wait 60 seconds before requesting a new code.')
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = await sha256(code + phone)
    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? null

    await supabase.from('whatsapp_otp_logs').insert({
      phone,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ip_address: ip,
    })

    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
    const params = new URLSearchParams(
      TWILIO_OTP_TEMPLATE_SID
        ? {
            From: `whatsapp:${TWILIO_FROM_NUMBER}`,
            To: `whatsapp:${phone}`,
            ContentSid: TWILIO_OTP_TEMPLATE_SID,
            ContentVariables: JSON.stringify({ '1': code }),
          }
        : {
            From: `whatsapp:${TWILIO_FROM_NUMBER}`,
            To: `whatsapp:${phone}`,
            Body: `Your CropsIntel code is ${code}. Expires in 10 minutes.`,
          },
    )

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    )

    if (!twilioRes.ok) {
      const detail = await twilioRes.text()
      console.error('Twilio error:', detail)
      await audit(supabase, 'failure', { phone, detail }, startedAt)
      return jsonError(500, 'Failed to send WhatsApp OTP')
    }

    await audit(supabase, 'success', { phone }, startedAt)
    return new Response(
      JSON.stringify({ success: true, expires_in_seconds: 600 }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('whatsapp-send-otp error:', err)
    await audit(supabase, 'failure', { error: String(err) }, startedAt)
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

async function audit(
  supabase: ReturnType<typeof createClient>,
  status: 'success' | 'failure',
  payload: Record<string, unknown>,
  startedAt: number,
) {
  try {
    await supabase.from('agent_audit_log').insert({
      agent_name: 'auth',
      action_type: 'whatsapp_send_otp',
      payload,
      status,
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('audit log failed:', err)
  }
}
