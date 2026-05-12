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
import { X } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DrAtlasAssistant } from '@/components/atlas/DrAtlasAssistant'
import { AtlasAuthGuard } from '@/components/atlas/AtlasAuthGuard'
import { RootRedirect } from '@/components/RootRedirect'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const AtlasCockpit = lazy(() =>
  import('@/components/atlas/AtlasCockpit').then((m) => ({ default: m.AtlasCockpit })),
)
const AtlasLogin = lazy(() => import('./pages/atlas/AtlasLogin'))
const AtlasInviteAccept = lazy(() => import('./pages/atlas/AtlasInviteAccept'))

// 1.10bb-c Session 9A — Settings sub-tree.
const SettingsLayout = lazy(() => import('./pages/atlas/settings/SettingsLayout'))
const AccountPage = lazy(() => import('./pages/atlas/settings/AccountPage'))
const ConnectionsPage = lazy(() => import('./pages/atlas/settings/ConnectionsPage'))
const NotificationsPage = lazy(() => import('./pages/atlas/settings/NotificationsPage'))
const AuditPage = lazy(() => import('./pages/atlas/settings/AuditPage'))
const DangerZonePage = lazy(() => import('./pages/atlas/settings/DangerZonePage'))

function CockpitLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Atlas cockpit loading"
      className="min-h-screen bg-slate-50 dark:bg-slate-950"
    >
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
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
          aria-label="Dismiss migration notice"
          className="shrink-0 text-green-700 hover:text-green-900 hover:bg-green-100 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-green-600/50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
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

          {/* 1.10bb-c Session 9A — Settings sub-tree. Declared BEFORE the
              /atlas/* wildcard so React Router resolves it first; the
              wildcard catch-all routes everything else to AtlasCockpit. */}
          <Route
            path="/atlas/settings"
            element={
              <AtlasAuthGuard>
                <SettingsLayout />
              </AtlasAuthGuard>
            }
          >
            <Route index element={<Navigate to="connections" replace />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="danger" element={<DangerZonePage />} />
          </Route>

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
