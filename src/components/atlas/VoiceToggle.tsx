import { Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VoiceToggleProps {
  enabled: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  className?: string
}

export function VoiceToggle({ enabled, onToggle, disabled, className }: VoiceToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? 'Disable Atlas voice' : 'Enable Atlas voice'}
      disabled={disabled}
      onClick={() => onToggle(!enabled)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        enabled
          ? 'border-green-300 bg-green-100 text-green-700 dark:border-green-800 dark:bg-green-900/40 dark:text-green-300'
          : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {enabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      <span>{enabled ? 'Voice on' : 'Voice off'}</span>
    </button>
  )
}
