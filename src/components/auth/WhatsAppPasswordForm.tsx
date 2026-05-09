// Phase 1.3a — WhatsApp + password form (one of the 4 V3 login methods).
//
// Uses Supabase phone auth with an explicit password. Country-code dropdown
// builds the E.164 number; phone auth provider must be enabled in the Supabase
// dashboard with Twilio creds (see docs/phase-1.3a-manual-steps.md).

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { checkBridge } from '@/lib/auth-bridge'
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE } from '@/data/countryCodes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function WhatsAppPasswordForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [dialCode, setDialCode] = useState(DEFAULT_COUNTRY_CODE.dialCode)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fullPhone = `${dialCode}${phone.replace(/\D/g, '')}`

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\+\d{6,16}$/.test(fullPhone)) {
      setError('Enter a valid phone number')
      return
    }
    setLoading(true)
    try {
      if (mode === 'signin') {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          phone: fullPhone,
          password,
        })
        if (signInErr) {
          if (/invalid login|user not found|invalid credentials/i.test(signInErr.message)) {
            const bridge = await checkBridge({ phone: fullPhone })
            if (bridge.found && bridge.set_password_required) {
              navigate(`/set-password?phone=${encodeURIComponent(fullPhone)}`)
              return
            }
          }
          throw signInErr
        }
        navigate(next, { replace: true })
      } else {
        const { error: signUpErr } = await supabase.auth.signUp({
          phone: fullPhone,
          password,
          options: { data: { source: 'whatsapp_password', whatsapp_number: fullPhone } },
        })
        if (signUpErr) throw signUpErr
        navigate('/dashboard', { replace: true })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="wp-phone">WhatsApp number</Label>
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
            id="wp-phone"
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
      <div className="space-y-2">
        <Label htmlFor="wp-password">Password</Label>
        <Input
          id="wp-password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !phone || !password}>
        {loading ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>
      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
          setError(null)
        }}
        className="w-full text-xs text-slate-500 hover:underline"
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  )
}
