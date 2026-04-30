import { GitCommit, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import type { RecentShip } from '@/lib/atlas-client'

interface RecentShipsProps {
  ships: RecentShip[]
  loading?: boolean
}

function VerdictIcon({ verdict }: { verdict?: RecentShip['verdict'] }) {
  if (verdict === 'pass')
    return <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
  if (verdict === 'fail')
    return <XCircle className="size-3.5 text-red-500 shrink-0" />
  return <MinusCircle className="size-3.5 text-muted-foreground shrink-0" />
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function RecentShips({ ships, loading }: RecentShipsProps) {
  if (loading && ships.length === 0) {
    return (
      <ul className="space-y-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="h-7 rounded bg-muted animate-pulse" />
        ))}
      </ul>
    )
  }

  if (ships.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No recent activity.</p>
  }

  return (
    <ul className="space-y-1">
      {ships.slice(0, 10).map((ship) => (
        <li
          key={ship.id}
          className="flex items-start gap-2 text-xs py-1 border-b border-border/50 last:border-0"
        >
          <VerdictIcon verdict={ship.verdict} />
          <GitCommit className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <span className="flex-1 line-clamp-1 text-foreground/80">{ship.summary}</span>
          <span className="text-muted-foreground shrink-0 ml-1">{formatRelative(ship.created_at)}</span>
        </li>
      ))}
    </ul>
  )
}
