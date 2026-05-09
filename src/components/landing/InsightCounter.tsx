// Phase 1.3b — Visible counter for guest deep-output usage (max 10).
//
// Hidden once the user signs in (tier !== 'guest'). Color escalates from
// emerald (plenty left) to amber (running low) to rose (gated).

import { useAuth } from '@/contexts/AuthContext'

interface Props {
  count: number
  limit: number
}

export function InsightCounter({ count, limit }: Props) {
  const { tier } = useAuth()
  if (tier !== 'guest') return null

  const remaining = Math.max(0, limit - count)
  const tone =
    remaining >= 5
      ? 'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30'
      : remaining >= 2
        ? 'text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30'
        : 'text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30'

  return (
    <div
      data-testid="insight-counter"
      data-count={count}
      data-limit={limit}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${tone}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {count} / {limit} deep insights used
    </div>
  )
}
