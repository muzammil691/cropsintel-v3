// CropsIntel V3 — RouteGuard
//
// Per master plan section 1.7 + V1 audit: 3-tier RBAC at the route layer.
// Wrap any route element with <RouteGuard requires="auth|team|admin"> to gate
// (legacy 3-tier API), or use the V3-spec form:
//   <RouteGuard requireTier="verified" requireRole="admin"> children </RouteGuard>
//
// Phase 1.3a extends this to accept user_tier values + app_role values so the
// auth foundation can drive route gating using the same vocabulary as the DB.

import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import type { ReactNode } from "react"
import type { AppRole, UserTier } from "@/lib/types"

type LegacyTier = "auth" | "team" | "admin"

const TIER_RANK: Record<UserTier, number> = {
  guest: 0,
  registered: 1,
  verified: 2,
  maxons_team: 3,
}

interface RouteGuardProps {
  /** Legacy 3-tier API used by earlier phases. Maps to require* props internally. */
  requires?: LegacyTier
  /** V3-spec: minimum profiles.tier required (registered, verified, maxons_team). */
  requireTier?: UserTier
  /** V3-spec: required app_role (auth, team, admin). admin includes team. */
  requireRole?: AppRole
  children: ReactNode
}

export function RouteGuard({ requires, requireTier, requireRole, children }: RouteGuardProps) {
  const { isLoading, isAuthenticated, isTeam, isAdmin, tier } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  // Legacy API: requires === 'auth' | 'team' | 'admin'
  if (requires === "auth" && !isAuthenticated) {
    return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  if (requires === "team" && !isTeam) {
    return <Navigate to="/" replace />
  }
  if (requires === "admin" && !isAdmin) {
    return <Navigate to="/" replace />
  }

  // V3 API
  if (requireRole) {
    if (!isAuthenticated) {
      return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />
    }
    if (requireRole === "admin" && !isAdmin) {
      return <Navigate to="/" replace />
    }
    if (requireRole === "team" && !isTeam) {
      return <Navigate to="/" replace />
    }
    if (requireRole === "auth" && !isAuthenticated) {
      return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />
    }
  }

  if (requireTier) {
    if (!isAuthenticated) {
      return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />
    }
    const haveRank = TIER_RANK[tier] ?? 0
    const needRank = TIER_RANK[requireTier] ?? 0
    if (haveRank < needRank) {
      return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />
    }
  }

  return <>{children}</>
}
