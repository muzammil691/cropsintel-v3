// Phase 1.10aj — gates every /atlas/* route on a valid session token.
//
// Runtime: read the token from localStorage; if missing → redirect to login;
// otherwise validate it via /atlas/auth/me. A 401 means the token was revoked
// or the row is gone — clear localStorage and redirect to login.

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import {
  ATLAS_SESSION_TOKEN_KEY,
  fetchAtlasMe,
  AtlasUnauthorizedError,
} from '@/lib/atlas-client'

type GuardState =
  | { status: 'checking' }
  | { status: 'authed' }
  | { status: 'unauthed' }

export function AtlasAuthGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GuardState>({ status: 'checking' })

  useEffect(() => {
    const token = typeof window !== 'undefined'
      ? window.localStorage.getItem(ATLAS_SESSION_TOKEN_KEY)
      : null
    if (!token) {
      setState({ status: 'unauthed' })
      return
    }

    let cancelled = false
    fetchAtlasMe()
      .then(() => {
        if (!cancelled) setState({ status: 'authed' })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AtlasUnauthorizedError) {
          window.localStorage.removeItem(ATLAS_SESSION_TOKEN_KEY)
          setState({ status: 'unauthed' })
          return
        }
        // Network / 5xx — treat as authenticated for the moment so a flaky
        // backend doesn't lock the user out. Real /me failures show up later
        // when an actual API call returns 401 and the page re-mounts.
        setState({ status: 'authed' })
      })
    return () => { cancelled = true }
  }, [])

  if (state.status === 'checking') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950"
      >
        <span className="text-sm text-slate-600 dark:text-slate-400">Checking your session…</span>
      </div>
    )
  }

  if (state.status === 'unauthed') {
    return <Navigate to="/atlas/login" replace />
  }

  return <>{children}</>
}
