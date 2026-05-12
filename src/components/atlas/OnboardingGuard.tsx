// 1.10bb-c Session 9B — OnboardingGuard.
//
// Sits INSIDE AtlasAuthGuard and OUTSIDE the cockpit's AtlasCockpit. Fetches
// /atlas/user-state + /atlas/connections, then:
//
//   • If onboarding_complete === true → let through.
//   • Else if all 5 mandatory providers are verified → silently call
//     PATCH /atlas/user-state { onboarding_complete: true } and let through
//     (the user already finished setup, probably via direct DB inserts).
//   • Else → redirect to /atlas/onboarding.
//
// Routes that BYPASS this guard (declared higher in App.tsx):
//   /atlas/login, /atlas/invite       — pre-auth surfaces
//   /atlas/onboarding                 — the wizard itself
//   /atlas/settings/*                 — user might need to fix a connection
//                                        mid-onboarding, so Settings is open
//
// Loading state is a full-screen spinner (NOT a flash of the cockpit), as
// the spec requires.

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import {
  getUserState,
  listConnections,
  updateUserState,
  type AtlasConnection,
  type ConnectionProvider,
} from '@/lib/atlas-client'

const MANDATORY: ConnectionProvider[] = ['anthropic', 'openai', 'gemini', 'github', 'supabase']

type State =
  | { kind: 'checking' }
  | { kind: 'redirect' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string }

function allVerified(connections: AtlasConnection[]): boolean {
  return MANDATORY.every((p) =>
    connections.some((c) => c.provider === p && c.last_verify_status === 'verified'),
  )
}

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'checking' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [user, connections] = await Promise.all([
          getUserState(),
          listConnections(),
        ])
        if (cancelled) return
        if (user.onboarding_complete) {
          setState({ kind: 'ok' })
          return
        }
        if (allVerified(connections)) {
          // Auto-mark complete; no UI fanfare.
          try { await updateUserState({ onboarding_complete: true }) } catch { /* non-fatal */ }
          if (!cancelled) setState({ kind: 'ok' })
          return
        }
        setState({ kind: 'redirect' })
      } catch (err) {
        if (cancelled) return
        // Don't trap the user behind a 5xx — let them through and the actual
        // /atlas/user-state failure will surface separately when cockpit
        // routes hit it. The wizard fetches the same data and will redirect
        // back if onboarding really is incomplete.
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.kind === 'checking') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950"
      >
        <div className="text-sm text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your stack…
        </div>
      </div>
    )
  }
  if (state.kind === 'redirect') {
    return <Navigate to="/atlas/onboarding" replace />
  }
  // error → fall through and render the cockpit. Telemetry will catch
  // recurring failures.
  return <>{children}</>
}

export default OnboardingGuard
