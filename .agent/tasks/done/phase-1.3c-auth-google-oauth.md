# Task: Phase 1.3c — Google OAuth login

**Master plan reference:** §11.2 Phase 1.3 — login method 2 of 4
**Context:** OAuth via Google using Supabase Auth's built-in provider. Users can sign in with their Google account. Depends on 1.3a (auth foundation).
**Estimated effort:** ~20 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Add a "Continue with Google" button that triggers Supabase Auth's OAuth flow via Google.

## Files to create

```
src/lib/auth-google.ts                  # signInWithGoogle helper
src/components/auth/GoogleLoginButton.tsx
```

## src/lib/auth-google.ts

```ts
import { supabase } from './supabase'

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/cropsintel-v3/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })
  if (error) throw error
  return data
}
```

## src/components/auth/GoogleLoginButton.tsx

```tsx
import { useState } from 'react'
import { signInWithGoogle } from '@/lib/auth-google'
import { Button } from '@/components/ui/button'

export function GoogleLoginButton({ label = 'Continue with Google' }: { label?: string }) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      await signInWithGoogle()
      // OAuth redirects away; we won't reach here on success
    } catch (err) {
      console.error('Google sign-in failed:', err)
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" className="w-full gap-2" onClick={handleClick} disabled={loading}>
      <GoogleIcon className="h-4 w-4" />
      {loading ? 'Connecting…' : label}
    </Button>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}
```

## Auth callback route

In `src/App.tsx`, add a callback route:

```tsx
<Route path="/auth/callback" element={<AuthCallback />} />
```

`src/pages/AuthCallback.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { LoadingScreen } from '@/components/auth/LoadingScreen'

export default function AuthCallback() {
  const navigate = useNavigate()
  useEffect(() => {
    // Supabase Auth handles the URL hash automatically via detectSessionInUrl
    // We just need to wait for it and redirect
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/', { replace: true })
      }
    })
    // Safety: redirect after 5s if nothing happens
    const t = setTimeout(() => navigate('/login?error=oauth_timeout'), 5000)
    return () => { subscription.unsubscribe(); clearTimeout(t) }
  }, [navigate])
  return <LoadingScreen />
}
```

## Supabase configuration (user does manually after this ships)

User must enable Google provider in Supabase dashboard:
1. Supabase Dashboard → Authentication → Providers → Google
2. Toggle ON
3. Add Client ID + Client Secret from Google Cloud Console
4. Add redirect URL: `https://hzrnohsxigrqlmzegwlb.supabase.co/auth/v1/callback`
5. In Google Cloud Console: Authorized JavaScript origins should include `https://muzammil691.github.io`

Document this in `.agent/questions/phase-1.3c-q.md`:

> "BLOCKER: Google OAuth code is shipped but inert until user (a) creates Google Cloud OAuth client at console.cloud.google.com, (b) adds Client ID + Secret to Supabase Dashboard → Auth → Providers → Google, (c) adds the Supabase callback URL to Google's authorized redirects."

## Acceptance criteria

After this task ships:

1. `<GoogleLoginButton>` renders with Google G icon
2. Click triggers redirect to Google OAuth consent
3. After consent, redirect back to `/auth/callback` → session established → redirect to `/`
4. Failed/cancelled OAuth redirects to `/login?error=...`
5. `npm run build` succeeds

## Out of scope

- Google One-Tap (defer)
- Other OAuth providers (GitHub, Apple, etc.) — not in master plan
- Login linking (existing email user adds Google) — Phase 2 polish

## Notes

- The Google G icon is inline SVG to avoid a heavy icon package import
- access_type=offline + prompt=consent ensures we get a refresh token (Supabase handles refresh internally)
- The 5-second safety timeout prevents users getting stuck on callback page if Supabase doesn't fire SIGNED_IN
