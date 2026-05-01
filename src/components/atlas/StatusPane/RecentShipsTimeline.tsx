import { CheckCircle2, XCircle, MinusCircle, GitCommit } from 'lucide-react'
import type { RecentShip } from '@/lib/atlas-client'

interface RecentShipsTimelineProps {
  ships: RecentShip[]
  loading: boolean
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function VerdictGlyph({ verdict }: { verdict?: RecentShip['verdict'] }) {
  if (verdict === 'pass') return <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
  if (verdict === 'fail') return <XCircle className="size-3.5 text-red-500 shrink-0" />
  return <MinusCircle className="size-3.5 text-slate-400 shrink-0" />
}

export function RecentShipsTimeline({ ships, loading }: RecentShipsTimelineProps) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
      <h3 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
        Recent activity
      </h3>

      {loading && ships.length === 0 && (
        <ul className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-6 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </ul>
      )}

      {!loading && ships.length === 0 && (
        <p className="text-xs text-slate-400 py-2">No recent activity.</p>
      )}

      {ships.length > 0 && (
        <ol className="relative">
          {/* Timeline rail */}
          <span
            aria-hidden
            className="absolute left-[8px] top-1.5 bottom-1.5 w-px bg-slate-200 dark:bg-slate-800"
          />
          {ships.slice(0, 12).map((ship) => (
            <li key={ship.id} className="relative pl-6 py-1">
              <span className="absolute left-0 top-1.5">
                <VerdictGlyph verdict={ship.verdict} />
              </span>
              <div className="flex items-baseline gap-2">
                <GitCommit className="size-3 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-700 dark:text-slate-200 line-clamp-1 flex-1 min-w-0">
                  {ship.summary}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                  {relativeTime(ship.created_at)}
                </span>
              </div>
              {ship.sha && (
                <span className="text-[10px] font-mono text-slate-400 ml-5">{ship.sha.slice(0, 7)}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
