import { type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Navigate, useLocation } from 'react-router-dom'
import { LoadingScreen } from './LoadingScreen'
import type { Tier } from '@/types/auth'

interface Props {
  children: ReactNode
  requiredTier?: Tier
  fallback?: ReactNode
}

const TIER_RANK: Record<Tier, number> = {
  guest: 0,
  registered: 1,
  verified: 2,
  maxons_team: 3,
}

export function AuthGuard({ children, requiredTier = 'registered', fallback }: Props) {
  const { user, isLoading, tier } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingScreen />

  if (!user) {
    return fallback ? <>{fallback}</> : <Navigate to="/login" state={{ from: location }} replace />
  }

  if (TIER_RANK[tier] < TIER_RANK[requiredTier]) {
    return fallback ? <>{fallback}</> : <Navigate to="/upgrade" state={{ requiredTier }} replace />
  }

  return <>{children}</>
}
