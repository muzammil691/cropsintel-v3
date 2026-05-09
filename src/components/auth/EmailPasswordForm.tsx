// Phase 1.3a — Email + password form (one of the 4 V3 login methods).
//
// Routes through Supabase email auth. On a "user not found" sign-in error we
// call the V1/V2 bridge — if the email is recognized we redirect to
// /set-password instead of failing. Sign-up creates a profile via the existing
// handle_new_user trigger.

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { checkBridge } from '@/lib/auth-bridge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function EmailPasswordForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'signin') {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
        if (signInErr) {
          if (/invalid login|user not found|invalid credentials/i.test(signInErr.message)) {
            const bridge = await checkBridge({ email })
            if (bridge.found && bridge.set_password_required) {
              navigate(`/set-password?email=${encodeURIComponent(email)}`)
              return
            }
          }
          throw signInErr
        }
        navigate(next, { replace: true })
      } else {
        const { error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { source: 'email_password' },
          },
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
    <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="ep-email" className="text-sm sm:text-base">Email</Label>
        <Input
          id="ep-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          className="w-full text-sm sm:text-base min-h-[44px]"
        />
      </div>
      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="ep-password" className="text-sm sm:text-base">Password</Label>
        <Input
          id="ep-password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          className="w-full text-sm sm:text-base min-h-[44px]"
        />
      </div>
      <Button
        type="submit"
        className="w-full min-h-[44px] text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3"
        disabled={loading || !email || !password}
      >
        {loading ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>
      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
          setError(null)
        }}
        className="w-full text-xs sm:text-sm text-slate-500 hover:underline transition-colors duration-200 min-h-[44px]"
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  )
}
