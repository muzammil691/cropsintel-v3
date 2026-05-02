import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AtlasStatus, RecentShip } from '@/lib/atlas-client'

type AgentStatus = 'success' | 'deploying' | 'failed' | 'idle'

interface AgentNode {
  key: string
  name: string
  description: string
}

const AGENTS: AgentNode[] = [
  { key: 'atlas', name: 'Atlas', description: 'Plan + chat' },
  { key: 'builder', name: 'Builder', description: 'Spec → code' },
  { key: 'verifier', name: 'Verifier', description: 'Audit gate' },
  { key: 'designer', name: 'Designer', description: 'UI review' },
  { key: 'council', name: 'Council', description: 'Multi-brain' },
  { key: 'memory', name: 'Memory', description: 'RAG store' },
  { key: 'adela', name: 'Adela', description: 'Scrapers' },
]

interface AgentPipelineProps {
  status: AtlasStatus | null
  onOpenAgents: () => void
}

export function AgentPipeline({ status, onOpenAgents }: AgentPipelineProps) {
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
          const agentStatus = deriveAgentStatus(agent.key, ships, status)
          const lastSeen = deriveLastSeen(agent.key, ships)
          return (
            <div key={agent.key} className="flex items-center shrink-0">
              <button
                type="button"
                onClick={onOpenAgents}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border bg-white dark:bg-slate-950 px-3 py-2 text-left transition-colors',
                  'hover:border-emerald-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'border-slate-200 dark:border-slate-800',
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
                <p className="text-[10px] tabular-nums text-slate-400">
                  {lastSeen ?? 'no activity'}
                </p>
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
  const cls =
    status === 'success' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
    : status === 'deploying' ? 'bg-amber-500 animate-pulse'
    : 'bg-slate-300 dark:bg-slate-700'
  return <span aria-hidden className={cn('size-2 rounded-full', cls)} />
}

function deriveAgentStatus(
  key: string,
  ships: RecentShip[],
  status: AtlasStatus | null,
): AgentStatus {
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
  // designer / council / memory / adela: best-effort from recent activity.
  return ships.length > 0 ? 'success' : 'idle'
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
