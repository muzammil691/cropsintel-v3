import type { VerifierPoint } from '@/lib/atlas-client'

interface VerifierSparkProps {
  history: VerifierPoint[]
  passRate: number
}

// Compact sparkline — bar chart of pass/fail per snapshot. Density goal: 30+
// data points in ~64px height, no axis labels, % overlay top-right.
export function VerifierSpark({ history, passRate }: VerifierSparkProps) {
  if (history.length === 0) return null

  const maxTotal = Math.max(...history.map((h) => h.pass + h.fail), 1)
  const barW = 100 / history.length
  const ratePct = (passRate * 100).toFixed(0)
  const rateColor =
    passRate >= 0.85 ? 'text-emerald-700 dark:text-emerald-400'
      : passRate >= 0.7 ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-700 dark:text-red-400'

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          Verifier pass rate
        </span>
        <span className={`text-base font-bold tabular-nums ${rateColor}`}>
          {ratePct}%
        </span>
      </div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-12">
        {history.map((h, i) => {
          const total = h.pass + h.fail
          const totalH = (total / maxTotal) * 32
          const passH = total > 0 ? (h.pass / total) * totalH : 0
          const x = i * barW
          return (
            <g key={i}>
              <rect
                x={x + barW * 0.1}
                y={32 - totalH}
                width={barW * 0.8}
                height={totalH - passH}
                className="fill-red-400 dark:fill-red-500"
              >
                <title>{`${h.t} — pass:${h.pass} fail:${h.fail}`}</title>
              </rect>
              <rect
                x={x + barW * 0.1}
                y={32 - passH}
                width={barW * 0.8}
                height={passH}
                className="fill-emerald-500 dark:fill-emerald-400"
              >
                <title>{`${h.t} — pass:${h.pass} fail:${h.fail}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
