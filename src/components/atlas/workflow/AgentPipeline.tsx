import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AtlasStatus, RecentShip, AgentHeartbeat } from '@/lib/atlas-client'
import { deriveAgentStatus, formatElapsed, type DerivedAgentStatus } from '@/hooks/useAgentHeartbeats'

type AgentStatus = 'success' | 'deploying' | 'failed' | 'idle' | 'stale' | 'unreachable'

interface AgentNode {
  key: string
  name: string
  description: string
}

const AGENTS: AgentNode[] = [
  { key: 'atlas', name: 'Atlas', description: 'Plan + chat' },
  { key: 'builder', name: 'Builder', description: 'Spec → code' },
  { key: 'verifier', name: 'Verifier', description: 'Audit gate' },
  { key: 'council', name: 'Council', description: 'Debate gate' },
  { key: 'multi-brain', name: 'Multi-Brain', description: 'Claude + GPT + Gemini' },
  { key: 'memory', name: 'Memory', description: 'RAG store' },
  { key: 'adela', name: 'Adela', description: 'Scrapers' },
  { key: 'designer', name: 'Designer', description: 'UI review' },
]

// Builder's elapsed-budget for the inline progress bar (30 min, per spec).
const ELAPSED_BUDGET_S = 30 * 60

interface AgentPipelineProps {
  status: AtlasStatus | null
  onOpenAgents: () => void
  heartbeats?: Record<string, AgentHeartbeat>
}

export function AgentPipeline({ status, onOpenAgents, heartbeats }: AgentPipelineProps) {
  const ships = status?.recent_ships ?? []

  return (
    <div
      className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4"
      style={{ minHeight: 280 }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Agent pipeline
        </h3>
        <span className="text-[10px] text-slate-400">click an agent to open the Agents tab</span>
      </div>

      {/* Horizontal scrollable flow on small screens. */}
      <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
        {AGENTS.map((agent, i) => {
          const heartbeat = heartbeats?.[agent.key]
          const derived = deriveAgentStatus(heartbeat)
          const agentStatus = mapAgentStatus(derived, agent.key, ships, status)
          const liveLabel = liveLabelFor(heartbeat, derived)
          const lastSeen = liveLabel ?? deriveLastSeen(agent.key, ships)
          const showProgress = derived === 'running' && heartbeat?.elapsed_s != null && heartbeat.elapsed_s > 0
          return (
            <div key={agent.key} className="flex items-center shrink-0">
              <button
                type="button"
                onClick={onOpenAgents}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border bg-white dark:bg-slate-950 px-3 py-2 text-left transition-colors',
                  'hover:border-emerald-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  derived === 'running' ? 'border-emerald-300 dark:border-emerald-800 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]' : 'border-slate-200 dark:border-slate-800',
                  'min-w-[120px]',
                )}
                aria-label={`${agent.name} — ${agentStatus}`}
              >
                <div className="flex items-center gap-1.5">
                  <StatusDot status={agentStatus} />
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    {agent.name}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">{agent.description}</p>
                <p className="text-[10px] tabular-nums text-slate-400 truncate max-w-[120px]" title={lastSeen ?? ''}>
                  {lastSeen ?? 'no activity'}
                </p>
                {showProgress && (
                  <div
                    className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                    aria-label={`Elapsed ${formatElapsed(heartbeat!.elapsed_s)} of 30:00 budget`}
                  >
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, ((heartbeat!.elapsed_s) / ELAPSED_BUDGET_S) * 100)}%` }}
                    />
                  </div>
                )}
              </button>
              {i < AGENTS.length - 1 && (
                <ArrowRight
                  className="size-3.5 text-slate-300 dark:text-slate-700 shrink-0 mx-0.5"
                  aria-hidden
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === 'deploying') {
    return (
      <span aria-hidden className="relative flex size-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
      </span>
    )
  }
  const cls =
    status === 'success' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
    : status === 'unreachable' ? 'bg-red-500'
    : status === 'stale' ? 'bg-amber-500'
    : 'bg-slate-300 dark:bg-slate-700'
  return <span aria-hidden className={cn('size-2.5 rounded-full', cls)} />
}

function mapAgentStatus(
  derived: DerivedAgentStatus,
  key: string,
  ships: RecentShip[],
  status: AtlasStatus | null,
): AgentStatus {
  if (derived === 'running') return 'deploying'
  if (derived === 'unreachable') return 'unreachable'
  if (derived === 'stale') return 'stale'
  if (derived === 'idle') return 'success'
  // 'unknown' — fall back to the legacy ship-based heuristic so we don't blank out.
  return legacyStatus(key, ships, status)
}

function legacyStatus(key: string, ships: RecentShip[], status: AtlasStatus | null): AgentStatus {
  if (key === 'verifier') {
    const lastVerifier = ships.find(s => s.type === 'verifier_run')
    if (!lastVerifier) return 'idle'
    return lastVerifier.verdict === 'pass' ? 'success' : 'failed'
  }
  if (key === 'builder') {
    if ((status?.in_flight ?? 0) > 0) return 'deploying'
    if ((status?.failed_24h ?? 0) > 0) return 'failed'
    if (ships.some(s => s.type === 'commit')) return 'success'
    return 'idle'
  }
  if (key === 'atlas') {
    return ships.length > 0 ? 'success' : 'idle'
  }
  return ships.length > 0 ? 'success' : 'idle'
}

function liveLabelFor(heartbeat: AgentHeartbeat | undefined, derived: DerivedAgentStatus): string | null {
  if (!heartbeat) return null
  if (derived === 'running') {
    const task = heartbeat.task ?? heartbeat.state
    return `${task} · ${formatElapsed(heartbeat.elapsed_s)}`
  }
  if (derived === 'unreachable') return 'unreachable'
  if (derived === 'stale') return `stale (${formatRelativeTime(heartbeat.updated_at)})`
  if (derived === 'idle') return `idle · ${formatRelativeTime(heartbeat.updated_at)}`
  return null
}

function deriveLastSeen(key: string, ships: RecentShip[]): string | null {
  let row: RecentShip | undefined
  if (key === 'verifier') {
    row = ships.find(s => s.type === 'verifier_run')
  } else if (key === 'builder' || key === 'atlas') {
    row = ships.find(s => s.type === 'commit')
  } else {
    row = ships[0]
  }
  if (!row) return null
  return formatRelativeTime(row.created_at)
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
