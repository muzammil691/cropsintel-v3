// CropsIntel V3 — Root component (route table)
//
// Per master plan section 11.2 Phase 1.3h: auth routes + guards wired.
// Phase 2/3 grow the route table per the master plan.

import { Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense, type ReactNode } from "react"
import { AuthGuard } from "@/components/auth/AuthGuard"
import { LoadingScreen } from "@/components/auth/LoadingScreen"
import NotImplemented from "@/components/NotImplemented"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { useAuth } from "@/contexts/AuthContext"
import { Alert, AlertDescription } from "@/components/ui/alert"

// Lazy-loaded pages (master plan calls for lazy routing per V1 pattern)
const Landing = lazy(() => import("./pages/Landing"))
const Auth = lazy(() => import("./pages/Auth"))
const AuthCallback = lazy(() => import("./pages/AuthCallback"))
const Login = lazy(() => import("./pages/Login"))
const SignUp = lazy(() => import("./pages/SignUp"))
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"))
const ResetPassword = lazy(() => import("./pages/ResetPassword"))
const Upgrade = lazy(() => import("./pages/Upgrade"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Atlas = lazy(() => import("./pages/Atlas"))
const NotFound = lazy(() => import("./pages/NotFound"))
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"))
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"))

function MigrationBanner() {
  const { migrationNotice, clearMigrationNotice } = useAuth()
  if (!migrationNotice) return null
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <Alert className="flex items-center justify-between gap-2 shadow-md border-green-500 bg-green-50 text-green-900">
        <AlertDescription className="flex-1">{migrationNotice}</AlertDescription>
        <button
          onClick={clearMigrationNotice}
          className="shrink-0 text-green-700 hover:text-green-900 font-medium text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </Alert>
    </div>
  )
}

// Only for unauthenticated users — redirects signed-in users to /
function PublicRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <LoadingScreen />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <ErrorBoundary>
      <MigrationBanner />
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          {/* Root — Landing page */}
          <Route path="/" element={<Landing />} />

          {/* Legacy /welcome alias kept for existing links */}
          <Route path="/welcome" element={<Navigate to="/" replace />} />

          {/* Legacy /auth combined-form kept for backward compat */}
          <Route path="/auth" element={<Auth />} />

          {/* OAuth / magic-link callback — both auth states allowed */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Auth pages — only for unauthenticated users */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><SignUp /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          {/* reset-password: both states allowed (token in URL) */}
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Public surface — pending real build in Phase 1.50 */}
          <Route path="/insights" element={<NotImplemented phase="1.50-landing-real" />} />
          <Route path="/news" element={<NotImplemented phase="1.50-landing-real" />} />
          <Route path="/about" element={<NotImplemented phase="1.50-landing-real" />} />
          <Route path="/pricing" element={<NotImplemented phase="1.50-landing-real" />} />

          {/* Protected routes — registered tier */}
          <Route
            path="/dashboard"
            element={
              <AuthGuard requiredTier="registered">
                <Dashboard />
              </AuthGuard>
            }
          />
          <Route
            path="/upgrade"
            element={
              <AuthGuard requiredTier="registered">
                <Upgrade />
              </AuthGuard>
            }
          />

          {/* Verified-tier+ placeholders — Phase 3 */}
          <Route
            path="/portfolio"
            element={
              <AuthGuard requiredTier="verified">
                <NotImplemented phase="Phase 3 — Position book & portfolio" />
              </AuthGuard>
            }
          />

          {/* Atlas admin — single-user Muzammil; no auth guard in v0.1 */}
          <Route path="/atlas" element={<Atlas />} />

          {/* Admin — maxons_team tier required */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<NotImplemented phase="Phase 2 — User management" />} />
            <Route path="verifications" element={<NotImplemented phase="Phase 1.11b — Verification queue" />} />
            <Route path="companies" element={<NotImplemented phase="Phase 2 — Company management" />} />
            <Route path="offers" element={<NotImplemented phase="Phase 2.3 — Offer management" />} />
            <Route path="settings" element={<NotImplemented phase="Phase 2 — Admin settings" />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
