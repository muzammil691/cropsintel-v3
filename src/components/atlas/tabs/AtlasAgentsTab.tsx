import { useState } from 'react'
import { Activity, RotateCw, FileText } from 'lucide-react'
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
import type { AtlasStatus } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

const AGENT_DEFS = [
  {
    name: 'Atlas',
    role: 'Conductor',
    description: 'Orchestrates the agent fleet, holds chat and trust mode.',
  },
  {
    name: 'Builder',
    role: 'Coder',
    description: 'Picks specs from the queue and ships commits.',
  },
  {
    name: 'Verifier',
    role: 'Auditor',
    description: 'Runs build/test verification on each commit.',
  },
  {
    name: 'Designer',
    role: 'Reviewer',
    description: 'Audits design + UX gaps in shipped code.',
  },
  {
    name: 'Memory',
    role: 'Knowledge',
    description: 'Ingests + searches the cropsintel knowledge base.',
  },
  {
    name: 'Council',
    role: 'Multi-brain',
    description: 'Multi-LLM debate for high-stakes architectural calls.',
  },
  {
    name: 'Adela',
    role: 'Scrapers',
    description: 'Cron-driven ingestion (USDA NASS/AMS, ABC, IMAP).',
  },
] as const
type AgentDef = (typeof AGENT_DEFS)[number]

interface AtlasAgentsTabProps {
  status: AtlasStatus | null
  loading: boolean
}

export default function AtlasAgentsTab({ status, loading }: AtlasAgentsTabProps) {
  const [restartTarget, setRestartTarget] = useState<AgentDef | null>(null)

  return (
    <TabFrame title="Agents" hint="7 services. Health, last deploy, restart.">
      {loading && !status ? (
        <ul className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-20 rounded-md bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {AGENT_DEFS.map((a) => (
            <li
              key={a.name}
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3"
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-0.5 size-2.5 rounded-full shrink-0',
                    a.name === 'Atlas' ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
                  )}
                  aria-label={`${a.name} status`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">{a.name}</h3>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">{a.role}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{a.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors duration-150"
                      title="Open Railway logs (coming soon)"
                    >
                      <FileText className="size-3" />
                      Logs
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestartTarget(a)}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors duration-150"
                    >
                      <RotateCw className="size-3" />
                      Restart
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Restart confirmation — destructive actions never auto-fire. */}
      <Dialog open={restartTarget !== null} onOpenChange={(o) => !o && setRestartTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="inline-flex items-center gap-2">
              <Activity className="size-4 text-amber-600" />
              Restart {restartTarget?.name}?
            </DialogTitle>
            <DialogDescription>
              This issues a Railway redeploy. Any in-flight work on that service will be cancelled.
              Restart wiring lands in 1.10ak — for now this is a confirmation-only stub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestartTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => setRestartTarget(null)}
              disabled
              title="Restart endpoint not deployed yet"
            >
              Restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabFrame>
  )
}
