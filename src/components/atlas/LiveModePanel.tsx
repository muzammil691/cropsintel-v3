import { useEffect, useState } from 'react'
import { Mic, PhoneOff, Loader2, Volume2, MicOff, RefreshCw, PhoneMissed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WaveformVisualizer } from '@/components/atlas/WaveformVisualizer'
import { cn } from '@/lib/utils'
import type { LiveModeState, LiveModeTranscriptItem } from '@/hooks/useLiveMode'

const VOICE_CONSENT_KEY = 'atlas_voice_consent_v1'

interface LiveModePanelProps {
  state: LiveModeState
  level: number
  speakingLevel: number
  errorMessage: string | null
  budgetBlocked: boolean
  sessionElapsedMs: number
  transcript: LiveModeTranscriptItem[]
  reconnectAttempt?: number
  onEnd: () => void
}

const SESSION_CAP_MS = 15 * 60_000

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function stateLabel(state: LiveModeState, reconnectAttempt?: number): string {
  switch (state) {
    case 'connecting': return 'Connecting…'
    case 'listening': return '🎤 Listening — speak when ready'
    case 'thinking': return '🤔 Atlas thinking'
    case 'speaking': return '🔊 Atlas speaking'
    case 'interrupting': return 'Picking up your input…'
    case 'reconnecting': return `🔄 Reconnecting${reconnectAttempt ? ` (${reconnectAttempt}/3)` : '…'}`
    case 'disconnected': return '❌ Disconnected'
    case 'error': return 'Error'
    case 'idle':
    default:
      return '🔇 Idle'
  }
}

function stateColor(state: LiveModeState): 'green' | 'amber' | 'blue' | 'red' | 'muted' {
  switch (state) {
    case 'listening': return 'green'
    case 'thinking': return 'amber'
    case 'speaking': return 'blue'
    case 'interrupting': return 'red'
    case 'reconnecting': return 'amber'
    case 'disconnected': return 'red'
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
  reconnectAttempt,
  onEnd,
}: LiveModePanelProps) {
  const remainingMs = Math.max(0, SESSION_CAP_MS - sessionElapsedMs)
  const isListeningish = state === 'listening' || state === 'connecting'
  const waveLevel = state === 'speaking' || state === 'interrupting' ? speakingLevel : level
  const waveActive = state !== 'idle' && state !== 'thinking' && state !== 'disconnected'

  // First-use voice consent banner. Stored in localStorage so it shows once
  // per browser. The banner explains where recordings go and how to delete.
  const [showConsent, setShowConsent] = useState(false)
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(VOICE_CONSENT_KEY)
      if (!seen) setShowConsent(true)
    } catch { /* localStorage unavailable — skip banner */ }
  }, [])
  const acknowledgeConsent = () => {
    try { window.localStorage.setItem(VOICE_CONSENT_KEY, 'ack') } catch { /* ignore */ }
    setShowConsent(false)
  }

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
              state === 'reconnecting' && 'bg-amber-500 animate-ping',
              state === 'disconnected' && 'bg-red-500',
              state === 'idle' && 'bg-muted-foreground/40',
            )}
            aria-hidden
          />
          <h2 id="live-mode-title" className="text-base font-semibold">
            Live conversation with Atlas
          </h2>
          {/* State pill — always visible at the top so users can see what's happening */}
          <span
            data-testid="live-mode-state-pill"
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium border',
              state === 'listening' && 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200',
              state === 'thinking' && 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
              (state === 'speaking' || state === 'interrupting') && 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200',
              state === 'reconnecting' && 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100',
              state === 'disconnected' && 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200',
              (state === 'idle' || state === 'connecting') && 'border-muted-foreground/30 bg-muted text-muted-foreground',
            )}
          >
            {stateLabel(state, reconnectAttempt)}
          </span>
          <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
            {formatElapsed(sessionElapsedMs)} / 15:00
          </span>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={onEnd}>
          <PhoneOff className="size-4 mr-1.5" />
          End conversation
        </Button>
      </header>

      {/* Privacy / consent banner (first-use only) */}
      {showConsent && (
        <div
          role="status"
          className="px-4 md:px-6 py-2 text-xs bg-emerald-50 text-emerald-900 border-b border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-800 flex items-center gap-3"
        >
          <span className="flex-1">
            Voice recordings are stored in your private Supabase bucket and used only for replay/transcript. You can delete recordings any time via Settings.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={acknowledgeConsent}>
            Got it
          </Button>
        </div>
      )}

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
              state === 'reconnecting' && 'bg-amber-100 dark:bg-amber-900/40',
              state === 'disconnected' && 'bg-red-100 dark:bg-red-900/40',
              (state === 'idle' || state === 'connecting') && 'bg-muted',
            )}
          >
            {state === 'thinking' ? (
              <Loader2 className="size-10 animate-spin text-amber-700 dark:text-amber-300" />
            ) : state === 'speaking' || state === 'interrupting' ? (
              <Volume2 className="size-10 text-sky-700 dark:text-sky-300" />
            ) : state === 'reconnecting' ? (
              <RefreshCw className="size-10 animate-spin text-amber-700 dark:text-amber-300" />
            ) : state === 'disconnected' ? (
              <PhoneMissed className="size-10 text-red-700 dark:text-red-300" />
            ) : state === 'idle' ? (
              <MicOff className="size-10 text-muted-foreground" />
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
              state === 'reconnecting' && 'text-amber-700 dark:text-amber-300',
              state === 'disconnected' && 'text-red-700 dark:text-red-300',
            )}
          >
            {stateLabel(state, reconnectAttempt)}
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
