// Phase 1.10ab — BrainScoreBadge
//
// Color-coded 0..100 score chip. Tokens locked by spec:
//   ≥80 green-600, 50–79 amber-500, <50 red-500, no score gray.

import { cn } from '@/lib/utils'

export interface BrainScoreBadgeProps {
  score: number | null | undefined
  size?: 'sm' | 'md' | 'lg'
  delta?: number | null
  className?: string
}

function colorFor(score: number | null | undefined) {
  if (score == null) return { bg: 'bg-slate-200 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-300', ring: 'ring-slate-300 dark:ring-slate-700' }
  if (score >= 80) return { bg: 'bg-green-600', text: 'text-white', ring: 'ring-green-700' }
  if (score >= 50) return { bg: 'bg-amber-500', text: 'text-white', ring: 'ring-amber-600' }
  return { bg: 'bg-red-500', text: 'text-white', ring: 'ring-red-600' }
}

const sizeMap = {
  sm: 'h-5 min-w-[28px] px-1.5 text-[11px]',
  md: 'h-6 min-w-[34px] px-2 text-xs',
  lg: 'h-8 min-w-[44px] px-2.5 text-sm',
}

export function BrainScoreBadge({ score, size = 'md', delta, className }: BrainScoreBadgeProps) {
  const { bg, text, ring } = colorFor(score)
  const display = score == null ? '—' : Math.round(score)
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold tabular-nums ring-1 ring-inset',
        bg,
        text,
        ring,
        sizeMap[size],
        className,
      )}
      aria-label={score == null ? 'No score yet' : `Score ${display}/100`}
    >
      {display}
      {delta != null && delta !== 0 && (
        <span className={cn('ml-1 text-[10px] font-normal opacity-90')}>
          {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
        </span>
      )}
    </span>
  )
}
