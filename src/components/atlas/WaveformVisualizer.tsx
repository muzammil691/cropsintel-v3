import { cn } from '@/lib/utils'

interface WaveformVisualizerProps {
  level: number
  active: boolean
  color: 'green' | 'amber' | 'blue' | 'red' | 'muted'
  className?: string
  bars?: number
}

const BAR_HEIGHTS_BASE = [0.2, 0.4, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 0.3, 0.7, 0.5, 0.2]

const COLOR_MAP: Record<WaveformVisualizerProps['color'], string> = {
  green: 'bg-green-500 dark:bg-green-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  blue: 'bg-sky-500 dark:bg-sky-400',
  red: 'bg-red-500 dark:bg-red-400',
  muted: 'bg-muted-foreground/40',
}

export function WaveformVisualizer({
  level,
  active,
  color,
  className,
  bars = 12,
}: WaveformVisualizerProps) {
  const barCount = Math.max(4, Math.min(bars, 24))
  const safeLevel = Math.max(0, Math.min(level, 1))
  const colorClass = COLOR_MAP[color] ?? COLOR_MAP.muted

  return (
    <div
      role="presentation"
      aria-hidden
      className={cn('flex items-end justify-center gap-1 h-12', className)}
    >
      {Array.from({ length: barCount }).map((_, i) => {
        const baseHeight = BAR_HEIGHTS_BASE[i % BAR_HEIGHTS_BASE.length]
        const live = active ? safeLevel : 0
        const heightPct = Math.max(8, Math.round((baseHeight * (0.3 + live * 1.4)) * 100))
        return (
          <span
            key={i}
            className={cn(
              'inline-block w-1.5 rounded-full transition-[height,opacity] duration-100',
              colorClass,
              !active && 'opacity-40',
            )}
            style={{ height: `${Math.min(heightPct, 100)}%` }}
          />
        )
      })}
    </div>
  )
}
