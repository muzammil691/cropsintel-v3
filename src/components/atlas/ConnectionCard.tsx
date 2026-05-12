// 1.10bb-c Session 9A — Connection card.
//
// 240×140 card rendered in the ConnectionsPage grid. Read-only in 9A —
// supports Test (re-verify against the upstream provider), Reveal (one-shot
// plaintext for source_type='regular' rows), and Delete. Create/Edit/Rotate
// land in 9B (need the per-provider AddConnectionSheet forms first).

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Brain,
  GitBranch,
  Cloud,
  Database,
  MessageSquare,
  CreditCard,
  Sparkles,
  MoreHorizontal,
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  testConnection,
  revealConnection,
  deleteConnection,
  type AtlasConnection,
  type ConnectionProvider,
} from '@/lib/atlas-client'

interface ConnectionCardProps {
  connection: AtlasConnection
  onChanged: () => void
}

const PROVIDER_META: Record<ConnectionProvider, { label: string; Icon: typeof Brain }> = {
  anthropic: { label: 'Anthropic',   Icon: Brain },
  openai:    { label: 'OpenAI',      Icon: Brain },
  gemini:    { label: 'Gemini',      Icon: Brain },
  github:    { label: 'GitHub',      Icon: GitBranch },
  vercel:    { label: 'Vercel',      Icon: Cloud },
  netlify:   { label: 'Netlify',     Icon: Cloud },
  railway:   { label: 'Railway',     Icon: Cloud },
  supabase:  { label: 'Supabase',    Icon: Database },
  neon:      { label: 'Neon',        Icon: Database },
  twilio:    { label: 'Twilio',      Icon: MessageSquare },
  stripe:    { label: 'Stripe',      Icon: CreditCard },
  custom:    { label: 'Custom',      Icon: Sparkles },
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never tested'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function statusDotClass(status: AtlasConnection['last_verify_status']): string {
  switch (status) {
    case 'verified':
      return 'bg-emerald-500'
    case 'expired':
      return 'bg-yellow-500'
    case 'failing':
      return 'bg-rose-500'
    default:
      return 'bg-slate-400'
  }
}

function statusLabel(status: AtlasConnection['last_verify_status']): string {
  switch (status) {
    case 'verified':
      return 'Verified'
    case 'expired':
      return 'Expired'
    case 'failing':
      return 'Failing'
    default:
      return 'Not tested'
  }
}

export function ConnectionCard({ connection, onChanged }: ConnectionCardProps) {
  const [busy, setBusy] = useState<'test' | 'reveal' | 'delete' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)

  const meta = PROVIDER_META[connection.provider]
  const Icon = meta.Icon

  async function handleTest() {
    setBusy('test')
    setMenuOpen(false)
    try {
      const result = await testConnection(connection.id)
      if (result.ok) {
        toast.success(`${meta.label} verified${result.identity ? ` — ${result.identity}` : ''}`, { duration: 4000 })
      } else {
        toast.error(`${meta.label} test failed${result.status ? ` (${result.status})` : ''}: ${result.error ?? 'unknown error'}`, { duration: 6000 })
      }
      onChanged()
    } catch (err) {
      toast.error(`Test request failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleReveal() {
    if (revealed) {
      setRevealed(null)
      return
    }
    if (connection.sensitivity === 'production_sensitive') {
      toast.error('Reveal blocked for production-sensitive secrets. Rotate to issue a new key.')
      setMenuOpen(false)
      return
    }
    setBusy('reveal')
    setMenuOpen(false)
    try {
      const r = await revealConnection(connection.id)
      setRevealed(r.secret)
    } catch (err) {
      toast.error(`Reveal failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete() {
    setMenuOpen(false)
    const confirmed = window.confirm(
      `Delete the ${meta.label} connection${connection.label ? ` "${connection.label}"` : ''}? This cannot be undone.`,
    )
    if (!confirmed) return
    setBusy('delete')
    try {
      await deleteConnection(connection.id)
      toast.success(`Deleted ${meta.label} connection`, { duration: 4000 })
      onChanged()
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(null)
    }
  }

  return (
    <div
      data-testid="connection-card"
      className={cn(
        'relative w-full sm:w-60 h-36 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 flex flex-col transition-colors duration-150',
        connection.last_verify_status === 'failing' && 'border-rose-300 dark:border-rose-900',
      )}
    >
      {/* Top row: icon + label + status dot */}
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 text-slate-700 dark:text-slate-300 shrink-0" aria-hidden />
        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate flex-1">
          {meta.label}{connection.label ? ` · ${connection.label}` : ''}
        </span>
        <span
          className={cn('inline-block size-2 rounded-full shrink-0', statusDotClass(connection.last_verify_status))}
          title={statusLabel(connection.last_verify_status)}
          aria-label={statusLabel(connection.last_verify_status)}
        />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Connection actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="rounded p-0.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Middle: masked value (or revealed value if toggled) */}
      <div className="flex-1 flex items-center justify-center min-h-0 my-2">
        <code
          className={cn(
            'text-[11px] font-mono break-all px-1 rounded',
            revealed
              ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40'
              : 'text-slate-600 dark:text-slate-300',
          )}
        >
          {revealed ?? connection.masked}
        </code>
      </div>

      {/* Bottom row: relative timestamp + sensitivity hint */}
      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1 truncate">
          {connection.last_verify_status === 'verified' && <ShieldCheck className="size-3 text-emerald-600" aria-hidden />}
          {connection.last_verify_status === 'failing' && <TriangleAlert className="size-3 text-rose-600" aria-hidden />}
          {busy === 'test' ? 'Testing…' : `${statusLabel(connection.last_verify_status)} ${relativeTime(connection.last_verified_at)}`}
        </span>
        {connection.sensitivity === 'production_sensitive' && (
          <span className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-1 text-amber-800 dark:text-amber-200">
            prod-sensitive
          </span>
        )}
      </div>

      {/* Failing reason — surfaces verbatim under the card content. */}
      {connection.last_verify_error && connection.last_verify_status === 'failing' && (
        <p className="absolute left-3 right-3 -bottom-7 text-[10px] text-rose-600 dark:text-rose-400 truncate" title={connection.last_verify_error}>
          {connection.last_verify_error}
        </p>
      )}

      {/* Kebab menu */}
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-2 top-9 z-20 w-36 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-lg overflow-hidden"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <MenuItem icon={<RefreshCw className="size-3" />} onClick={handleTest} disabled={busy !== null}>
            {busy === 'test' ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" aria-hidden />Testing…</span> : 'Test connection'}
          </MenuItem>
          <MenuItem
            icon={revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            onClick={handleReveal}
            disabled={busy !== null || connection.sensitivity === 'production_sensitive'}
          >
            {revealed ? 'Hide value' : busy === 'reveal' ? 'Revealing…' : 'Reveal'}
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-3 text-rose-600" />} onClick={handleDelete} disabled={busy !== null} danger>
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon, onClick, children, disabled, danger,
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 w-full px-2 py-1.5 text-[11px] text-left transition-colors duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
        danger
          ? 'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40'
          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

export default ConnectionCard
