import { Phone, PhoneOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LiveModeButtonProps {
  active: boolean
  onClick: () => void
  disabled?: boolean
  className?: string
}

export function LiveModeButton({ active, onClick, disabled, className }: LiveModeButtonProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? 'End live conversation' : 'Start live conversation'}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold transition-colors duration-200',
        'shadow-sm',
        active
          ? 'border-red-500 bg-red-500 text-white hover:bg-red-600 dark:border-red-400 dark:bg-red-500'
          : 'border-green-600 bg-green-500 text-white hover:bg-green-600 dark:border-green-500 dark:bg-green-500',
        active && 'animate-pulse',
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className,
      )}
    >
      {active ? <PhoneOff className="size-4" /> : <Phone className="size-4" />}
      <span>{active ? 'End conversation' : 'Start live conversation'}</span>
    </button>
  )
}
