import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { TabFrame } from './AtlasPlanTab'
import type { AtlasStatus, RecentShip, DesignAudit } from '@/lib/atlas-client'

interface AtlasAuditTabProps {
  status: AtlasStatus | null
  designAudits: DesignAudit[]
  loading: boolean
}

/**
 * Combined verifier_runs + designer_runs timeline. Sources data from the
 * existing /atlas/status `recent_ships` (verifier verdicts) and the artifact
 * polling stream (`designAudits`). 1.10ak ships richer detail; this tab
 * already lights up on day-1 thanks to existing endpoints.
 */
export default function AtlasAuditTab({ status, designAudits, loading }: AtlasAuditTabProps) {
  const ships = status?.recent_ships ?? []
  const verifierRuns = ships.filter((s) => s.type === 'verifier_run')
  const failedRuns = verifierRuns.filter((s) => s.verdict === 'fail')

  return (
    <TabFrame
      title="Audit"
      hint={`${verifierRuns.length} verifier runs · ${designAudits.length} designer audits`}
      rightSlot={
        failedRuns.length > 0 ? (
          <span className="text-[11px] text-red-600 dark:text-red-400 tabular-nums">
            {failedRuns.length} failed
          </span>
        ) : null
      }
    >
      {loading && verifierRuns.length === 0 && designAudits.length === 0 ? (
        <ul className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-7 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      ) : verifierRuns.length === 0 && designAudits.length === 0 ? (
        <p className="text-xs text-slate-500 py-4">No audit activity in the last 24h.</p>
      ) : (
        <div className="space-y-4">
          {verifierRuns.length > 0 && (
            <Section title="Verifier runs">
              <ol className="space-y-1">
                {verifierRuns.slice(0, 25).map((s) => (
                  <ShipRow key={s.id} ship={s} />
                ))}
              </ol>
            </Section>
          )}

          {designAudits.length > 0 && (
            <Section title="Designer audits">
              <ol className="space-y-1.5">
                {designAudits.slice(0, 25).map((a) => (
                  <li
                    key={a.id}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  >
                    <div className="flex items-baseline gap-2 text-xs">
                      <VerdictGlyph verdict={a.verdict as RecentShip['verdict']} />
                      <span className="font-mono text-slate-700 dark:text-slate-200 truncate">
                        {a.task_id}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-auto tabular-nums">
                        {new Date(a.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {a.gaps.length > 0
                        ? `${a.gaps.length} gap${a.gaps.length === 1 ? '' : 's'}: ${
                            a.gaps[0].description ?? a.gaps[0].check ?? 'no detail'
                          }`
                        : 'no gaps reported'}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      )}
    </TabFrame>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
        {title}
      </h3>
      {children}
    </section>
  )
}

function ShipRow({ ship }: { ship: RecentShip }) {
  return (
    <li className="flex items-baseline gap-2 text-xs px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors duration-100">
      <VerdictGlyph verdict={ship.verdict} />
      <span className="text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">
        {ship.summary}
      </span>
      {ship.sha && <span className="text-[10px] font-mono text-slate-400">{ship.sha.slice(0, 7)}</span>}
      <span className="text-[10px] text-slate-400 tabular-nums">
        {new Date(ship.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    </li>
  )
}

function VerdictGlyph({ verdict }: { verdict?: RecentShip['verdict'] }) {
  if (verdict === 'pass') return <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
  if (verdict === 'fail') return <XCircle className="size-3.5 text-red-500 shrink-0" />
  return <MinusCircle className="size-3.5 text-slate-400 shrink-0" />
}
