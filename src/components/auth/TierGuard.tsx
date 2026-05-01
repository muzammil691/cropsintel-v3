import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { tierAtLeast } from '@/lib/tier-utils'
import { UpgradePrompt } from './UpgradePrompt'
import type { UserTier } from '@/lib/types'

interface Props {
  requiredTier: UserTier
  children: ReactNode
  fallback?: ReactNode
  /** if true, renders nothing instead of UpgradePrompt when below tier */
  silent?: boolean
}

export function TierGuard({ requiredTier, children, fallback, silent = false }: Props) {
  const { tier, isLoading } = useAuth()
  if (isLoading) return null
  if (tierAtLeast(tier, requiredTier)) return <>{children}</>
  if (silent) return null
  return <>{fallback ?? <UpgradePrompt requiredTier={requiredTier} />}</>
}
