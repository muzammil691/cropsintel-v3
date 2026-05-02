import { useEffect, useMemo, useState } from 'react'
import { Activity, RotateCw, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  fetchAgentLogs,
  fetchAtlasMe,
  restartAgent,
  type AgentHeartbeat,
  type AgentLogLine,
  type AtlasRole,
  type AtlasStatus,
} from '@/lib/atlas-client'
import { deriveAgentStatus, formatElapsed, type DerivedAgentStatus } from '@/hooks/useAgentHeartbeats'
import { cn } from '@/lib/utils'

const AGENT_DEFS = [
  {
    key: 'atlas',
    name: 'Atlas',
    role: 'Conductor',
    description: 'Orchestrates the agent fleet, holds chat and trust mode.',
  },
  {
    key: 'builder',
    name: 'Builder',
    role: 'Coder',
    description: 'Picks specs from the queue and ships commits.',
  },
  {
    key: 'verifier',
    name: 'Verifier',
    role: 'Auditor',
    description: 'Runs build/test verification on each commit.',
  },
  {
    key: 'designer',
    name: 'Designer',
    role: 'Reviewer',
    description: 'Audits design + UX gaps in shipped code.',
  },
  {
    key: 'memory',
    name: 'Memory',
    role: 'Knowledge',
    description: 'Ingests + searches the cropsintel knowledge base.',
  },
  {
    key: 'council',
    name: 'Council',
    role: 'Multi-brain',
    description: 'Multi-LLM debate for high-stakes architectural calls.',
  },
  {
    key: 'adela',
    name: 'Adela',
    role: 'Scrapers',
    description: 'Cron-driven ingestion (USDA NASS/AMS, ABC, IMAP).',
  },
] as const
type AgentDef = (typeof AGENT_DEFS)[number]

interface AtlasAgentsTabProps {
  status: AtlasStatus | null
  loading: boolean
  heartbeats?: Record<string, AgentHeartbeat>
}

