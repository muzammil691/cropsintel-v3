// CropsIntel V3 — Root component (route table)
//
// Per master plan section 11.2 Phase 1: minimal route surface for the MVP.
// Phase 2/3 grow the route table per the master plan.

import { Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense } from "react"
import { RouteGuard } from "@/components/RouteGuard"
import NotImplemented from "@/components/NotImplemented"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { useAuth } from "@/contexts/AuthContext"
import { Alert, AlertDescription } from "@/components/ui/alert"

// Lazy-loaded pages (master plan calls for lazy routing per V1 pattern)
const Welcome = lazy(() => import("./pages/Welcome"))
const Auth = lazy(() => import("./pages/Auth"))
const AuthCallback = lazy(() => import("./pages/AuthCallback"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Atlas = lazy(() => import("./pages/Atlas"))
const NotFound = lazy(() => import("./pages/NotFound"))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  )
}

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

export default function App() {
  return (
    <ErrorBoundary>
      <MigrationBanner />
      <Suspense fallback={<PageLoader />}>
        <Routes>
        {/* Public */}
        <Route path="/" element={<Navigate to="/welcome" replace />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Public surface — pending real build in Phase 1.50 */}
        <Route path="/insights" element={<NotImplemented phase="1.50-landing-real" />} />
        <Route path="/news" element={<NotImplemented phase="1.50-landing-real" />} />
        <Route path="/about" element={<NotImplemented phase="1.50-landing-real" />} />
        <Route path="/pricing" element={<NotImplemented phase="1.50-landing-real" />} />

        {/* Auth-required */}
        <Route
          path="/dashboard"
          element={
            <RouteGuard requires="auth">
              <Dashboard />
            </RouteGuard>
          }
        />

        {/* Atlas admin — single-user Muzammil; no auth guard in v0.1 */}
        <Route path="/atlas" element={<Atlas />} />

        {/* Catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
