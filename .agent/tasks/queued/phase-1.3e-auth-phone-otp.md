# Task: Phase 1.3e — Phone (SMS) OTP login

**Master plan reference:** §11.2 Phase 1.3 — login method 4 of 4
**Context:** Same UX as WhatsApp OTP but via SMS for users who don't have WhatsApp or are in regions where WhatsApp Business doesn't work well. Uses Supabase Auth's built-in phone OTP (Twilio under the hood). Depends on 1.3a.
**Estimated effort:** ~20 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Wire Supabase Auth's built-in `signInWithOtp({phone})` and `verifyOtp({phone, token, type:'sms'})` for SMS-based authentication. Simpler than WhatsApp because Supabase has it built in.

## Files to create

```
src/lib/auth-phone.ts
src/components/auth/PhoneOtpForm.tsx
```

## src/lib/auth-phone.ts

```ts
import { supabase } from './supabase'

export async function sendSmsOtp(phone: string) {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { channel: 'sms' },
  })
  if (error) throw error
}

export async function verifySmsOtp(phone: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  })
  if (error) throw error
  return data
}
```

## PhoneOtpForm.tsx

Two-state form (same UX as WhatsApp OTP):

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendSmsOtp, verifySmsOtp } from '@/lib/auth-phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function PhoneOtpForm() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (!/^\+\d{6,16}$/.test(phone)) throw new Error('Use E.164 format like +971501234567')
      await sendSmsOtp(phone)
      setStep('code')
      startResendCountdown()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await verifySmsOtp(phone, code)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function startResendCountdown() {
    setResendIn(60)
    const interval = setInterval(() => {
      setResendIn(prev => {
        if (prev <= 1) { clearInterval(interval); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  return (
    <form onSubmit={step === 'phone' ? handleSendOtp : handleVerify} className="space-y-4 w-full max-w-sm">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {step === 'phone' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" type="tel" placeholder="+971501234567" autoComplete="tel" required
              value={phone} onChange={e => setPhone(e.target.value)} disabled={loading} />
            <p className="text-xs text-slate-500">We'll text you a 6-digit code.</p>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending…' : 'Send SMS code'}
          </Button>
        </>
      )}
      {step === 'code' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="code">6-digit code</Label>
            <Input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} disabled={loading} />
          </div>
          <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
            {loading ? 'Verifying…' : 'Verify and sign in'}
          </Button>
          <div className="text-sm text-center text-slate-500 space-y-1">
            <button type="button" onClick={() => setStep('phone')} className="hover:underline">
              Use a different number
            </button>
            <div>
              {resendIn > 0 ? `Resend code in ${resendIn}s` :
                <button type="button" onClick={() => handleSendOtp({ preventDefault: () => {} } as any)} className="hover:underline">
                  Resend code
                </button>}
            </div>
          </div>
        </>
      )}
    </form>
  )
}
```

## Supabase config

Supabase Dashboard → Authentication → Providers → Phone:
- Enable Phone provider
- SMS provider: Twilio (already configured for WhatsApp, same account)
- From number: a separate SMS-capable Twilio number (or reuse WhatsApp one if SMS-enabled)

## Acceptance criteria

After this task ships:

1. PhoneOtpForm renders with phone-step → code-step flow
2. Send OTP via SMS (Supabase's built-in flow)
3. Verify OTP creates session and redirects
4. Resend cooldown (60s)
5. inputMode="numeric" for keyboard-friendly mobile
6. autoComplete="one-time-code" lets iOS auto-fill the OTP from SMS

## Out of scope

- WhatsApp variant (1.3d, separate)
- Voice call OTP (defer)
- 2FA combining email + OTP (Phase 2)

## Notes

- Supabase Auth's built-in phone provider uses Twilio Verify or direct Messages API depending on config
- For Twilio Verify: enable "Verify Service" in Supabase config
- E.164 format strictly enforced
- Phone OTP is the SECOND-fastest sign-in method after Google (~30-60s end to end)
