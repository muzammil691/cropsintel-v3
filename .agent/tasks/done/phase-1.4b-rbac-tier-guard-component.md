# Task: Phase 1.4b — TierGuard component for in-page conditional rendering

**Master plan reference:** §11.2 Phase 1.4 — App-side RBAC enforcement
**Context:** Frontend component that conditionally shows/hides UI based on user's tier. Used everywhere we have tier-gated features (e.g., "Upgrade to verified to see this widget"). Complement to AuthGuard (route-level) and RLS (database-level).
**Estimated effort:** ~15 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

`<TierGuard requiredTier="verified">{children}</TierGuard>` — renders children only if user's tier ≥ requiredTier. Otherwise renders an upgrade prompt or nothing.

## Files to create

```
src/components/auth/TierGuard.tsx
src/components/auth/UpgradePrompt.tsx
src/lib/tier-utils.ts
```

## src/lib/tier-utils.ts

```ts
import type { Tier } from '@/types/auth'

export const TIER_RANK: Record<Tier, number> = {
  guest: 0,
  registered: 1,
  verified: 2,
  maxons: 3,
}

export function tierAtLeast(currentTier: Tier, minTier: Tier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[minTier]
}

export function tierLabel(tier: Tier): string {
  return {
    guest: 'Guest',
    registered: 'Registered',
    verified: 'Verified',
    maxons: 'Admin',
  }[tier]
}

export function nextTier(tier: Tier): Tier | null {
  const order: Tier[] = ['guest', 'registered', 'verified', 'maxons']
  const idx = order.indexOf(tier)
  return idx < order.length - 1 ? order[idx + 1] : null
}
```

## src/components/auth/TierGuard.tsx

```tsx
import { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { tierAtLeast } from '@/lib/tier-utils'
import { UpgradePrompt } from './UpgradePrompt'
import type { Tier } from '@/types/auth'

interface Props {
  requiredTier: Tier
  children: ReactNode
  fallback?: ReactNode
  /** if true, renders nothing instead of UpgradePrompt when below tier */
  silent?: boolean
}

export function TierGuard({ requiredTier, children, fallback, silent = false }: Props) {
  const { tier, loading } = useAuth()
  if (loading) return null  // skeleton owned by parent
  if (tierAtLeast(tier, requiredTier)) return <>{children}</>
  if (silent) return null
  return <>{fallback ?? <UpgradePrompt requiredTier={requiredTier} />}</>
}
```

## src/components/auth/UpgradePrompt.tsx

```tsx
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'  // or inline SVG
import { tierLabel } from '@/lib/tier-utils'
import type { Tier } from '@/types/auth'

interface Props {
  requiredTier: Tier
  feature?: string  // e.g., "position book" — appears in copy
}

export function UpgradePrompt({ requiredTier, feature }: Props) {
  return (
    <Card className="p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-slate-900 dark:to-slate-800 border-emerald-200/50">
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 p-2">
          <Lock className="h-5 w-5 text-emerald-700 dark:text-emerald-500" aria-hidden="true" />
        </div>
        <div className="flex-1 space-y-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">
            {tierLabel(requiredTier)} access required
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {feature
              ? `${feature} is available to ${tierLabel(requiredTier)} members.`
              : `This feature is available to ${tierLabel(requiredTier)} members.`}
            {' '}
            {requiredTier === 'verified' &&
              'Verification is reviewed manually by our team — usually within 48 hours.'}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/upgrade">Request upgrade</Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}
```

## Usage examples

```tsx
// Conditionally show a widget
<TierGuard requiredTier="verified">
  <PositionReportWidget />
</TierGuard>

// Silent fallback (returns null, no upgrade prompt)
<TierGuard requiredTier="maxons" silent>
  <AdminControls />
</TierGuard>

// Custom fallback
<TierGuard requiredTier="verified" fallback={<TeaserCard />}>
  <FullMarketBrief />
</TierGuard>
```

## Acceptance criteria

After this task ships:

1. `<TierGuard>` component renders children when tier matches
2. Renders UpgradePrompt when below tier (default behavior)
3. `silent` prop renders null instead of UpgradePrompt
4. Custom `fallback` overrides default
5. Loading state renders nothing (parent owns skeleton)
6. UpgradePrompt has accessible Lock icon (aria-hidden), proper heading hierarchy
7. UpgradePrompt's "Request upgrade" button links to `/upgrade`
8. `npm run build` succeeds

## Design system requirements (Designer agent will audit)

- Card uses subtle emerald-* gradient (NOT garish)
- Lock icon in emerald-700, on emerald-100 background circle
- Typography hierarchy: h3 for heading, p for description
- Button uses outline variant (not full-color — this is informational, not a CTA)
- Spacing: gap-4 between icon and content, space-y-2 within content

## Out of scope

- Animated locked-state shimmer effects (deferred)
- Tracking which features users hit upgrade prompts on (Phase 2 analytics)
- Time-limited trial of higher-tier features (Phase 3)
- Per-feature upgrade pricing (deferred — pricing is Maxons-decided)

## Notes

- TierGuard is the THIRD layer of RBAC (after AuthGuard for routes, RLS for data). All three should be enforced.
- `silent` is for places where showing an upgrade prompt would clutter UI (e.g., admin nav items)
- Lock icon from lucide-react if available; otherwise inline SVG to avoid bundle bloat
- Always pair UpgradePrompt with TierGuard, never use UpgradePrompt standalone (it's a fallback, not a primary UI element)
