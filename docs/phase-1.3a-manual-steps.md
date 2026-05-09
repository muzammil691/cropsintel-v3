# Phase 1.3a — manual steps (Muzammil-side)

The autonomous Builder cannot perform Supabase dashboard actions or apply
migrations. After the spec lands, run these manually before the verified-tier
workflow can be exercised end-to-end.

## 1. Apply the new migration

```
npx supabase db push
```

Migration: `supabase/migrations/20260509100000_phase_1_3a_auth_foundation.sql`

This extends `profiles`, extends `verification_requests`, and creates two new
tables (`guest_sessions`, `auth_bridge_log`).

## 2. Regenerate database types

```
npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb > src/lib/database.types.ts
```

The Builder hand-extended `database.types.ts` so the build passes; replacing it
with a regen'd file keeps the schema-truth single source on the Supabase side.

## 3. Enable Supabase phone auth provider (one-time)

Supabase dashboard → Authentication → Providers → Phone → Enable.

Add the following Twilio credentials inside the provider config:

- Account SID
- Auth Token
- Twilio number (E.164 — same number used for WhatsApp)

This unlocks the **WhatsApp + Password** form (Supabase phone auth provider).

## 4. Set Supabase secrets for the WhatsApp OTP edge functions

```
npx supabase secrets set \
  TWILIO_ACCOUNT_SID=<sid> \
  TWILIO_AUTH_TOKEN=<token> \
  TWILIO_WHATSAPP_FROM=<+15551234567>
```

If you already use a content template (`HX...`):
```
npx supabase secrets set TWILIO_OTP_TEMPLATE_SID=<HX...>
```

## 5. Deploy the new edge functions

```
npx supabase functions deploy whatsapp-send-otp
npx supabase functions deploy whatsapp-verify-otp
npx supabase functions deploy auth-bridge
```

## 6. Verify locally

Sign in via each of the four methods on `http://localhost:5173/auth`:

- Email + Password
- Email OTP
- WhatsApp + Password
- WhatsApp OTP

Then sign in as a Maxons admin and confirm `http://localhost:5173/admin/verified-queue`
loads with the queue, accepts assignment, persists checklist edits, and supports
approve/reject.

## 7. Optional — backfill V1/V2 legacy users

If `legacy_users` is empty, seed it with the V1 + V2 export so the auth-bridge
edge function has data to match against. See `.agent/questions/phase-1.3f-q.md`
for the original loader script.
