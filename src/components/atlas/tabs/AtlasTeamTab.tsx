import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import { MemberRow } from '../team/MemberRow'
import { InviteRow } from '../team/InviteRow'
import { InviteForm } from '../team/InviteForm'
import { Button } from '@/components/ui/button'
import {
  fetchAtlasMe,
  fetchTeamMembers,
  fetchTeamInvites,
  fetchTeamAuditLog,
  createTeamInvite,
  revokeTeamInvite,
  updateTeamMember,
  revokeAllMemberSessions,
  AtlasUnauthorizedError,
  type AtlasMe,
  type AtlasTeamMember,
  type AtlasTeamInvite,
  type AtlasTeamAuditEntry,
  type AtlasRole,
} from '@/lib/atlas-client'

const POLL_INTERVAL_MS = 15_000

export default function AtlasTeamTab() {
  const [me, setMe] = useState<AtlasMe | null>(null)
  const [members, setMembers] = useState<AtlasTeamMember[]>([])
  const [invites, setInvites] = useState<AtlasTeamInvite[]>([])
  const [auditLog, setAuditLog] = useState<AtlasTeamAuditEntry[]>([])
  const [auditOpen, setAuditOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteInfo, setInviteInfo] = useState<string | null>(null)

  const isOwner = me?.role === 'owner'
  const isAdminOrOwner = me?.role === 'owner' || me?.role === 'admin'

  const refresh = useCallback(async () => {
    if (!isAdminOrOwner) return
    try {
      const [membersData, invitesData] = await Promise.all([
        fetchTeamMembers(),
        fetchTeamInvites(),
      ])
      setMembers(membersData)
      setInvites(invitesData)
      setError(null)
    } catch (err) {
      if (err instanceof AtlasUnauthorizedError) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [isAdminOrOwner])

  // Fetch the principal once on mount; team data + audit log on a 15s poll.
  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true)
      try {
        const meData = await fetchAtlasMe()
        if (cancelled) return
        setMe(meData)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAdminOrOwner) return
    void refresh()
    const t = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [isAdminOrOwner, refresh])

  // Audit log is owner-only and lazy-loaded.
  useEffect(() => {
    if (!auditOpen || !isOwner) return
    let cancelled = false
    void (async () => {
      try {
        const entries = await fetchTeamAuditLog()
        if (!cancelled) setAuditLog(entries)
      } catch {
        // Non-fatal: errors render inline.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [auditOpen, isOwner])

  const handleInvite = useCallback(
    async ({ phone, role, display_name }: { phone: string; role: 'admin' | 'operator' | 'viewer'; display_name: string }) => {
      setBusy(true)
      setInviteError(null)
      setInviteInfo(null)
      try {
        const result = await createTeamInvite({ phone, role, display_name: display_name || undefined })
        setInviteInfo(
          result.is_new
            ? `Invite sent to ${phone} (WhatsApp ${result.whatsapp_sent ? 'delivered' : 'failed'}).`
            : `Existing invite refreshed for ${phone} (token regenerated, expiry extended).`,
        )
        await refresh()
      } catch (err) {
        setInviteError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const handleResend = useCallback(
    async (invite: AtlasTeamInvite) => {
      // Resend = re-create-or-refresh with same params; backend regenerates token + extends expiry.
      await handleInvite({
        phone: invite.phone,
        role: invite.role,
        display_name: invite.display_name ?? '',
      })
    },
    [handleInvite],
  )

  const handleRevokeInvite = useCallback(
    async (id: string) => {
      setBusy(true)
      try {
        await revokeTeamInvite(id)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const handleChangeRole = useCallback(
    async (id: string, role: AtlasRole) => {
      setBusy(true)
      try {
        await updateTeamMember(id, { role })
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const handleChangeStatus = useCallback(
    async (id: string, status: 'active' | 'suspended' | 'revoked') => {
      setBusy(true)
      try {
        await updateTeamMember(id, { status })
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const handleRevokeSessions = useCallback(async (id: string) => {
    setBusy(true)
    try {
      await revokeAllMemberSessions(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const rank: Record<AtlasRole, number> = { owner: 0, admin: 1, operator: 2, viewer: 3 }
      if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role]
      return (a.display_name ?? a.phone).localeCompare(b.display_name ?? b.phone)
    })
  }, [members])

  if (!loading && !isAdminOrOwner) {
    return (
      <TabFrame
        title="Team"
        hint="Manage Atlas members, invitations, and roles."
      >
        <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
          <span className="grid place-items-center size-10 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <ShieldAlert className="size-5" />
          </span>
          <p className="text-sm font-medium">Admin access required</p>
          <p className="text-xs text-slate-500 max-w-[280px]">
            The Team tab is visible to admins and the owner. Ask the owner if you need elevated access.
          </p>
        </div>
      </TabFrame>
    )
  }

  return (
    <TabFrame
      title="Team"
      hint="Members, pending invites, and team-audit log."
      rightSlot={
        me?.role && (
          <span className="text-[11px] text-slate-500">
            You: <span className="font-semibold text-slate-700 dark:text-slate-200">{me.role}</span>
          </span>
        )
      }
    >
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {isOwner && (
        <div className="mb-4">
          <InviteForm onSubmit={handleInvite} busy={busy} error={inviteError} info={inviteInfo} />
        </div>
      )}

      <section className="space-y-2 mb-5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Users className="size-3" /> Members <span className="tabular-nums">({sortedMembers.length})</span>
        </h3>
        {loading && sortedMembers.length === 0 ? (
          <ul className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className="h-16 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </ul>
        ) : sortedMembers.length === 0 ? (
          <p className="text-xs text-slate-500">No members yet.</p>
        ) : (
          <ul className="space-y-2">
            {sortedMembers.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isOwnerViewer={isOwner}
                isSelf={m.id === me?.member_id}
                onChangeRole={handleChangeRole}
                onChangeStatus={handleChangeStatus}
                onRevokeAllSessions={handleRevokeSessions}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 mb-5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Pending invites <span className="tabular-nums">({invites.length})</span>
        </h3>
        {invites.length === 0 ? (
          <p className="text-xs text-slate-500">No pending invites.</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => (
              <InviteRow
                key={inv.id}
                invite={inv}
                isOwnerViewer={isOwner}
                onResend={handleResend}
                onRevoke={handleRevokeInvite}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </section>

      {isOwner && (
        <section className="border-t border-slate-200 dark:border-slate-800 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAuditOpen((v) => !v)}
            className="h-7 px-2 text-xs gap-1 text-slate-600 dark:text-slate-300"
          >
            {auditOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Audit log
          </Button>
          {auditOpen && <AuditLogList entries={auditLog} />}
        </section>
      )}
    </TabFrame>
  )
}

function AuditLogList({ entries }: { entries: AtlasTeamAuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500 mt-2">No actions logged yet.</p>
  }
  return (
    <ul className="mt-2 space-y-1.5 max-h-80 overflow-y-auto pr-1">
      {entries.map((e) => (
        <li
          key={e.id}
          className="text-[11px] text-slate-600 dark:text-slate-300 grid grid-cols-[auto_1fr] gap-2 items-start font-mono"
        >
          <span className="text-slate-400 tabular-nums">
            {new Date(e.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
          </span>
          <span className="break-words">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{e.action}</span>
            {e.actor_phone && <> by {e.actor_phone}</>}
            {e.target_phone && <> → {e.target_phone}</>}
            {e.details && Object.keys(e.details).length > 0 && (
              <span className="text-slate-400"> · {JSON.stringify(e.details)}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
