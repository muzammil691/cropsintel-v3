import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, Settings, LogOut, Hammer, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { TrustModeBadge } from './TrustModeBadge'
import {
  fetchAtlasMe,
  logoutAtlas,
  setMode,
  type AtlasCosts,
  type AtlasMe,
  type AtlasStatus,
  type TrustMode,
  type AgentHeartbeat,
} from '@/lib/atlas-client'
import { deriveAgentStatus, formatElapsed } from '@/hooks/useAgentHeartbeats'
import { cn } from '@/lib/utils'

const TRUST_MODES: TrustMode[] = ['passive', 'chat', 'confirm', 'auto', 'stopped']
const AGENT_NAMES = ['Atlas', 'Builder', 'Verifier', 'Designer', 'Memory', 'Council', 'Adela'] as const
type AgentName = (typeof AGENT_NAMES)[number]

type AgentDot = 'green' | 'yellow' | 'red' | 'unknown'

interface AtlasHeaderProps {
  status: AtlasStatus | null
  costs: AtlasCosts | null
  loading: boolean
  trustMode: TrustMode
  onTrustModeChange: (mode: TrustMode) => void
  onOpenAgentsTab: () => void
  heartbeats?: Record<string, AgentHeartbeat>
}

/**
 * Top-of-cockpit header — fixed 48px tall (~), shows logo, status, trust mode,
 * cost-today pill, 7 agent health dots, and a settings drawer trigger.
 */
export function AtlasHeader({
  status,
  costs,
  loading,
  trustMode,
  onTrustModeChange,
  onOpenAgentsTab,
  heartbeats,
}: AtlasHeaderProps) {
  const navigate = useNavigate()
  const [trustDialogOpen, setTrustDialogOpen] = useState(false)
  const [trustUpdating, setTrustUpdating] = useState(false)
  const [costDialogOpen, setCostDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [me, setMe] = useState<AtlasMe | null>(null)

  // Fetch principal once so we can show owner-only header affordances
  // (e.g. "Switch to portal"). Failures are silent — the rest of the
  // header doesn't depend on this data.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchAtlasMe()
        if (!cancelled) setMe(data)
      } catch {
        // ignore — owner controls just stay hidden
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist trust-mode choice across refreshes (defensive — server is the
  // source of truth; the localStorage entry is just an optimistic mirror so
  // the UI doesn't flash on reload).
  useEffect(() => {
    if (trustMode) {
      try {
        window.localStorage.setItem('atlas_trust_mode_hint', trustMode)
      } catch {
        // ignore
      }
    }
  }, [trustMode])

  const overallStatus = computeOverall(status)
  const todayCost = costs?.today ?? 0

  async function handleSetTrust(mode: TrustMode) {
    setTrustUpdating(true)
    try {
      await setMode(mode)
      onTrustModeChange(mode)
    } finally {
      setTrustUpdating(false)
      setTrustDialogOpen(false)
    }
  }

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logoutAtlas()
    } finally {
      navigate('/atlas/login', { replace: true })
    }
  }

  return (
    <header
      className="h-12 border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-950/85 backdrop-blur sticky top-0 z-30 px-3 md:px-4 flex items-center gap-3"
    >
      {/* Left: logo + title + status pill + trust mode */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="grid place-items-center size-7 rounded-md bg-emerald-600 text-white shrink-0">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <h1 className="text-sm font-semibold tracking-tight truncate">
          Atlas <span className="hidden sm:inline text-slate-400 font-normal">Conductor</span>
        </h1>
        <span className="hidden md:block h-5 w-px bg-slate-200 dark:bg-slate-800" />
        <StatusPill kind={overallStatus} loading={loading && !status} />
        <button
          type="button"
          onClick={() => setTrustDialogOpen(true)}
          className="rounded-full transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
          aria-label="Change trust mode"
          title="Change trust mode"
        >
          <TrustModeBadge mode={trustMode} />
        </button>
        <InFlightChip heartbeat={heartbeats?.builder} onClick={onOpenAgentsTab} />
      </div>

      {/* Right: cost pill, agent dots, settings */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {me?.role === 'owner' && (
          <Link
            to="/team"
            className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150"
            title="Preview the team-portal view"
            aria-label="Switch to team portal"
          >
            <Users className="size-3" aria-hidden />
            Switch to portal
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCostDialogOpen(true)}
          className="hidden sm:inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors duration-150"
          aria-label="Open cost detail"
        >
          ${todayCost.toFixed(2)}
        </button>

        <div className="hidden md:flex items-center gap-1" aria-label="Agent health">
          {AGENT_NAMES.map((agent) => {
            const dot = agentDotFor(agent, status)
            return (
              <button
                key={agent}
                type="button"
                onClick={onOpenAgentsTab}
                title={`${agent} — ${dotLabel(dot)} (click for details)`}
                aria-label={`${agent} status: ${dotLabel(dot)}`}
                className="rounded-full p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150"
              >
                <span
                  className={cn(
                    'block size-2.5 rounded-full',
                    dot === 'green' && 'bg-emerald-500',
                    dot === 'yellow' && 'bg-amber-500',
                    dot === 'red' && 'bg-red-500',
                    dot === 'unknown' && 'bg-slate-300 dark:bg-slate-600',
                  )}
                />
              </button>
            )
          })}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open Atlas settings"
          title="Settings"
          className="px-2"
        >
          <Settings className="size-4" />
        </Button>
      </div>

      {/* Trust-mode dialog */}
      <Dialog open={trustDialogOpen} onOpenChange={setTrustDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Trust mode</DialogTitle>
            <DialogDescription>
              Controls how aggressively Atlas can act without asking.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5">
            {TRUST_MODES.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => void handleSetTrust(m)}
                  disabled={trustUpdating}
                  className={cn(
                    'w-full text-left rounded-md border px-3 py-2 text-sm transition-colors duration-150',
                    m === trustMode
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60',
                  )}
                >
                  <div className="font-medium capitalize">{m}</div>
                  <div className="text-xs text-slate-500">{trustModeBlurb(m)}</div>
                </button>
              </li>
            ))}
          </ul>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* Cost dialog */}
      <Dialog open={costDialogOpen} onOpenChange={setCostDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cost today + month-to-date</DialogTitle>
            <DialogDescription>Spend tracked across all Atlas providers.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Today</dt>
              <dd className="font-mono text-base">${(costs?.today ?? 0).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">MTD</dt>
              <dd className="font-mono text-base">${(costs?.month_to_date ?? 0).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Budget</dt>
              <dd className="font-mono text-base">${(costs?.budget ?? 400).toFixed(2)}</dd>
            </div>
          </dl>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* Settings drawer (modal-style) */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Theme, voice, recovery codes, and sign-out.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2 text-sm">
            <li>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false)
                  navigate('/atlas?tab=agents')
                }}
                className="w-full text-left rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors duration-150"
              >
                Voice & live mode → see toolbar above chat
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="w-full text-left rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors duration-150 inline-flex items-center gap-2"
              >
                <LogOut className="size-4" />
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </li>
          </ul>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </header>
  )
}

