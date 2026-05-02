// Phase 1.10au — Team-portal mirror.
//
// Stripped-down face for non-developer team members. Owners are redirected
// to the full cockpit at /atlas; admins/operators/viewers see assignments
// routed to them, can submit reports, and read announcements from Atlas.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { LogOut, ShieldAlert, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssignmentList } from '@/components/atlas/team-portal/AssignmentList'
import { ReportForm } from '@/components/atlas/team-portal/ReportForm'
import { AnnouncementsBanner } from '@/components/atlas/team-portal/AnnouncementsBanner'
import {
  AtlasUnauthorizedError,
  fetchAtlasMe,
  fetchTeamPortalAnnouncements,
  fetchTeamPortalAssignments,
  logoutAtlas,
  resolveTeamAssignment,
  type AtlasMe,
  type TeamAssignment,
  type TeamPortalAnnouncements,
} from '@/lib/atlas-client'

const ASSIGNMENT_POLL_MS = 5_000
const ANNOUNCEMENT_POLL_MS = 30_000

export default function AtlasTeamPortal() {
  const navigate = useNavigate()
  const [me, setMe] = useState<AtlasMe | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [assignments, setAssignments] = useState<TeamAssignment[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)
  const [announcements, setAnnouncements] = useState<TeamPortalAnnouncements | null>(null)
  const [announcementsLoading, setAnnouncementsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }

  // Fetch principal once on mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchAtlasMe()
        if (!cancelled) setMe(data)
      } catch (err) {
        if (cancelled) return
        if (err instanceof AtlasUnauthorizedError) {
          navigate('/atlas/login', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setMeLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const refreshAssignments = useCallback(async () => {
    try {
      const data = await fetchTeamPortalAssignments()
      setAssignments(data)
      setError(null)
    } catch (err) {
      if (err instanceof AtlasUnauthorizedError) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAssignmentsLoading(false)
    }
  }, [])

  const refreshAnnouncements = useCallback(async () => {
    try {
      const data = await fetchTeamPortalAnnouncements()
      setAnnouncements(data)
    } catch (err) {
      if (err instanceof AtlasUnauthorizedError) return
      // Announcements are best-effort — keep last value, log to console.
      console.warn('team-portal announcements failed', err)
    } finally {
      setAnnouncementsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!me || me.role === 'owner') return
    void refreshAssignments()
    const t = window.setInterval(() => void refreshAssignments(), ASSIGNMENT_POLL_MS)
    return () => window.clearInterval(t)
  }, [me, refreshAssignments])

  useEffect(() => {
    if (!me || me.role === 'owner') return
    void refreshAnnouncements()
    const t = window.setInterval(() => void refreshAnnouncements(), ANNOUNCEMENT_POLL_MS)
    return () => window.clearInterval(t)
  }, [me, refreshAnnouncements])

  const handleResolve = useCallback(
    async (id: string, status: 'fixed' | 'escalated' | 'dismissed', notes?: string) => {
      setBusy(true)
      try {
        await resolveTeamAssignment(id, { status, notes })
        const verb = status === 'fixed' ? 'marked as fixed' : status === 'escalated' ? 'sent to owner' : 'dismissed'
        showToast(`Assignment ${verb}.`)
        await refreshAssignments()
      } catch (err) {
        showToast(`Action failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [refreshAssignments],
  )

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logoutAtlas()
    } finally {
      navigate('/atlas/login', { replace: true })
    }
  }

  const openCount = useMemo(
    () => assignments.filter((a) => a.status === 'open').length,
    [assignments],
  )

  if (meLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950">
        <span className="text-sm text-slate-500">Loading your portal…</span>
      </div>
    )
  }

  if (!me) {
    return <Navigate to="/atlas/login" replace />
  }

  // Owners use the full cockpit, not the simplified portal.
  if (me.role === 'owner') {
    return <Navigate to="/atlas" replace />
  }

  const canAct = me.role === 'admin' || me.role === 'operator'
  const isAdmin = me.role === 'admin'
  const displayName = me.display_name || me.phone

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-950/85 backdrop-blur sticky top-0 z-30 px-4 md:px-6 py-2.5 flex items-center gap-3">
        <span className="grid place-items-center size-7 rounded-md bg-emerald-600 text-white shrink-0">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <h1 className="text-sm font-semibold tracking-tight">
          Atlas Team Portal
          <span className="ml-2 text-slate-400 font-normal">— {displayName}</span>
        </h1>
        <span
          className="ml-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:text-slate-300"
          aria-label={`Your role: ${me.role}`}
        >
          {me.role}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/atlas"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Open the full cockpit"
            >
              Switch to cockpit
            </Link>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="px-2 gap-1.5"
          >
            <LogOut className="size-4" />
            {loggingOut ? 'Signing out…' : 'Logout'}
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {me.role === 'viewer' && (
          <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <span>
              You're signed in as a <strong>viewer</strong>. Assignments are read-only — you can still report errors back to Atlas.
            </span>
          </div>
        )}

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Assigned to you{' '}
            <span className="tabular-nums">({openCount})</span>
          </h2>
          <AssignmentList
            assignments={assignments}
            loading={assignmentsLoading}
            canAct={canAct}
            onResolve={handleResolve}
            busy={busy}
          />
        </section>

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Report an error
          </h2>
          <ReportForm
            onSubmitted={(info) => {
              const note = info.severity === 'high'
                ? 'Report sent — owner pinged on WhatsApp.'
                : 'Report sent — owner sees it in the daily summary.'
              showToast(note)
            }}
          />
        </section>

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            From Atlas
          </h2>
          <AnnouncementsBanner
            announcements={announcements}
            loading={announcementsLoading}
          />
        </section>
      </main>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-1.5 text-xs shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
