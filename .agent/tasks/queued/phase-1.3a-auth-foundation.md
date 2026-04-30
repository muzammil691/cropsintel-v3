# Task: Phase 1.3a — Auth foundation (context, supabase wiring, session management)

**Master plan reference:** §11.2 Phase 1.3 — "Auth: 4 methods (V2 pattern), V1+V2 user migration bridge"
**Context:** Foundation for all 4 login methods + protected routes. Wires Supabase Auth into the React app, exposes useAuth hook, manages session lifecycle.
**Estimated effort:** ~30 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Build the auth context layer so all login flows (email/password, Google OAuth, WhatsApp OTP, phone OTP) plug into a single shared session manager.

## Files to create

```
src/lib/supabase.ts                  # Supabase client singleton (already exists or create)
src/contexts/AuthContext.tsx         # AuthProvider + useAuth hook
src/types/auth.ts                    # User, Session, AuthState types
src/lib/auth-storage.ts              # Session persistence helpers
src/components/auth/AuthGuard.tsx    # Wrap protected pages
src/components/auth/LoadingScreen.tsx  # Skeleton while session loads
```

## src/lib/supabase.ts

```ts
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'cropsintel-v3-auth',
  },
})

export type SupabaseClient = typeof supabase
```

## src/types/auth.ts

```ts
import type { Session, User } from '@supabase/supabase-js'

export type Tier = 'guest' | 'registered' | 'verified' | 'maxons'

export interface AuthUser extends User {
  // Extended profile fields from public.profiles table
  tier?: Tier
  display_name?: string
  primary_models?: ('A' | 'B' | 'C')[]
  company_id?: string | null
  preferred_language?: string
}

export interface AuthState {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  error: string | null
  tier: Tier  // 'guest' if not authenticated
}

export type LoginMethod = 'email' | 'google' | 'whatsapp_otp' | 'phone_otp'
```

## src/contexts/AuthContext.tsx

```tsx
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { AuthState, AuthUser, Tier } from '@/types/auth'
import type { Session } from '@supabase/supabase-js'

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadProfile = useCallback(async (sessionUser: import('@supabase/supabase-js').User) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, display_name, primary_models, company_id, preferred_language')
      .eq('id', sessionUser.id)
      .maybeSingle()

    setUser({
      ...sessionUser,
      tier: (profile?.tier as Tier) ?? 'registered',
      display_name: profile?.display_name ?? sessionUser.email ?? sessionUser.phone ?? 'User',
      primary_models: profile?.primary_models ?? [],
      company_id: profile?.company_id ?? null,
      preferred_language: profile?.preferred_language ?? 'en',
    })
  }, [])

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s?.user) {
        loadProfile(s.user).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s?.user) {
        loadProfile(s.user)
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const signOut = useCallback(async () => {
    setLoading(true)
    const { error } = await supabase.auth.signOut()
    if (error) setError(error.message)
    setLoading(false)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user)
  }, [session, loadProfile])

  const tier: Tier = user?.tier ?? 'guest'

  return (
    <AuthContext.Provider value={{ user, session, loading, error, tier, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
```

## src/components/auth/AuthGuard.tsx

```tsx
import { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Navigate, useLocation } from 'react-router-dom'
import { LoadingScreen } from './LoadingScreen'
import type { Tier } from '@/types/auth'

interface Props {
  children: ReactNode
  requiredTier?: Tier
  fallback?: ReactNode
}

const TIER_RANK: Record<Tier, number> = { guest: 0, registered: 1, verified: 2, maxons: 3 }

export function AuthGuard({ children, requiredTier = 'registered', fallback }: Props) {
  const { user, loading, tier } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen />

  if (!user) {
    return fallback ?? <Navigate to="/login" state={{ from: location }} replace />
  }

  if (TIER_RANK[tier] < TIER_RANK[requiredTier]) {
    return fallback ?? <Navigate to="/upgrade" state={{ requiredTier }} replace />
  }

  return <>{children}</>
}
```

## src/components/auth/LoadingScreen.tsx

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950">
      <Skeleton className="h-12 w-32 rounded" />
      <Skeleton className="h-4 w-64" />
      <p className="text-sm text-slate-500 mt-2">Loading session…</p>
    </div>
  )
}
```

## Wire into src/main.tsx

Wrap the App in AuthProvider:

```tsx
import { AuthProvider } from '@/contexts/AuthContext'
// ... existing imports
ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename="/cropsintel-v3">
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
)
```

## Acceptance criteria

After this task ships:

1. `useAuth()` hook works — returns `{user, session, loading, tier, signOut, refreshProfile}`
2. `<AuthGuard>` redirects unauthenticated users to `/login`
3. `<AuthGuard requiredTier="verified">` redirects insufficient-tier users to `/upgrade`
4. Session persists across page refreshes (via localStorage)
5. Logout clears session and redirects
6. profiles table queried on auth — user object has `tier`, `display_name`, etc.
7. `npm run build` succeeds with no TypeScript errors

## Out of scope

- Login UI (Phase 1.3g)
- Specific login methods (1.3b email, 1.3c google, 1.3d whatsapp, 1.3e phone)
- Multi-factor (Phase 2 polish)
- Session migration from V1/V2 (Phase 1.3f)

## Notes

- Tier hierarchy: guest < registered < verified < maxons
- The `verified` tier requires manual admin review (Phase 1.11b builds that queue)
- All tier upgrades go through admin review — no self-service to verified
- Session storage key `cropsintel-v3-auth` is namespaced to avoid collision with V2
