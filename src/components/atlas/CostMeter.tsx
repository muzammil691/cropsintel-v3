import type { AtlasCosts } from '@/lib/atlas-client'

interface CostMeterProps {
  costs: AtlasCosts | null
  loading?: boolean
}

function fmt(n: number) {
  return n.toFixed(2)
}

export function CostMeter({ costs, loading }: CostMeterProps) {
  const budget = costs?.budget ?? 400
  const today = costs?.today ?? 0
  const month = costs?.month_to_date ?? 0
  const pct = Math.min(100, (month / budget) * 100)

  const barColor =
    pct >= 90
      ? 'bg-red-500'
      : pct >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  if (loading && !costs) {
    return (
      <div className="space-y-1.5">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="h-2 w-full rounded bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Today: <span className="font-medium text-foreground">${fmt(today)}</span></span>
        <span>Month: <span className="font-medium text-foreground">${fmt(month)}</span> / ${fmt(budget)}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs text-muted-foreground">{pct.toFixed(1)}% of budget used</div>
    </div>
  )
}
