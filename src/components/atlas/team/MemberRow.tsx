import { useState } from 'react'
import { LogOut, Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AtlasRole, AtlasTeamMember } from '@/lib/atlas-client'
import { RoleBadge } from './RoleBadge'

interface MemberRowProps {
  member: AtlasTeamMember
  /** Whether the viewer has owner rights — controls the editable controls. */
  isOwnerViewer: boolean
  /** True when this row IS the current logged-in owner — locks self-modify. */
  isSelf: boolean
  onChangeRole: (id: string, role: AtlasRole) => Promise<void> | void
  onChangeStatus: (id: string, status: 'active' | 'suspended' | 'revoked') => Promise<void> | void
  onRevokeAllSessions: (id: string) => Promise<void> | void
  busy?: boolean
}

const ASSIGNABLE_ROLES: AtlasRole[] = ['admin', 'operator', 'viewer']

function initials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).slice(0, 2)
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  }
  // Fall back to last 2 digits of the phone.
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-2)
}

function formatLastSeen(ts: string | null): string {
  if (!ts) return 'Never'
  const ms = Date.now() - new Date(ts).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export function MemberRow({
  member,
  isOwnerViewer,
  isSelf,
  onChangeRole,
  onChangeStatus,
  onRevokeAllSessions,
  busy,
}: MemberRowProps) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const isOwner = member.role === 'owner'
  const canEdit = isOwnerViewer && !isSelf && !isOwner

  return (
    <li className="flex items-start gap-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2.5">
      <span
        className="grid place-items-center size-9 shrink-0 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 text-xs font-semibold"
        aria-hidden
      >
        {initials(member.display_name, member.phone) || '??'}
      </span>

      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-1 sm:gap-2 items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {member.display_name || '(no name)'}
            </span>
            <RoleBadge role={member.role} />
            <StatusPill status={member.status} />
            {isSelf && (
              <span className="text-[10px] uppercase tracking-wide text-slate-400">You</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{member.phone}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Last seen {formatLastSeen(member.last_seen_at)}
            {member.active_session_count > 0 && (
              <> · {member.active_session_count} active session{member.active_session_count === 1 ? '' : 's'}</>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
          {canEdit && (
            <>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="sr-only">Role for {member.phone}</span>
                <select
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={member.role}
                  disabled={busy}
                  onChange={(e) => void onChangeRole(member.id, e.target.value as AtlasRole)}
                  aria-label={`Change role for ${member.phone}`}
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-7 px-2 text-xs gap-1"
                onClick={() => void onRevokeAllSessions(member.id)}
                title="Force log out of every device"
              >
                <LogOut className="size-3" /> Force logout
              </Button>
              {member.status === 'active' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => void onChangeStatus(member.id, 'suspended')}
                  title="Block sign-in but keep history"
                >
                  <Pause className="size-3" /> Suspend
                </Button>
              )}
              {member.status === 'suspended' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => void onChangeStatus(member.id, 'active')}
                  title="Re-enable sign-in"
                >
                  <Play className="size-3" /> Reactivate
                </Button>
              )}
              {member.status !== 'revoked' && (
                <>
                  {!confirmRevoke ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="h-7 px-2 text-xs gap-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      onClick={() => setConfirmRevoke(true)}
                      title="Permanently revoke access"
                    >
                      <Trash2 className="size-3" /> Revoke
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px]">
                      <span className="text-slate-500">Sure?</span>
                      <button
                        type="button"
                        className="font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        disabled={busy}
                        onClick={() => {
                          setConfirmRevoke(false)
                          void onChangeStatus(member.id, 'revoked')
                        }}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                        disabled={busy}
                        onClick={() => setConfirmRevoke(false)}
                      >
                        No
                      </button>
                    </span>
                  )}
                </>
              )}
            </>
          )}
          {isSelf && (
            <span
              className="text-[10px] text-slate-400 italic"
              title="Owner role can only be transferred via direct database operation"
            >
              Self-modify disabled
            </span>
          )}
          {isOwner && !isSelf && (
            <span className="text-[10px] text-slate-400 italic">Owner — DB-only edit</span>
          )}
        </div>
      </div>
    </li>
  )
}

function StatusPill({ status }: { status: 'active' | 'suspended' | 'revoked' }) {
  const styles =
    status === 'active'
      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
      : status === 'suspended'
        ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
        : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] uppercase ${styles}`}>
      {status}
    </span>
  )
}
