// Phase 1.10ao — Atlas invite acceptance landing page.
//
// Reached via the WhatsApp invite URL: /atlas/invite?token=<32-byte-hex>.
// We don't validate the token client-side (the server is authoritative on
// expiry / consumption / revocation). All this page does is explain what
// happens next and forward the user to the OTP login flow with the phone
// pre-filled when the URL also carries `?phone=`.

import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ATLAS_SESSION_TOKEN_KEY } from '@/lib/atlas-client'

export default function AtlasInviteAccept() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? searchParams.get('invite') ?? ''
  const phone = searchParams.get('phone') ?? ''

  // If they already have a session, just push them to the cockpit.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(ATLAS_SESSION_TOKEN_KEY)) {
      navigate('/atlas', { replace: true })
    }
  }, [navigate])

  const loginUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (phone) params.set('phone', phone)
    if (token) params.set('invite', token)
    const qs = params.toString()
    return `/atlas/login${qs ? `?${qs}` : ''}`
  }, [phone, token])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>You're invited to Atlas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Atlas is the CropsIntel V3 operations cockpit. To activate your invite, sign in with the phone
            number that received the WhatsApp message — we'll send you a 6-digit code to verify.
          </p>

          {!token && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              No invite token in this URL. If your invite expired, ask the owner to re-send it.
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            onClick={() => navigate(loginUrl, { replace: true })}
          >
            Continue to sign-in
          </Button>

          <p className="text-[11px] text-slate-500">
            Invites expire 7 days after they're sent. The token alone doesn't grant access — you still need
            an OTP delivered to the invited phone number.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
