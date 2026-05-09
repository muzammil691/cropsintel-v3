// Phase 1.3a — V1/V2 user-bridge SetPassword page.
//
// When a returning V1/V2 user signs in for the first time on V3, the bridge
// edge function tells us we recognize them but they have no V3 password yet.
// This page collects a new password, signs them up via Supabase, and marks
// their bridge log row complete.

import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { checkBridge, type BridgeResult } from '@/lib/auth-bridge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function SetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialEmail = params.get('email') ?? ''
  const initialPhone = params.get('phone') ?? ''

  const [identifier, setIdentifier] = useState(initialEmail || initialPhone)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [bridge, setBridge] = useState<BridgeResult | null>(null)
  const [bridgeLoading, setBridgeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!initialEmail && !initialPhone) return
    let cancelled = false
    setBridgeLoading(true)
    checkBridge({
      email: initialEmail || undefined,
      phone: initialPhone || undefined,
    })
      .then((res) => {
        if (!cancelled) setBridge(res)
      })
      .finally(() => {
        if (!cancelled) setBridgeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [initialEmail, initialPhone])

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBridgeLoading(true)
    try {
      const isEmail = identifier.includes('@')
      const result = await checkBridge(
        isEmail ? { email: identifier } : { phone: identifier },
      )
      setBridge(result)
      if (!result.found) {
        setError("We don't recognize that email or phone as a V1/V2 user.")
      }
    } finally {
      setBridgeLoading(false)
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setSubmitting(true)
    try {
      const isEmail = identifier.includes('@')
      const { error: signUpErr } = await supabase.auth.signUp(
        isEmail
          ? { email: identifier, password, options: { data: { source: 'v1v2_bridge' } } }
          : { phone: identifier, password, options: { data: { source: 'v1v2_bridge' } } },
      )
      if (signUpErr) throw signUpErr
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Helmet>
        <title>Set your password — CropsIntel</title>
      </Helmet>
      <main className="min-h-screen bg-linear-to-b from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-slate-950 px-4 py-10 sm:py-16">
        <div className="mx-auto max-w-md space-y-6">
          <header className="text-center space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back to CropsIntel</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              We recognize V1 and V2 accounts. Set a new password to continue on V3.
            </p>
          </header>

          {!bridge?.found ? (
            <form
              onSubmit={lookup}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4"
            >
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="sp-id">Email or phone (with country code)</Label>
                <Input
                  id="sp-id"
                  type="text"
                  required
                  placeholder="you@example.com or +971501234567"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={bridgeLoading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={bridgeLoading || !identifier}>
                {bridgeLoading ? 'Checking…' : 'Look up my V1/V2 account'}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleSetPassword}
              className="rounded-xl border border-emerald-300/50 dark:border-emerald-700/50 bg-white dark:bg-slate-950 p-5 space-y-4"
            >
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Alert>
                <AlertDescription>
                  Found your{' '}
                  <strong>{bridge.legacy_source?.toUpperCase() ?? 'legacy'}</strong> account
                  {bridge.hint_email && (
                    <>
                      {' '}for <strong>{bridge.hint_email}</strong>
                    </>
                  )}
                  {bridge.hint_phone && !bridge.hint_email && (
                    <>
                      {' '}for <strong>{bridge.hint_phone}</strong>
                    </>
                  )}
                  . Set a password to finish migrating to V3.
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="sp-pw">New password</Label>
                <Input
                  id="sp-pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sp-pw2">Confirm password</Label>
                <Input
                  id="sp-pw2"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !password || !confirmPassword}
              >
                {submitting ? 'Setting password…' : 'Set password and continue'}
              </Button>
            </form>
          )}

          <footer className="text-center text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-4 inline-flex flex-col gap-1 w-full">
            <span className="inline-flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3" aria-hidden />
              We don't import V1/V2 passwords; you set a fresh one.
            </span>
            <Link to="/auth" className="underline hover:no-underline">
              ← Back to sign in
            </Link>
          </footer>
        </div>
      </main>
    </>
  )
}
