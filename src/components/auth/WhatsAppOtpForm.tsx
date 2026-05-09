// Phase 1.3a — WhatsApp OTP form (one of the 4 V3 login methods).
//
// Calls the V3-named whatsapp-send-otp / whatsapp-verify-otp edge functions.
// Country-code dropdown builds the E.164 number; verify exchanges the magic
// link for a Supabase session via auth.verifyOtp. Replaces the earlier
// 1.3d implementation in place per the anti-restart rule.

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE } from '@/data/countryCodes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const RESEND_COOLDOWN = 60

export function WhatsAppOtpForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [dialCode, setDialCode] = useState(DEFAULT_COUNTRY_CODE.dialCode)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const fullPhone = `${dialCode}${phone.replace(/\D/g, '')}`

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!/^\+\d{6,16}$/.test(fullPhone)) {
      setError('Enter a valid phone number')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/whatsapp-send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to send code')
      setStep('code')
      setCooldown(RESEND_COOLDOWN)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from WhatsApp')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/whatsapp-verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Verification failed')

      if (data.hashed_token && data.email) {
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          email: data.email,
          token: data.hashed_token,
          type: 'magiclink',
        })
        if (verifyErr) throw verifyErr
      }

      if (data.bridge?.found && data.bridge?.set_password_required) {
        navigate(`/set-password?phone=${encodeURIComponent(fullPhone)}`)
        return
      }

      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
      navigate(from ?? next, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'phone') {
    return (
      <form onSubmit={handleSend} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="wo-phone">WhatsApp number</Label>
          <div className="flex gap-2">
            <Select
              value={dialCode}
              onChange={(e) => setDialCode(e.target.value)}
              disabled={loading}
              className="w-28"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.dialCode}>
                  {c.code} {c.dialCode}
                </option>
              ))}
            </Select>
            <Input
              id="wo-phone"
              type="tel"
              autoComplete="tel-national"
              placeholder="501234567"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
              className="flex-1"
            />
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={loading || !phone}>
          {loading ? 'Sending…' : 'Send OTP via WhatsApp'}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Alert>
        <AlertDescription>
          A 6-digit code was sent to <strong>{fullPhone}</strong> on WhatsApp. Codes expire in 10 minutes.
        </AlertDescription>
      </Alert>
      <div className="space-y-2">
        <Label htmlFor="wo-code">6-digit code</Label>
        <Input
          id="wo-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="123456"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={loading}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
        {loading ? 'Verifying…' : 'Verify'}
      </Button>
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="text-slate-500 hover:underline disabled:opacity-50 disabled:no-underline"
          disabled={cooldown > 0 || loading}
          onClick={() => handleSend()}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
        <button
          type="button"
          className="text-slate-500 hover:underline"
          onClick={() => {
            setStep('phone')
            setCode('')
            setError(null)
          }}
        >
          Change number
        </button>
      </div>
    </form>
  )
}
