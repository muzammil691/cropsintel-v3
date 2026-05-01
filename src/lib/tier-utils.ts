import type { UserTier } from '@/lib/types'

export const TIER_RANK: Record<UserTier, number> = {
  guest: 0,
  registered: 1,
  verified: 2,
  maxons_team: 3,
}

export function tierAtLeast(currentTier: UserTier, minTier: UserTier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[minTier]
}

export function tierLabel(tier: UserTier): string {
  return {
    guest: 'Guest',
    registered: 'Registered',
    verified: 'Verified',
    maxons_team: 'Admin',
  }[tier]
}

export function nextTier(tier: UserTier): UserTier | null {
  const order: UserTier[] = ['guest', 'registered', 'verified', 'maxons_team']
  const idx = order.indexOf(tier)
  return idx < order.length - 1 ? order[idx + 1] : null
}
