import { useState } from 'react'
import { Copy, RefreshCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AtlasTeamInvite } from '@/lib/atlas-client'
import { RoleBadge } from './RoleBadge'

interface InviteRowProps {
  invite: AtlasTeamInvite
  isOwnerViewer: boolean
  onResend: (invite: AtlasTeamInvite) => Promise<void> | void
  onRevoke: (id: string) => Promise<void> | void
  busy?: boolean
}

function expiresInLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function InviteRow({ invite, isOwnerViewer, onResend, onRevoke, busy }: InviteRowProps) {
  const [copied, setCopied] = useState(false)

  async function copyInviteUrl() {
    // We never get the token back from the list endpoint (server strips it).
    // Resending generates a fresh token; for "copy" we can fall back to the
    // login URL with the phone prefilled so the invitee still has a useful link.
    const base = (typeof window !== 'undefined' && window.location?.origin) || ''
    const url = `${base}/atlas/login?phone=${encodeURIComponent(invite.phone)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be blocked in non-secure contexts; ignore.
    }
  }

  return (
    <li className="flex items-start gap-3 rounded-md border border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-950/10 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {invite.display_name || invite.phone}
          </span>
          <RoleBadge role={invite.role} />
          <span className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Pending
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{invite.phone}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Expires in {expiresInLabel(invite.expires_at)} · Sent {new Date(invite.created_at).toLocaleString()}
        </p>
      </div>

      {isOwnerViewer && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => void onResend(invite)}
            title="Generate a fresh token + re-send the WhatsApp"
          >
            <RefreshCcw className="size-3" /> Resend
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => void copyInviteUrl()}
            title="Copy login URL"
          >
            <Copy className="size-3" /> {copied ? 'Copied' : 'Copy URL'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            className="h-7 px-2 text-xs gap-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors duration-200"
            onClick={() => void onRevoke(invite.id)}
            title="Revoke this invite"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      )}
    </li>
  )
}
