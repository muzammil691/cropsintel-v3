import type { TtsVoice } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface VoicePickerProps {
  voices: TtsVoice[]
  voiceId: string
  onChange: (voiceId: string) => void
  loading?: boolean
  error?: string | null
  disabled?: boolean
  className?: string
}

export function VoicePicker({
  voices, voiceId, onChange, loading, error, disabled, className,
}: VoicePickerProps) {
  if (error) {
    return (
      <span className={cn('text-xs text-red-600 dark:text-red-400', className)} role="alert">
        Voices unavailable
      </span>
    )
  }
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span className="sr-only">Atlas voice</span>
      <select
        aria-label="Atlas voice"
        value={voiceId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading || voices.length === 0}
        className={cn(
          'rounded border bg-background px-2 py-0.5 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 transition',
          (disabled || loading) && 'opacity-50 cursor-not-allowed',
        )}
      >
        {loading && <option>Loading…</option>}
        {!loading && voices.length === 0 && <option value={voiceId}>Default</option>}
        {voices.map((v) => (
          <option key={v.voice_id} value={v.voice_id}>
            {v.name}
            {v.category ? ` · ${v.category}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