function StatusPill({ kind, loading }: { kind: 'ok' | 'degraded' | 'issue' | 'unknown'; loading: boolean }) {
  if (loading) {
    return (
      <span className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
        <span className="size-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-pulse" />
        loading
      </span>
    )
  }
  const map: Record<typeof kind, { dot: string; text: string; label: string; tone: string }> = {
    ok: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', label: 'All systems', tone: 'bg-emerald-50 dark:bg-emerald-950/40' },
    degraded: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: 'Degraded', tone: 'bg-amber-50 dark:bg-amber-950/40' },
    issue: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-300', label: 'Issue', tone: 'bg-red-50 dark:bg-red-950/40' },
    unknown: { dot: 'bg-slate-400', text: 'text-slate-500', label: 'Unknown', tone: 'bg-slate-100 dark:bg-slate-800' },
  }
  const m = map[kind]
  return (
    <span className={cn('hidden md:inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', m.tone, m.text)}>
      <span className={cn('size-2 rounded-full', m.dot)} />
      {m.label}
    </span>
  )
}

function computeOverall(status: AtlasStatus | null): 'ok' | 'degraded' | 'issue' | 'unknown' {
  if (!status) return 'unknown'
  if (status.failed_24h && status.failed_24h > 0) return 'degraded'
  if (status.trust_mode === 'stopped') return 'issue'
  return 'ok'
}

// Phase 1.10an MVP: agent health dots are derived from the status snapshot.
// 1.10aj has only Atlas's own deploy info exposed today; the other six agents
// fall back to "unknown" until each one wires its own heartbeat into
// /atlas/status. This keeps the UI shipping on day-1 and lights up
// progressively as backends land.
function agentDotFor(agent: AgentName, status: AtlasStatus | null): AgentDot {
  if (!status) return 'unknown'
  if (agent === 'Atlas') {
    if (status.trust_mode === 'stopped') return 'red'
    if (status.failed_24h && status.failed_24h > 0) return 'yellow'
    return 'green'
  }
  return 'unknown'
}

function dotLabel(d: AgentDot): string {
  switch (d) {
    case 'green':
      return 'healthy'
    case 'yellow':
      return 'degraded'
    case 'red':
      return 'down'
    default:
      return 'no signal'
  }
}

function InFlightChip({
  heartbeat,
  onClick,
}: { heartbeat: AgentHeartbeat | undefined; onClick: () => void }) {
  const status = deriveAgentStatus(heartbeat)
  if (!heartbeat || status !== 'running') return null
  const task = heartbeat.task ?? 'spec'
  const taskShort = task.length > 24 ? task.slice(0, 24) + '…' : task
  const elapsed = formatElapsed(heartbeat.elapsed_s)
  const msg = heartbeat.msg ?? heartbeat.state
  const msgShort = msg.length > 40 ? msg.slice(0, 40) + '…' : msg
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
      title={`Builder running ${task} — ${msg}`}
      aria-label={`Builder running ${task}`}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <Hammer className="size-3" aria-hidden />
      <span className="font-medium">Builder</span>
      <span className="text-emerald-700/80 dark:text-emerald-300/80">·</span>
      <span className="font-mono">{taskShort}</span>
      <span className="text-emerald-700/80 dark:text-emerald-300/80">·</span>
      <span className="font-mono tabular-nums">{elapsed}</span>
      <span className="text-emerald-700/80 dark:text-emerald-300/80 hidden lg:inline">·</span>
      <span className="hidden lg:inline italic truncate max-w-[180px]">{msgShort}</span>
    </button>
  )
}

function trustModeBlurb(m: TrustMode): string {
  switch (m) {
    case 'passive':
      return 'Atlas observes only. Never acts.'
    case 'chat':
      return 'Atlas chats freely but never writes code.'
    case 'confirm':
      return 'Atlas drafts changes; you confirm each one.'
    case 'auto':
      return 'Atlas ships approved patterns autonomously.'
    case 'stopped':
      return 'All Atlas activity halted.'
  }
}
