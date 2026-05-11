// CropsIntel V3 — Root component (1.10bb-c Session 8B routing collapse).
//
// /atlas is the only entry. The customer surface (Landing, Login, SignUp,
// Dashboard, etc.) has been deleted; /admin too. Every URL resolves to one
// of four places:
//
//   /                  →  /atlas      (if Atlas OTP session present)
//                         /atlas/login (otherwise)
//   /atlas/login       →  WhatsApp OTP screen
//   /atlas/invite      →  invite-acceptance landing (forwards to /atlas/login)
//   /atlas/*           →  AtlasCockpit, gated by AtlasAuthGuard
//   anything else      →  redirect to /
//
// AuthContext stays mounted at the root (main.tsx) because cockpit sub-trees
// (AtlasTopNav, atlas-pd) still consume useAuth() for Supabase user.id when
// the operator has a Supabase session in addition to the Atlas OTP session.
// In the OTP-only path the context returns user: null gracefully.

import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DrAtlasAssistant } from '@/components/atlas/DrAtlasAssistant'
import { AtlasAuthGuard } from '@/components/atlas/AtlasAuthGuard'
import { RootRedirect } from '@/components/RootRedirect'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const AtlasCockpit = lazy(() =>
  import('@/components/atlas/AtlasCockpit').then((m) => ({ default: m.AtlasCockpit })),
)
const AtlasLogin = lazy(() => import('./pages/atlas/AtlasLogin'))
const AtlasInviteAccept = lazy(() => import('./pages/atlas/AtlasInviteAccept'))

function CockpitLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950"
    >
      <span className="text-sm text-slate-600 dark:text-slate-400">
        Atlas — loading…
      </span>
    </div>
  )
}

function MigrationBanner(): ReactNode {
  const { migrationNotice, clearMigrationNotice } = useAuth()
  if (!migrationNotice) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-[calc(100%-1rem)] sm:max-w-md px-2 sm:px-4 pb-[env(safe-area-inset-bottom)]"
    >
      <Alert className="flex items-center justify-between gap-2 shadow-md border-green-500 bg-green-50 text-green-900">
        <AlertDescription className="flex-1 text-sm sm:text-base">
          {migrationNotice}
        </AlertDescription>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearMigrationNotice}
          aria-label="Close notification"
          className="shrink-0 min-h-[44px] min-w-[44px] h-11 w-11 p-0 text-green-700 hover:text-green-900 hover:bg-green-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-green-600/50"
        >
          <span aria-hidden="true">✕</span>
        </Button>
      </Alert>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <MigrationBanner />
      <Toaster position="bottom-center" richColors closeButton />
      <Suspense fallback={<CockpitLoadingFallback />}>
        <Routes>
          {/* Root: redirect based on Atlas OTP session presence. */}
          <Route path="/" element={<RootRedirect />} />

          {/* Atlas auth-flow pages — public (no AtlasAuthGuard). */}
          <Route path="/atlas/login" element={<AtlasLogin />} />
          <Route path="/atlas/invite" element={<AtlasInviteAccept />} />

          {/* Everything else under /atlas/* renders the cockpit. The cockpit's
              own URL-search-params router handles tab state (?tab=plan,
              ?tab=workshop, etc.) so the wildcard is sufficient — no
              per-tab Routes needed. */}
          <Route
            path="/atlas/*"
            element={
              <AtlasAuthGuard>
                <AtlasCockpit />
              </AtlasAuthGuard>
            }
          />

          {/* Anything else (incl. old /login, /dashboard, /admin/*) bounces
              to /, which RootRedirect then forwards to /atlas or
              /atlas/login. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <DrAtlasAssistant />
      </Suspense>
    </ErrorBoundary>
  )
}
