# Task: Phase 1.3g — Login / Signup / Forgot password pages (UI)

**Master plan reference:** §11.2 Phase 1.3 — UI surface for the 4 auth methods
**Context:** The actual pages users land on. Login page lets them choose between 4 methods (email, Google, WhatsApp OTP, SMS OTP). Sign-up page mirrors. Forgot/reset password page for email flow. Depends on 1.3a, 1.3b, 1.3c, 1.3d, 1.3e.
**Estimated effort:** ~30 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Production-quality auth pages with method tabs, brand-consistent shadcn/ui design, mobile responsive, accessible.

## Files to create

```
src/pages/Login.tsx
src/pages/SignUp.tsx
src/pages/ForgotPassword.tsx
src/pages/ResetPassword.tsx
src/pages/Upgrade.tsx                    # shown when user lacks required tier
src/components/auth/AuthLayout.tsx       # shared layout wrapper for all auth pages
src/components/auth/MethodTabs.tsx       # tab strip: Email | Google | WhatsApp | SMS
```

## Design contract (Designer agent will audit — strict)

- **Background:** subtle gradient `bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950`
- **Card:** centered, max-w-md, p-8, shadow-xl, rounded-2xl, white background, no border
- **Logo:** "CropsIntel" wordmark in emerald-700, text-2xl font-bold above card
- **Heading:** h1 text-2xl tracking-tight font-semibold
- **Subtitle:** text-sm text-slate-500 below heading
- **Method tabs:** segmented control style, full-width, 4 equal segments
- **Form spacing:** space-y-4 between groups, space-y-2 between Label and Input
- **Submit button:** w-full, primary variant, h-11
- **Divider** ("or"): horizontal line with "or continue with" text in slate-400
- **Footer:** "Don't have an account? Sign up →" link in emerald-700
- **Mobile:** padding 4 instead of 8, full-width below sm

## src/components/auth/AuthLayout.tsx

```tsx
import { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  children: ReactNode
  title: string
  subtitle?: string
  footerText?: string
  footerLink?: { to: string; label: string }
}

export function AuthLayout({ children, title, subtitle, footerText, footerLink }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <Link to="/" className="text-2xl font-bold text-emerald-700 dark:text-emerald-500 mb-6 hover:opacity-90 transition-opacity">
        CropsIntel
      </Link>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl tracking-tight font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footerText && footerLink && (
        <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">
          {footerText}{' '}
          <Link to={footerLink.to} className="text-emerald-700 dark:text-emerald-500 font-medium hover:underline">
            {footerLink.label}
          </Link>
        </p>
      )}
    </div>
  )
}
```

## src/components/auth/MethodTabs.tsx

```tsx
import { useState, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Method = 'email' | 'google' | 'whatsapp' | 'sms'

interface Props {
  defaultMethod?: Method
  methods: Record<Method, ReactNode>  // each method's form
}

const LABELS: Record<Method, string> = {
  email: 'Email',
  google: 'Google',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
}

export function MethodTabs({ defaultMethod = 'email', methods }: Props) {
  const [active, setActive] = useState<Method>(defaultMethod)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
        {(Object.keys(LABELS) as Method[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setActive(m)}
            className={cn(
              'h-9 rounded-md text-sm font-medium transition-all',
              active === m
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900',
            )}
            aria-pressed={active === m}
          >
            {LABELS[m]}
          </button>
        ))}
      </div>
      <div className="pt-2">{methods[active]}</div>
    </div>
  )
}
```

## src/pages/Login.tsx

```tsx
import { AuthLayout } from '@/components/auth/AuthLayout'
import { MethodTabs } from '@/components/auth/MethodTabs'
import { EmailLoginForm } from '@/components/auth/EmailLoginForm'
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton'
import { WhatsAppOtpForm } from '@/components/auth/WhatsAppOtpForm'
import { PhoneOtpForm } from '@/components/auth/PhoneOtpForm'

export default function Login() {
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to access market intelligence"
      footerText="Don't have an account?"
      footerLink={{ to: '/signup', label: 'Sign up' }}
    >
      <MethodTabs
        methods={{
          email: <EmailLoginForm />,
          google: <div className="space-y-3"><GoogleLoginButton /><p className="text-xs text-slate-500 text-center">Fastest sign-in — uses your Google account</p></div>,
          whatsapp: <WhatsAppOtpForm />,
          sms: <PhoneOtpForm />,
        }}
      />
    </AuthLayout>
  )
}
```

## src/pages/SignUp.tsx

Same as Login but with EmailSignUpForm in email tab, "Already have an account? Sign in" footer.

## src/pages/ForgotPassword.tsx

```tsx
import { AuthLayout } from '@/components/auth/AuthLayout'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export default function ForgotPassword() {
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to reset it"
      footerText="Remember your password?"
      footerLink={{ to: '/login', label: 'Back to sign in' }}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  )
}
```

## src/pages/ResetPassword.tsx

Reads ?type=recovery from URL, lets user set new password.

## src/pages/Upgrade.tsx

Shown when user lacks the required tier. Displays:
- Current tier badge
- Required tier explanation
- "Request verification" button (sends to admin queue — Phase 1.11b builds the actual queue UI)
- Contact link

## Acceptance criteria

After this task ships:

1. `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/upgrade` routes registered in App.tsx
2. Login page shows 4 method tabs, each functional
3. Sign-up page mirrors with email-focus
4. Forgot password sends email
5. All pages mobile-responsive (test 375px)
6. Pages render with brand gradient + emerald-700 wordmark
7. Tab focus management correct (Tab key cycles inputs, Shift+Tab reverses)
8. Page titles set via `<title>` (use `useEffect` to update document.title)
9. `npm run build` succeeds

## Designer agent will audit (strict)

The Designer agent (1.10n) reviews this commit. Anti-patterns it will FAIL:
- Hex colors anywhere (must use Tailwind tokens)
- Raw `<button>` without shadcn/ui
- Missing focus-visible rings
- Mobile not tested at 375px
- Multiple `<h1>` per page
- Form max width > sm (768px) on desktop

## Out of scope

- "Stay signed in" checkbox (Supabase handles automatically)
- Social proof / testimonials on auth pages (Phase 2)
- Animated transitions between method tabs (CSS transition is enough)
- Onboarding flow after first sign-up (Phase 2)

## Notes

- Tab focus reset on switch: focus the first input of the new method's form
- Color tokens stay strict: emerald-* for brand, slate-* for neutrals
- Cards have rounded-2xl (16px) — softer than typical, signature CropsIntel feel
- Background gradient is subtle — never overwhelming
