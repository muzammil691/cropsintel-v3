// Phase 1.3b — Soft-wall upgrade pitch rendered inside the chat thread.
//
// AI sells the upgrade; no popup. Two CTAs: email signup or WhatsApp signup.
// The conversation context is preserved through the guest_id cookie, so when
// the visitor returns from /auth they continue the same thread.

import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { UpgradePitch } from '@/hooks/useGuestSession'

interface Props {
  pitch: UpgradePitch
}

export function UpgradePitchInline({ pitch }: Props) {
  return (
    <div
      data-testid="upgrade-pitch-inline"
      className="mt-3 flex flex-wrap gap-2"
    >
      <Button asChild size="sm" data-testid="upgrade-pitch-email">
        <Link to={pitch.email_url}>Email →</Link>
      </Button>
      <Button asChild size="sm" variant="outline" data-testid="upgrade-pitch-whatsapp">
        <Link to={pitch.whatsapp_url}>WhatsApp →</Link>
      </Button>
    </div>
  )
}
