import { Mic, PhoneOff, Loader2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WaveformVisualizer } from '@/components/atlas/WaveformVisualizer'
import { cn } from '@/lib/utils'
import type { LiveModeState, LiveModeTranscriptItem } from '@/hooks/useLiveMode'

interface LiveModePanelProps {
  state: LiveModeState
  level: number
  speakingLevel: number
  errorMessage: string | null
  budgetBlocked: boolean
  sessionElapsedMs: number
  transcript: LiveModeTranscriptItem[]
  onEnd: () => void
}

const SESSION_CAP_MS = 15 * 60_000

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function stateLabel(state: LiveModeState): string {
  switch (state) {
    case 'connecting': return 'Connecting…'
    case 'listening': return 'Listening… speak when ready'
    case 'thinking': return 'Thinking…'
    case 'speaking': return 'Atlas is speaking'
    case 'interrupting': return 'Picking up your input…'
    case 'error': return 'Error'
    case 'idle':
    default:
      return 'Idle'
  }
}

function stateColor(state: LiveModeState): 'green' | 'amber' | 'blue' | 'red' | 'muted' {
  switch (state) {
    case 'listening': return 'green'
    case 'thinking': return 'amber'
    case 'speaking': return 'blue'
    case 'interrupting': return 'red'
    default: return 'muted'
  }
}

export function LiveModePanel({
  state,
  level,
  speakingLevel,
  errorMessage,
  budgetBlocked,
  sessionElapsedMs,
  transcript,
  onEnd,
}: LiveModePanelProps) {
  const remainingMs = Math.max(0, SESSION_CAP_MS - sessionElapsedMs)
  const isListeningish = state === 'listening' || state === 'connecting'
  const waveLevel = state === 'speaking' || state === 'interrupting' ? speakingLevel : level
  const waveActive = state !== 'idle' && state !== 'thinking'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-mode-title"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      {/* Header */}
      <header className="border-b px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex size-2.5 rounded-full',
              isListeningish && 'bg-green-500 animate-pulse',
              state === 'thinking' && 'bg-amber-500 animate-pulse',
              (state === 'speaking' || state === 'interrupting') && 'bg-sky-500 animate-pulse',
              state === 'idle' && 'bg-muted-foreground/40',
            )}
            aria-hidden
          />
          <h2 id="live-mode-title" className="text-base font-semibold">
            Live conversation with Atlas
          </h2>
          <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
            {formatElapsed(sessionElapsedMs)} / 15:00
          </span>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={onEnd}>
          <PhoneOff className="size-4 mr-1.5" />
          End conversation
        </Button>
      </header>

      {/* Status banner */}
      {(errorMessage || budgetBlocked) && (
        <div
          role="alert"
          className="px-4 md:px-6 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800"
        >
          {errorMessage}
        </div>
      )}

      {/* Call surface */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-6 py-6 gap-6">
        <div className="flex flex-col items-center gap-4">
          {/* State icon */}
          <div
            className={cn(
              'size-24 rounded-full flex items-center justify-center transition-colors',
              state === 'listening' && 'bg-green-100 dark:bg-green-900/40',
              state === 'thinking' && 'bg-amber-100 dark:bg-amber-900/40',
              (state === 'speaking' || state === 'interrupting') && 'bg-sky-100 dark:bg-sky-900/40',
              (state === 'idle' || state === 'connecting') && 'bg-muted',
            )}
          >
            {state === 'thinking' ? (
              <Loader2 className="size-10 animate-spin text-amber-700 dark:text-amber-300" />
            ) : state === 'speaking' || state === 'interrupting' ? (
              <Volume2 className="size-10 text-sky-700 dark:text-sky-300" />
            ) : (
              <Mic
                className={cn(
                  'size-10',
                  state === 'listening' ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground',
                )}
              />
            )}
          </div>

          {/* Waveform */}
          <WaveformVisualizer
            level={waveLevel}
            active={waveActive}
            color={stateColor(state)}
            className="w-64"
          />

          {/* State label */}
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'text-base font-medium',
              state === 'listening' && 'text-green-700 dark:text-green-300',
              state === 'thinking' && 'text-amber-700 dark:text-amber-300',
              (state === 'speaking' || state === 'interrupting') && 'text-sky-700 dark:text-sky-300',
            )}
          >
            {stateLabel(state)}
          </p>

          <p className="text-xs text-muted-foreground tabular-nums md:hidden">
            {formatElapsed(sessionElapsedMs)} / 15:00
          </p>
          <p className="text-[11px] text-muted-foreground">
            Time remaining: {formatElapsed(remainingMs)}
          </p>
        </div>

        {/* Transcript */}
        <section
          aria-label="Live transcript"
          className="w-full max-w-2xl flex-1 min-h-0 flex flex-col rounded-lg border bg-card overflow-hidden"
        >
          <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
            Transcript
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
            {transcript.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-8">
                Your conversation will appear here as you speak.
              </p>
            )}
            {transcript.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'flex flex-col gap-0.5',
                  m.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div
                  className={cn(
                    'rounded-xl px-3 py-2 max-w-[85%] whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted/60 rounded-bl-sm',
                  )}
                >
                  {m.content}
                </div>
                <span className="text-[10px] text-muted-foreground px-1">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
