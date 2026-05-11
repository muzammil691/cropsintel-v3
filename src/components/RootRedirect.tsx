// 1.10bb-c Session 8B — root redirect.
//
// The customer surface is gone; `/` no longer renders anything. We just
// look at the Atlas OTP session token in localStorage and bounce to either
// the cockpit (if a token is present) or the Atlas login page.
//
// The token is the same key the cockpit + AtlasAuthGuard already read
// (`atlas_session_token`, exported as ATLAS_SESSION_TOKEN_KEY by
// src/lib/atlas-client.ts). We don't validate it here — AtlasAuthGuard
// hits /atlas/auth/me right after we land on /atlas and revokes the token
// on 401. If the token is stale, the user gets one extra hop through
// /atlas → /atlas/login. That's fine.

import { Navigate } from 'react-router-dom'
import { ATLAS_SESSION_TOKEN_KEY } from '@/lib/atlas-client'

function hasAtlasSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(window.localStorage.getItem(ATLAS_SESSION_TOKEN_KEY))
  } catch {
    // private mode etc. — treat as unauthed.
    return false
  }
}

export function RootRedirect() {
  return <Navigate to={hasAtlasSession() ? '/atlas' : '/atlas/login'} replace />
}

export default RootRedirect
