// CropsIntel V3 — Root component (route table)
//
// Per master plan section 11.2 Phase 1: minimal route surface for the MVP.
// Phase 2/3 grow the route table per the master plan.

import { Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense } from "react"
import { RouteGuard } from "@/components/RouteGuard"

// Lazy-loaded pages (master plan calls for lazy routing per V1 pattern)
const Welcome = lazy(() => import("./pages/Welcome"))
const Auth = lazy(() => import("./pages/Auth"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const NotFound = lazy(() => import("./pages/NotFound"))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Navigate to="/welcome" replace />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/auth" element={<Auth />} />

        {/* Auth-required */}
        <Route
          path="/dashboard"
          element={
            <RouteGuard requires="auth">
              <Dashboard />
            </RouteGuard>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
