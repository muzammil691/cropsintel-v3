// CropsIntel V3 — RouteGuard
//
// Per master plan section 1.7 + V1 audit: 3-tier RBAC at the route layer.
// Wrap any route element with <RouteGuard requires="auth|team|admin"> to gate.

import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import type { ReactNode } from "react"

type Tier = "auth" | "team" | "admin"

export function RouteGuard({
  requires,
  children,
}: {
  requires: Tier
  children: ReactNode
}) {
  const { isLoading, isAuthenticated, isTeam, isAdmin } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  // auth tier — must be logged in
  if (requires === "auth" && !isAuthenticated) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />
  }

  // team tier — must be Maxons internal team or admin
  if (requires === "team" && !isTeam) {
    return <Navigate to="/" replace />
  }

  // admin tier — must be admin
  if (requires === "admin" && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
