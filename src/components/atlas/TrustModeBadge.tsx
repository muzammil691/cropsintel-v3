import { cn } from '@/lib/utils'
import type { TrustMode } from '@/lib/atlas-client'

const modeConfig: Record<TrustMode, { label: string; classes: string }> = {
  passive: { label: 'Passive', classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  chat:    { label: 'Chat',    classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  confirm: { label: 'Confirm', classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  auto:    { label: 'Auto',    classes: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  stopped: { label: 'Stopped', classes: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

interface TrustModeBadgeProps {
  mode: TrustMode
  className?: string
}

export function TrustModeBadge({ mode, className }: TrustModeBadgeProps) {
  const config = modeConfig[mode] ?? modeConfig.passive
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.classes,
        className,
      )}
    >
      {config.label}
    </span>
  )
}
