# Task: Phase 1.3h — Route protection in App.tsx

**Master plan reference:** §11.2 Phase 1.3 — wire all auth components into actual routes
**Context:** Final piece of Phase 1.3. Adds all auth routes to App.tsx, wraps protected routes in AuthGuard, sets up post-login redirect, handles email-confirmation/oauth-callback. Depends on 1.3a-1.3g.
**Estimated effort:** ~20 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Update `src/App.tsx` to:
1. Add unauthenticated routes: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/upgrade`, `/auth/callback`
2. Wrap existing protected routes in `<AuthGuard>` with appropriate tier requirements
3. Add post-login redirect (to `?from=` query param or default `/`)
4. Add navigation guard for already-authenticated users hitting `/login` (redirect to `/`)

## Modify src/App.tsx

```tsx
import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { LoadingScreen } from '@/components/auth/LoadingScreen'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/contexts/AuthContext'

// Lazy-loaded pages
const Atlas = lazy(() => import('./pages/Atlas'))
const Login = lazy(() => import('./pages/Login'))
const SignUp = lazy(() => import('./pages/SignUp'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Upgrade = lazy(() => import('./pages/Upgrade'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))

// Existing pages (placeholders for future phases)
const Dashboard = lazy(() => import('./pages/Dashboard'))  // create stub if not exists
const Welcome = lazy(() => import('./pages/Welcome'))      // create stub if not exists
const NotImplemented = lazy(() => import('./components/NotImplemented'))

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  // If already signed in, redirect away from auth pages
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public marketing pages */}
        <Route path="/" element={<Welcome />} />
        <Route path="/insights" element={<NotImplemented label="Phase 1.5 — Public market-insight pages" />} />
        <Route path="/news" element={<NotImplemented label="Phase 1.5 — News page" />} />
        <Route path="/about" element={<NotImplemented label="Phase 1.5 — About page" />} />
        <Route path="/pricing" element={<NotImplemented label="Phase 1.5 — Pricing page" />} />

        {/* Auth pages — only for unauthenticated users */}
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/signup" element={<PublicRoute><SignUp /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password" element={<ResetPassword />} />  {/* both states allowed */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected routes */}
        <Route path="/dashboard" element={
          <AuthGuard requiredTier="registered">
            <Dashboard />
          </AuthGuard>
        } />

        <Route path="/upgrade" element={
          <AuthGuard requiredTier="registered">
            <Upgrade />
          </AuthGuard>
        } />

        {/* Atlas admin — no tier check (single-user Muzammil for v0.1) */}
        <Route path="/atlas" element={<Atlas />} />

        {/* Verified-tier+ features (placeholders for future phases) */}
        <Route path="/portfolio" element={
          <AuthGuard requiredTier="verified">
            <NotImplemented label="Phase 3 — Position book & portfolio" />
          </AuthGuard>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
```

## Create stub pages if they don't exist

`src/pages/Welcome.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

export default function Welcome() {
  const { user } = useAuth()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          CropsIntel
        </h1>
        <p className="text-xl text-slate-600 dark:text-slate-400">
          Almond market intelligence + CRM. Built for global trading houses.
        </p>
        <div className="flex gap-3 justify-center">
          {user ? (
            <Button asChild size="lg"><Link to="/dashboard">Go to dashboard</Link></Button>
          ) : (
            <>
              <Button asChild size="lg"><Link to="/signup">Get started</Link></Button>
              <Button asChild variant="outline" size="lg"><Link to="/login">Sign in</Link></Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

`src/pages/Dashboard.tsx`:

```tsx
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/card'

export default function Dashboard() {
  const { user, tier } = useAuth()
  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.display_name}</h1>
          <p className="text-sm text-slate-500 mt-1">Tier: <span className="font-medium">{tier}</span></p>
        </header>
        <Card className="p-12 text-center text-slate-500">
          <p>Dashboard coming in Phase 1.8 (Market Price Intelligence)</p>
        </Card>
      </div>
    </div>
  )
}
```

## Acceptance criteria

After this task ships:

1. All routes registered in App.tsx
2. `/login` redirects to `/` if already signed in
3. `/dashboard` requires auth — redirects to `/login` if not signed in
4. After login, redirects back to original `from` route (or `/` if no `from`)
5. `<AuthGuard>` wraps protected routes correctly
6. Welcome page exists with sign-in/sign-up CTAs
7. Tab focus accessible — tab order makes sense
8. `npm run build` succeeds
9. Direct visit to `/login`, `/signup` works (SPA fallback handles via 404.html copy)

## Out of scope

- Logged-in nav bar with user menu (deferred — Phase 1.5)
- Onboarding tour after first login (Phase 2)
- Granular RBAC beyond tier (Phase 1.4)

## Notes

- This is the LAST task in Phase 1.3 — once shipped, the auth phase is complete
- Welcome page is intentionally minimal; Phase 1.5 will replace with real marketing content
- The fallback `<Navigate to="/" replace />` for unknown routes is graceful — doesn't 404
- Route ORDER matters: more specific paths first, fallback last
