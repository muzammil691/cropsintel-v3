import type { AtlasCosts } from '@/lib/atlas-client'

interface CostGaugesProps {
  costs: AtlasCosts | null
  loading: boolean
}

function fmt(n: number): string {
  return n.toFixed(2)
}

interface RadialProps {
  pct: number
  size?: number
  stroke?: number
  color: string
}

function RadialGauge({ pct, size = 56, stroke = 6, color }: RadialProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (Math.min(pct, 100) / 100) * c
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="stroke-slate-200 dark:stroke-slate-800"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="motion-safe:transition-all duration-250"
      />
    </svg>
  )
}

export function CostGauges({ costs, loading }: CostGaugesProps) {
  const budget = costs?.budget ?? 400
  const today = costs?.today ?? 0
  const month = costs?.month_to_date ?? 0
  const pct = Math.min(100, (month / budget) * 100)

  const gaugeColor =
    pct >= 90 ? 'rgb(239 68 68)' // red-500
      : pct >= 70 ? 'rgb(245 158 11)' // amber-500
      : 'rgb(16 185 129)' // emerald-500

  if (loading && !costs) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 h-[88px] animate-pulse" />
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            AI Cost
          </div>
          <div className="text-sm font-semibold tabular-nums mt-0.5">
            ${fmt(today)} <span className="text-[11px] font-normal text-slate-500">today</span>
          </div>
          <div className="text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
            ${fmt(month)} / ${fmt(budget)} MTD ({pct.toFixed(0)}%)
          </div>
        </div>
        <div className="relative shrink-0">
          <RadialGauge pct={pct} color={gaugeColor} />
          <span
            className="absolute inset-0 grid place-items-center text-[10px] tabular-nums font-semibold"
            style={{ color: gaugeColor }}
          >
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  )
}
