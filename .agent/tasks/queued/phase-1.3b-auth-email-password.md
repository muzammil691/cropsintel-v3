# Task: Phase 1.3b — Email/password authentication

**Master plan reference:** §11.2 Phase 1.3 — login method 1 of 4
**Context:** Standard email + password sign-in/sign-up using Supabase Auth. First login method to ship; the others (Google, WhatsApp OTP, phone OTP) follow in 1.3c-1.3e. Depends on 1.3a (auth foundation).
**Estimated effort:** ~30 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Wire Supabase Auth email/password flows + components for sign-up, sign-in, password reset.

## Files to create

```
src/lib/auth-email.ts                 # signIn, signUp, resetPassword helpers
src/components/auth/EmailLoginForm.tsx
src/components/auth/EmailSignUpForm.tsx
src/components/auth/ForgotPasswordForm.tsx
src/components/auth/ResetPasswordForm.tsx  # for the link target
```

## src/lib/auth-email.ts

```ts
import { supabase } from './supabase'
import type { LoginMethod } from '@/types/auth'

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUpWithEmail(email: string, password: string, metadata?: Record<string, unknown>) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/cropsintel-v3/login`,
      data: { source: 'email', ...metadata },
    },
  })
  if (error) throw error
  return data
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/cropsintel-v3/reset-password`,
  })
  if (error) throw error
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
```

## EmailLoginForm.tsx (uses shadcn/ui)

```tsx
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { signInWithEmail } from '@/lib/auth-email'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function EmailLoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signInWithEmail(email, password)
      const from = (location.state as any)?.from?.pathname ?? '/'
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err.message ?? 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} disabled={loading} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} disabled={loading} />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !email || !password}>
        {loading ? 'Signing in…' : 'Sign in'}
      </Button>
      <div className="text-sm text-center text-slate-500">
        <a href="/cropsintel-v3/forgot-password" className="hover:underline">Forgot password?</a>
      </div>
    </form>
  )
}
```

## EmailSignUpForm.tsx

Similar structure to EmailLoginForm but calls `signUpWithEmail()`. After successful sign-up, show "Check your email to confirm." Persist optimistic profile data (display_name) to be merged on first login.

## ForgotPasswordForm.tsx

Single email field. On submit, call `sendPasswordReset(email)`. Show success message.

## ResetPasswordForm.tsx

Loaded when user clicks the email link. Reads `?type=recovery` from URL, lets user set new password via `updatePassword()`. After success, redirect to login.

## Acceptance criteria

After this task ships:

1. EmailLoginForm renders, accepts email+password, calls Supabase Auth, redirects on success
2. EmailSignUpForm creates a new user; verification email sent
3. ForgotPasswordForm sends reset email
4. ResetPasswordForm updates password from email link
5. All forms use shadcn/ui Button, Input, Label, Alert
6. All states have proper loading/disabled/error UX
7. Form fields have proper autoComplete hints (email, current-password, new-password)
8. `npm run build` succeeds

## Design system requirements (Designer agent will audit)

- All inputs use `<Input>` from `@/components/ui/input`, never raw `<input>`
- Buttons use `<Button>` with appropriate variants (default for primary, ghost for "forgot password" link styled as button)
- Error states use `<Alert variant="destructive">`
- Loading states have visible affordance ("Signing in…" text, disabled button)
- Form max width: `max-w-sm` (~24rem) — readable on mobile and desktop
- Tab order: email → password → submit → forgot password link
- Focus ring: shadcn defaults (don't override)

## Out of scope

- Google OAuth (1.3c)
- WhatsApp OTP (1.3d)
- Phone OTP (1.3e)
- Multi-factor (Phase 2)
- Magic link (defer)

## Notes

- Supabase Auth handles password hashing — never store raw passwords
- emailRedirectTo MUST match GitHub Pages deploy path or auth redirects break
- Rate limiting on signIn handled by Supabase (5 attempts per email per 15 min default)
