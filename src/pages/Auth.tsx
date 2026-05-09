// Phase 1.3a — V3 unified auth page.
//
// Replaces the 91-line stub with the four-method auth UI specified by V3
// instructions: Email + Password, Email OTP, WhatsApp + Password, WhatsApp OTP.
// Below the tabs, V1/V2 visitors get a SetPassword link. Atlas operators still
// reach their cockpit login via /atlas/login (a separate flow).

import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { ShieldCheck, Mail, KeyRound, MessageSquare, Smartphone } from 'lucide-react'
import { drAtlas } from '@/lib/drAtlas'
import { EmailPasswordForm } from '@/components/auth/EmailPasswordForm'
import { EmailOTPForm } from '@/components/auth/EmailOTPForm'
import { WhatsAppPasswordForm } from '@/components/auth/WhatsAppPasswordForm'
import { WhatsAppOtpForm } from '@/components/auth/WhatsAppOtpForm'

type Method = 'email-password' | 'email-otp' | 'wa-password' | 'wa-otp'

const TABS: Array<{ id: Method; label: string; icon: typeof Mail }> = [
  { id: 'email-password', label: 'Email + Password', icon: Mail },
  { id: 'email-otp', label: 'Email OTP', icon: KeyRound },
  { id: 'wa-password', label: 'WhatsApp + Password', icon: MessageSquare },
  { id: 'wa-otp', label: 'WhatsApp OTP', icon: Smartphone },
]

export default function Auth() {
  const [method, setMethod] = useState<Method>('email-password')

  useEffect(() => {
    drAtlas.log('feature_mount', 'ui', 'auth')
  }, [])

  return (
    <>
      <Helmet>
        <title>Sign in — CropsIntel</title>
      </Helmet>
      <main className="min-h-screen bg-linear-to-b from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-slate-950 px-4 py-10 sm:py-16">
        <div className="mx-auto max-w-xl space-y-6">
          <header className="text-center space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Sign in to CropsIntel
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Pick a sign-in method. New here? Create an account from any tab.
            </p>
          </header>

          <div
            role="tablist"
            aria-label="Sign-in method"
            className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 p-1.5"
          >
            {TABS.map((t) => {
              const Icon = t.icon
              const active = method === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`auth-tab-${t.id}`}
                  onClick={() => setMethod(t.id)}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors duration-150 ' +
                    (active
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900')
                  }
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="text-center leading-tight">{t.label}</span>
                </button>
              )
            })}
          </div>

          <section
            role="tabpanel"
            aria-label={TABS.find((t) => t.id === method)?.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 sm:p-6"
          >
            {method === 'email-password' && <EmailPasswordForm />}
            {method === 'email-otp' && <EmailOTPForm />}
            {method === 'wa-password' && <WhatsAppPasswordForm />}
            {method === 'wa-otp' && <WhatsAppOtpForm />}
          </section>

          <div className="text-center text-xs text-slate-500 space-y-2">
            <p>
              First time? V1 or V2 user?{' '}
              <Link to="/set-password" className="text-emerald-700 dark:text-emerald-400 hover:underline">
                Set a V3 password →
              </Link>
            </p>
            <Link
              to="/atlas/login"
              className="inline-block text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
            >
              Atlas operators sign in here →
            </Link>
          </div>

          <footer className="text-center text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-4 inline-flex flex-col gap-1 w-full">
            <span className="inline-flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3" aria-hidden />
              All authentication routes via the platform. AI keys never leave the server.
            </span>
            <Link to="/" className="underline hover:no-underline transition-all duration-150">
              ← Back to home
            </Link>
          </footer>
        </div>
      </main>
    </>
  )
}