export default function AtlasAgentsTab({ status: _status, loading, heartbeats }: AtlasAgentsTabProps) {
  const [restartTarget, setRestartTarget] = useState<AgentDef | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [logs, setLogs] = useState<Record<string, { lines: AgentLogLine[]; loading: boolean; error: string | null }>>({})
  const [role, setRole] = useState<AtlasRole | null>(null)

  useEffect(() => {
    fetchAtlasMe().then(me => setRole(me.role)).catch(() => setRole('viewer'))
  }, [])

  const canRestart = role === 'owner' || role === 'admin'
  const restartTargetHb = restartTarget ? heartbeats?.[restartTarget.key] : undefined
  const restartTargetStatus = deriveAgentStatus(restartTargetHb)
  const restartIsDestructive = restartTargetStatus === 'running'

  async function loadLogs(key: string) {
    setLogs(prev => ({ ...prev, [key]: { lines: prev[key]?.lines ?? [], loading: true, error: null } }))
    try {
      const lines = await fetchAgentLogs(key, 50)
      setLogs(prev => ({ ...prev, [key]: { lines, loading: false, error: null } }))
    } catch (err) {
      setLogs(prev => ({
        ...prev,
        [key]: {
          lines: prev[key]?.lines ?? [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }))
    }
  }

  function toggleExpanded(key: string) {
    const next = !expanded[key]
    setExpanded(prev => ({ ...prev, [key]: next }))
    if (next) void loadLogs(key)
  }

  async function handleRestart() {
    if (!restartTarget) return
    setRestarting(true)
    setRestartError(null)
    try {
      await restartAgent(restartTarget.key)
      setRestartTarget(null)
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestarting(false)
    }
  }

  return (
    <TabFrame title="Agents" hint="7 services. Live state, expandable logs, safe restart.">
      {loading && !heartbeats ? (
        <ul className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-20 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {AGENT_DEFS.map((a) => (
            <AgentCard
              key={a.name}
              def={a}
              heartbeat={heartbeats?.[a.key]}
              expanded={!!expanded[a.key]}
              logs={logs[a.key]}
              canRestart={canRestart}
              onToggleExpand={() => toggleExpanded(a.key)}
              onRefreshLogs={() => void loadLogs(a.key)}
              onRestart={() => {
                setRestartError(null)
                setRestartTarget(a)
              }}
            />
          ))}
        </ul>
      )}

      {/* Restart confirmation — destructive when state=running. */}
      <Dialog
        open={restartTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRestartTarget(null)
            setRestartError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <Activity className={cn('size-4', restartIsDestructive ? 'text-red-600' : 'text-amber-600')} />
              Restart {restartTarget?.name}?
            </DialogTitle>
            <DialogDescription>
              {restartIsDestructive ? (
                <>
                  {restartTarget?.name} is currently running{' '}
                  <span className="font-mono">{restartTargetHb?.task ?? 'a task'}</span>
                  {restartTargetHb?.elapsed_s ? ` (${formatElapsed(restartTargetHb.elapsed_s)} in)` : ''}.
                  Restarting will lose this work — the spec will be picked up again from scratch on next boot.
                  Continue?
                </>
              ) : (
                <>This issues a Railway redeploy. The service will briefly drop offline while it boots.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {restartError && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {restartError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestartTarget(null)} disabled={restarting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleRestart()}
              disabled={restarting || !canRestart}
              title={!canRestart ? 'Operator+ required' : undefined}
            >
              {restarting ? 'Restarting…' : restartIsDestructive ? 'Restart (will interrupt task)' : 'Restart'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabFrame>
  )
}

function AgentCard({
  def,
  heartbeat,
  expanded,
  logs,
  canRestart,
  onToggleExpand,
  onRefreshLogs,
  onRestart,
}: {
  def: AgentDef
  heartbeat: AgentHeartbeat | undefined
  expanded: boolean
  logs: { lines: AgentLogLine[]; loading: boolean; error: string | null } | undefined
  canRestart: boolean
  onToggleExpand: () => void
  onRefreshLogs: () => void
  onRestart: () => void
}) {
  const derived = deriveAgentStatus(heartbeat)
  const dotCls = useMemo(() => statusDotCls(derived), [derived])
  const isRunning = derived === 'running'

  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-0.5 size-2.5 rounded-full shrink-0', dotCls.cls, isRunning && 'animate-pulse')}
          aria-label={`${def.name} status: ${derived}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">{def.name}</h3>
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{def.role}</span>
            <span className={cn('ml-auto text-[10px] font-mono', dotCls.text)}>{derived}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{def.description}</p>
          {heartbeat && (heartbeat.task || heartbeat.msg) && (
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 truncate" title={heartbeat.msg ?? ''}>
              {heartbeat.task && (
                <span className="font-mono">{heartbeat.task}</span>
              )}
              {heartbeat.task && heartbeat.elapsed_s > 0 && (
                <span className="text-slate-400"> · {formatElapsed(heartbeat.elapsed_s)}</span>
              )}
              {heartbeat.msg && (
                <span className="text-slate-500 italic"> · {heartbeat.msg}</span>
              )}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors duration-150"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              <FileText className="size-3" />
              Logs
            </button>
            <button
              type="button"
              onClick={onRestart}
              disabled={!canRestart}
              title={!canRestart ? 'Admin+ required' : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 transition-colors duration-150',
                isRunning
                  ? 'border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40'
                  : 'border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40',
                !canRestart && 'opacity-50 cursor-not-allowed',
              )}
            >
              <RotateCw className="size-3" />
              {isRunning ? 'Restart (will interrupt task)' : 'Restart'}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
            <span>last 50 log lines</span>
            <button
              type="button"
              onClick={onRefreshLogs}
              className="rounded hover:bg-slate-200 dark:hover:bg-slate-800 px-1.5 py-0.5"
              disabled={logs?.loading}
            >
              {logs?.loading ? 'loading…' : 'refresh'}
            </button>
          </div>
          {logs?.error ? (
            <div className="px-2 py-2 text-[11px] text-red-600 dark:text-red-400">{logs.error}</div>
          ) : logs?.loading && logs.lines.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-slate-500">loading logs…</div>
          ) : logs && logs.lines.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-slate-500">No log lines yet.</div>
          ) : (
            <pre className="text-[10px] font-mono text-slate-700 dark:text-slate-300 max-h-48 overflow-auto px-2 py-1.5 leading-tight">
              {(logs?.lines ?? []).map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  <span className="text-slate-400">{shortTs(l.ts)} </span>
                  {l.line}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function statusDotCls(status: DerivedAgentStatus): { cls: string; text: string } {
  switch (status) {
    case 'running':
      return { cls: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
    case 'idle':
      return { cls: 'bg-emerald-400', text: 'text-emerald-600/70 dark:text-emerald-400/70' }
    case 'stale':
      return { cls: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
    case 'unreachable':
      return { cls: 'bg-red-500', text: 'text-red-600 dark:text-red-400' }
    default:
      return { cls: 'bg-slate-300 dark:bg-slate-600', text: 'text-slate-400' }
  }
}

function shortTs(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19)
  return d.toISOString().slice(11, 19)
}
