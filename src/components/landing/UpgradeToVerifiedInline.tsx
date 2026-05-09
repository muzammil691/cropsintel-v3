// Phase 1.3b — Verified-tier upsell rendered inside the chat thread for
// registered users hitting execution-grade walls (real-time prices, supplier
// names, position reports, etc.).
//
// Tap "Request verification" → the existing Phase 1.3a verification queue
// picks it up and a Maxons reviewer follows up within 24 hours.

import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { VerifiedUpgradePitch } from '@/hooks/useGuestSession'

interface Props {
  pitch: VerifiedUpgradePitch
}

export function UpgradeToVerifiedInline({ pitch }: Props) {
  return (
    <div
      data-testid="upgrade-to-verified-inline"
      className="mt-3 flex flex-wrap gap-2"
    >
      <Button asChild size="sm" data-testid="upgrade-to-verified-cta">
        <Link to={pitch.cta_url}>Request verification</Link>
      </Button>
    </div>
  )
}
