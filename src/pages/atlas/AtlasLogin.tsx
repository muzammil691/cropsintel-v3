// Phase 1.10aj — Atlas WhatsApp-OTP login page.
//
// Two-step UX: enter phone → request OTP via /atlas/auth/request-otp; enter
// the 6-digit code → /atlas/auth/verify-otp returns an opaque session token
// that we persist to localStorage. AtlasAuthGuard validates that token on
// every page mount via /atlas/auth/me.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ATLAS_SESSION_TOKEN_KEY,
  requestAtlasOtp,
  verifyAtlasOtp,
} from '@/lib/atlas-client'

const DEFAULT_PHONE = '+971562556592'
const RESEND_COOLDOWN_SEC = 30
const OTP_LENGTH = 6

export default function AtlasLogin() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState(DEFAULT_PHONE)
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [digits, setDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  // If a session token is already stored, hop straight to the dashboard.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(ATLAS_SESSION_TOKEN_KEY)) {
      navigate('/atlas', { replace: true })
    }
  }, [navigate])

  // Resend cooldown ticker — once per second, decrement to zero.
  useEffect(() => {
    if (resendCountdown <= 0) return
    const t = window.setTimeout(() => setResendCountdown((n) => Math.max(0, n - 1)), 1000)
    return () => window.clearTimeout(t)
  }, [resendCountdown])

  // When stage flips to 'code', focus the first input.
  useEffect(() => {
    if (stage === 'code') {
      const first = inputRefs.current[0]
      first?.focus()
    }
  }, [stage])

  async function handleRequestOtp() {
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      await requestAtlasOtp(phone.trim())
      setStage('code')
      setDigits(Array(OTP_LENGTH).fill(''))
      setInfo('We sent the code via WhatsApp. It usually arrives in 5–30 seconds.')
      setResendCountdown(RESEND_COOLDOWN_SEC)
    } catch (err) {
      setError(humanError(err, 'Could not send the code. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify(submittedCode?: string) {
    const code = (submittedCode ?? digits.join('')).trim()
    if (code.length !== OTP_LENGTH) {
      setError('Enter all 6 digits.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const { token } = await verifyAtlasOtp(phone.trim(), code)
      window.localStorage.setItem(ATLAS_SESSION_TOKEN_KEY, token)
      navigate('/atlas', { replace: true })
    } catch (err) {
      setError(humanError(err, 'Verification failed. Try the code again or request a new one.'))
      setDigits(Array(OTP_LENGTH).fill(''))
      inputRefs.current[0]?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  function setDigit(index: number, raw: string) {
    // Pasting the full code into any field should just work.
    const trimmed = raw.replace(/\D/g, '')
    if (trimmed.length > 1) {
      const next = trimmed.slice(0, OTP_LENGTH).padEnd(OTP_LENGTH, '').split('')
      const filled = Array.from({ length: OTP_LENGTH }, (_, i) => next[i] ?? '')
      setDigits(filled)
      const lastFilled = Math.min(trimmed.length, OTP_LENGTH) - 1
      const focusIdx = Math.max(0, Math.min(OTP_LENGTH - 1, lastFilled + 1))
      inputRefs.current[focusIdx]?.focus()
      if (trimmed.length >= OTP_LENGTH) {
        void handleVerify(filled.join(''))
      }
      return
    }
    const ch = trimmed.slice(0, 1)
    setDigits((prev) => {
      const copy = [...prev]
      copy[index] = ch
      return copy
    })
    if (ch && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
    // Auto-submit when the user fills the last digit.
    if (ch && index === OTP_LENGTH - 1) {
      const filled = digits.map((d, i) => (i === index ? ch : d))
      if (filled.every((d) => d.length === 1)) {
        void handleVerify(filled.join(''))
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Atlas — Sign in</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {stage === 'phone'
              ? 'Enter your phone number; we will WhatsApp you a 6-digit code.'
              : `We sent a code to ${phone}. Enter it below.`}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage === 'phone' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="atlas-login-phone">Phone</Label>
                <Input
                  id="atlas-login-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRequestOtp()
                  }}
                  disabled={submitting}
                />
              </div>
              <Button
                type="button"
                onClick={() => void handleRequestOtp()}
                disabled={submitting || !phone.trim()}
                className="w-full"
              >
                {submitting ? 'Sending…' : 'Send code via WhatsApp'}
              </Button>
            </>
          )}

          {stage === 'code' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="atlas-login-otp-0">6-digit code</Label>
                <div className="flex gap-2 justify-between" role="group" aria-label="One-time code">
                  {digits.map((d, i) => (
                    <Input
                      key={i}
                      id={`atlas-login-otp-${i}`}
                      ref={(el) => { inputRefs.current[i] = el }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={i === 0 ? 'one-time-code' : 'off'}
                      maxLength={OTP_LENGTH}
                      value={d}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, i)}
                      disabled={submitting}
                      className="text-center text-lg font-mono tabular-nums"
                      aria-label={`Digit ${i + 1}`}
                    />
                  ))}
                </div>
              </div>

              <Button
                type="button"
                onClick={() => void handleVerify()}
                disabled={submitting || digits.some((d) => !d)}
                className="w-full"
              >
                {submitting ? 'Verifying…' : 'Verify'}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={() => {
                    setStage('phone')
                    setDigits(Array(OTP_LENGTH).fill(''))
                    setError(null)
                    setInfo(null)
                  }}
                  disabled={submitting}
                >
                  Use a different number
                </button>
                <button
                  type="button"
                  className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={() => void handleRequestOtp()}
                  disabled={submitting || resendCountdown > 0}
                >
                  {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}

          {info && !error && (
            <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
              {info}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function humanError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes('phone_not_allowed')) return 'This phone is not authorized to sign in to Atlas.'
  if (msg.includes('rate_limited')) return 'Too many code requests. Wait 15 minutes and try again.'
  if (msg.includes('too_many_attempts')) return 'Too many wrong attempts. Request a new code.'
  if (msg.includes('invalid_credentials')) return 'That code is wrong or expired. Try again or request a new one.'
  if (msg.includes('whatsapp_send_failed')) return 'WhatsApp could not deliver the code. Try again in a moment.'
  if (msg.toLowerCase().includes('failed to fetch')) return 'Cannot reach Atlas. Check your connection.'
  return fallback
}
