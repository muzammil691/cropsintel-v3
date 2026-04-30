import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sendSmsOtp, verifySmsOtp } from '@/lib/auth-phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

type Step = 'phone' | 'code'

const E164_REGEX = /^\+\d{6,16}$/
const RESEND_COOLDOWN_SECONDS = 60

export function PhoneOtpForm() {
  const navigate = useNavigate()
  const location = useLocation()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)

  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setTimeout(() => setResendCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  const handleSendCode = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!E164_REGEX.test(phone)) {
      setError('Enter a valid international number, e.g. +971501234567')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await sendSmsOtp(phone)
      setStep('code')
      setResendCountdown(RESEND_COOLDOWN_SECONDS)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }, [phone])

  const handleVerifyCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code sent via SMS')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await verifySmsOtp(phone, code)
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/'
      navigate(from, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }, [phone, code, location.state, navigate])

  if (step === 'phone') {
    return (
      <form onSubmit={handleSendCode} className="space-y-4 w-full max-w-sm">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="sms-phone">Phone number</Label>
          <Input
            id="sms-phone"
            type="tel"
            autoComplete="tel"
            placeholder="+971501234567"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value.trim())}
            disabled={loading}
          />
          <p className="text-xs text-slate-500">We'll text you a 6-digit code. Include country code, e.g. +971 for UAE.</p>
        </div>
        <Button type="submit" className="w-full" disabled={loading || !phone}>
          {loading ? 'Sending…' : 'Send SMS code'}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleVerifyCode} className="space-y-4 w-full max-w-sm">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Alert>
        <AlertDescription>
          A 6-digit code was sent to <strong>{phone}</strong> via SMS. It expires in 10 minutes.
        </AlertDescription>
      </Alert>
      <div className="space-y-2">
        <Label htmlFor="sms-code">6-digit code</Label>
        <Input
          id="sms-code"
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
        {loading ? 'Verifying…' : 'Verify and sign in'}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-slate-500 hover:underline disabled:opacity-50 disabled:no-underline"
          disabled={resendCountdown > 0 || loading}
          onClick={() => handleSendCode()}
        >
          {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
        </button>
        <button
          type="button"
          className="text-slate-500 hover:underline"
          onClick={() => { setStep('phone'); setCode(''); setError(null) }}
        >
          Change number
        </button>
      </div>
    </form>
  )
}
