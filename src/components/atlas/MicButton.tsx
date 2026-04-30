import { Mic, MicOff, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { UseSttResult } from '@/hooks/useStt'

interface MicButtonProps {
  stt: UseSttResult
  onTranscript: (text: string) => void
  disabled?: boolean
}

// Single mic toggle button + VU meter halo. Click to record, click again to stop.
// Visually communicates four states: idle / recording / transcribing / unsupported.
export function MicButton({ stt, onTranscript, disabled }: MicButtonProps) {
  const { recording, transcribing, level, supported, start, stop } = stt

  const handleClick = () => {
    if (transcribing) return
    if (recording) {
      stop()
    } else {
      void start(onTranscript)
    }
  }

  if (!supported) {
    return (
      <Button
        type="button"
        size="icon"
        variant="outline"
        disabled
        className="shrink-0 mb-0.5"
        aria-label="Voice input not supported on this browser"
        title="Voice input not supported on this browser"
      >
        <MicOff className="size-4" />
      </Button>
    )
  }

  // Halo intensity scales with the live mic level (0..1) — clamped so an idle
  // background hum never glows more than a soft outline.
  const haloScale = recording ? 1 + Math.min(level, 1) * 0.6 : 1
  const haloOpacity = recording ? 0.25 + Math.min(level, 1) * 0.55 : 0

  return (
    <div className="relative shrink-0 mb-0.5">
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 rounded-md bg-destructive/60 transition-transform',
          'will-change-transform',
        )}
        style={{
          transform: `scale(${haloScale})`,
          opacity: haloOpacity,
        }}
      />
      <Button
        type="button"
        size="icon"
        variant={recording ? 'destructive' : 'outline'}
        onClick={handleClick}
        disabled={disabled || transcribing}
        className="relative"
        aria-label={
          transcribing ? 'Transcribing audio'
            : recording ? 'Stop recording'
            : 'Start voice input'
        }
        aria-pressed={recording}
        title={
          transcribing ? 'Transcribing…'
            : recording ? 'Stop recording'
            : 'Voice input (click to record). Audio is sent to OpenAI Whisper for transcription; OpenAI retains audio for up to 30 days unless your account has zero-data-retention.'
        }
      >
        {transcribing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : recording ? (
          <Square className="size-3 fill-current" />
        ) : (
          <Mic className="size-4" />
        )}
      </Button>
    </div>
  )
}
