# Task: Phase 1.3d — WhatsApp OTP login

**Master plan reference:** §11.2 Phase 1.3 — login method 3 of 4. CropsIntel's signature login method (V1+V2 had this).
**Context:** User enters WhatsApp number → OTP sent via Twilio → enters OTP → signs in. Most-used login by Maxons-region customers (UAE, India). Depends on 1.3a.
**Estimated effort:** ~45 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

WhatsApp OTP flow using Supabase Auth `signInWithOtp` (phone variant) routed through Twilio. Two-step UX: number → 6-digit code → session.

## Files to create

```
supabase/migrations/<timestamp>_whatsapp_otp_logs.sql  # audit table
supabase/functions/whatsapp-otp-send/index.ts          # edge function: generate + send OTP via Twilio
supabase/functions/whatsapp-otp-verify/index.ts        # edge function: verify OTP + return Supabase session
src/lib/auth-whatsapp.ts
src/components/auth/WhatsAppOtpForm.tsx
```

## Architecture

Supabase Auth's built-in phone OTP uses SMS by default. For WhatsApp specifically, we use a CUSTOM flow via edge functions:

```
[Frontend] enter phone
    ↓
[POST /functions/v1/whatsapp-otp-send] {phone}
    ↓
  → generate 6-digit code, hash, store in whatsapp_otp_logs (10 min expiry)
  → call Twilio Messages API with WhatsApp template (or freeform if 24h window open)
  → Twilio sends WhatsApp to user
    ↓
[Frontend] enter code
    ↓
[POST /functions/v1/whatsapp-otp-verify] {phone, code}
    ↓
  → check hash matches, not expired
  → call supabase.auth.admin.generateLink({type: 'magiclink'}) for that phone's user
  → OR if user doesn't exist, create one + return session
    ↓
[Frontend] supabase.auth.setSession(returnedSession)
```

## Schema migration

```sql
CREATE TABLE public.whatsapp_otp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,           -- bcrypt or sha256
  attempts int DEFAULT 0,
  max_attempts int DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet
);
CREATE INDEX idx_whatsapp_otp_phone_pending ON whatsapp_otp_logs (phone, expires_at) WHERE used_at IS NULL;
ALTER TABLE whatsapp_otp_logs ENABLE ROW LEVEL SECURITY;
-- service_role only — no client policies
```

## Edge function: whatsapp-otp-send

```ts
// supabase/functions/whatsapp-otp-send/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER')!  // Maxons registered Zyra number for customer auth
const TWILIO_OTP_TEMPLATE_SID = Deno.env.get('TWILIO_OTP_TEMPLATE_SID')!

Deno.serve(async (req) => {
  const { phone } = await req.json()
  if (!phone || !/^\+\d{6,16}$/.test(phone)) {
    return new Response(JSON.stringify({ error: 'Invalid phone format. Use E.164 like +971501234567' }), { status: 400 })
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = await sha256(code + phone)  // simple salt with phone

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  await supabase.from('whatsapp_otp_logs').insert({
    phone,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ip_address: req.headers.get('x-forwarded-for'),
  })

  // Send via Twilio WhatsApp (template message — 24h-window-safe)
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM_NUMBER}`,
    To: `whatsapp:${phone}`,
    ContentSid: TWILIO_OTP_TEMPLATE_SID,
    ContentVariables: JSON.stringify({ '1': code }),
  })
  const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!twilioRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to send WhatsApp OTP', detail: await twilioRes.text() }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true, expires_in_seconds: 600 }), { status: 200 })
})

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}
```

## Edge function: whatsapp-otp-verify

```ts
// supabase/functions/whatsapp-otp-verify/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const { phone, code } = await req.json()
  if (!phone || !code || !/^\d{6}$/.test(code)) {
    return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Find pending OTP for this phone
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
    return new Response(JSON.stringify({ error: 'No pending OTP found or expired. Request a new one.' }), { status: 400 })
  }
  if (otp.attempts >= otp.max_attempts) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Request a new OTP.' }), { status: 429 })
  }

  const codeHash = await sha256(code + phone)
  if (codeHash !== otp.code_hash) {
    await supabase.from('whatsapp_otp_logs').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
    return new Response(JSON.stringify({ error: 'Invalid code' }), { status: 400 })
  }

  // Mark OTP used
  await supabase.from('whatsapp_otp_logs').update({ used_at: new Date().toISOString() }).eq('id', otp.id)

  // Find or create user by phone
  const { data: existingUser } = await supabase.auth.admin.listUsers()
  const user = existingUser?.users?.find(u => u.phone === phone)
  let userId: string
  if (user) {
    userId = user.id
  } else {
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      phone,
      phone_confirm: true,
      user_metadata: { source: 'whatsapp_otp' },
    })
    if (createErr || !newUser.user) {
      return new Response(JSON.stringify({ error: 'Failed to create user' }), { status: 500 })
    }
    userId = newUser.user.id
  }

  // Generate session
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: `${phone.replace(/[^0-9]/g, '')}@whatsapp.cropsintel.local`,  // synthetic email for magiclink-by-phone
    options: { redirectTo: `${Deno.env.get('SITE_URL')}/auth/callback` },
  })
  // For phone users, return tokens directly via createSession workaround — Supabase supports this via admin.createUser only
  // Simplified for v0.1: use generateLink and let frontend complete

  return new Response(JSON.stringify({
    success: true,
    user_id: userId,
    session: linkData?.properties,
  }), { status: 200 })
})

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}
```

## Frontend component (WhatsAppOtpForm.tsx)

Two-state form:
- State 1: phone input → "Send code"
- State 2: 6-digit code input → "Verify"

Uses shadcn/ui Input, Button, Alert. Phone validation E.164. Resend after 60s.

## Acceptance criteria

After this task ships:

1. Two edge functions deployed: whatsapp-otp-send, whatsapp-otp-verify
2. WhatsAppOtpForm renders, accepts E.164 phone, sends WhatsApp via Twilio
3. After OTP delivery, form prompts for 6-digit code
4. Verify creates session if code matches
5. Rate limiting: 5 attempts per OTP, 1 OTP per phone per 60s
6. `whatsapp_otp_logs` table populated with audit rows

## Required Supabase Edge Function secrets (user adds)

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` (the registered Maxons Zyra number `+12345622692` — for CUSTOMER auth, separate from Atlas number)
- `TWILIO_OTP_TEMPLATE_SID` (a template approved with body like "Your CropsIntel verification code: {{1}}")
- `SITE_URL` = `https://muzammil691.github.io/cropsintel-v3`

Document in `.agent/questions/phase-1.3d-q.md`.

## Out of scope

- WhatsApp template approval (user does on Twilio Console)
- SMS fallback if WhatsApp fails (Phase 2)
- One-tap OTP read on mobile (PWA limitation)

## Notes

- For CUSTOMER auth (this), use the registered Zyra number `+12345622692` — same number that powers Zyra customer chat
- Atlas's separate dev-time number `+19862022080` is NOT for customer auth
- Synthetic email `<digits>@whatsapp.cropsintel.local` lets Supabase's email-based session cleanly handle phone-only users
- Rate limit per IP+phone to prevent abuse
