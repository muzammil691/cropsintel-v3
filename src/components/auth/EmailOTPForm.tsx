// Phase 1.3a — Email OTP form (one of the 4 V3 login methods).
//
// Uses Supabase's built-in email OTP (signInWithOtp + verifyOtp). Two-step:
// (1) collect email and trigger send, (2) collect 6-digit code and verify.

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { checkBridge } from '@/lib/auth-bridge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function EmailOTPForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error: sendErr } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      })
      if (sendErr) throw sendErr
      setStep('code')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      })
      if (verifyErr) {
        if (/invalid|expired/i.test(verifyErr.message)) {
          const bridge = await checkBridge({ email })
          if (bridge.found && bridge.set_password_required) {
            navigate(`/set-password?email=${encodeURIComponent(email)}`)
            return
          }
        }
        throw verifyErr
      }
      navigate(next, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={handleSendOtp} className="space-y-3 sm:space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5 sm:space-y-2">
          <Label htmlFor="eo-email" className="text-sm sm:text-base">Email</Label>
          <Input
            id="eo-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="w-full text-sm sm:text-base min-h-[44px]"
          />
          <p className="text-xs text-slate-500">We'll email you a 6-digit code.</p>
        </div>
        <Button
          type="submit"
          className="w-full min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3"
          disabled={loading || !email}
        >
          {loading ? 'Sending…' : 'Send code'}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleVerify} className="space-y-3 sm:space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Alert>
        <AlertDescription>
          A 6-digit code was sent to <strong>{email}</strong>. Codes expire in 10 minutes.
        </AlertDescription>
      </Alert>
      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="eo-code" className="text-sm sm:text-base">6-digit code</Label>
        <Input
          id="eo-code"
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
          className="w-full text-sm sm:text-base min-h-[44px]"
        />
      </div>
      <Button
        type="submit"
        className="w-full min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3"
        disabled={loading || code.length !== 6}
      >
        {loading ? 'Verifying…' : 'Verify and sign in'}
      </Button>
      <button
        type="button"
        onClick={() => {
          setStep('email')
          setCode('')
          setError(null)
        }}
        className="w-full text-xs sm:text-sm text-slate-500 hover:underline transition-colors duration-200 min-h-[44px]"
      >
        Use a different email
      </button>
    </form>
  )
}
