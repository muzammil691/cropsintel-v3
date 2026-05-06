// Pillar C.1 — continuous-listen voice bubble.
//
// One round button, four visual states. When toggled on, the bubble runs an
// auto-restarting STT → chat → TTS → STT loop until the user toggles it off:
//
//   idle       — bubble off, hold-to-talk MicButton still works as before.
//   listening  — STT recording. Pulses with the audio level.
//   thinking   — chat is streaming the reply. Spinning border.
//   speaking   — TTS is playing the reply. Outer ring waveform-like animation.
//
// The loop relies on:
//   • useStt's existing silence-stop (auto-fires onResult after 2s of silence).
//   • useTts's new `speaking` flag (true between play() start and the
//     audio's `ended` event).
//   • the chat's `isStreaming` flag.
//
// When all three are quiet AND the bubble is `active`, an effect re-arms STT.

import { useEffect, useRef } from 'react'
import { Mic, Loader2, Volume2, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UseSttResult } from '@/hooks/useStt'
import type { UseTtsResult } from '@/hooks/useTts'

interface ContinuousVoiceBubbleProps {
  active: boolean
  onActiveChange: (next: boolean) => void
  stt: UseSttResult
  tts: UseTtsResult
  isStreaming: boolean
  /** Called once per completed user turn — wire to the chat's send(). */
  onUserTurn: (text: string) => void
  /** Hide entirely when STT isn't supported on this browser. */
  className?: string
}

type BubbleState = 'idle' | 'listening' | 'thinking' | 'speaking'

export function ContinuousVoiceBubble({
  active,
  onActiveChange,
  stt,
  tts,
  isStreaming,
  onUserTurn,
  className,
}: ContinuousVoiceBubbleProps) {
  // Latest user-turn handler — captured in a ref so the auto-restart effect
  // doesn't re-fire every render (handlers from CockpitChat change identity).
  const onUserTurnRef = useRef(onUserTurn)
  onUserTurnRef.current = onUserTurn

  const sttRef = useRef(stt)
  sttRef.current = stt

  // Auto-restart loop. Re-arm STT whenever:
  //   active === true
  //   AND no STT is in flight (recording / transcribing)
  //   AND chat isn't streaming
  //   AND TTS isn't speaking
  // Then start STT with onResult={text => onUserTurn(text)}.
  useEffect(() => {
    if (!active) return
    if (stt.recording || stt.transcribing) return
    if (isStreaming) return
    if (tts.speaking) return
    if (!stt.supported) return
    // Tiny delay so the user has a beat between turns and we don't capture
    // the tail of the assistant's TTS audio leaking through the speaker.
    const id = window.setTimeout(() => {
      void sttRef.current.start(text => {
        onUserTurnRef.current(text)
      })
    }, 250)
    return () => window.clearTimeout(id)
  }, [active, stt.recording, stt.transcribing, isStreaming, tts.speaking, stt.supported])

  // When toggled off mid-recording, stop STT immediately. (cancel keeps any
  // partial buffer from auto-uploading.)
  useEffect(() => {
    if (!active && stt.recording) {
      stt.cancel()
    }
  }, [active, stt])

  const state: BubbleState = !active
    ? 'idle'
    : stt.recording || stt.transcribing
    ? 'listening'
    : isStreaming
    ? 'thinking'
    : tts.speaking
    ? 'speaking'
    : 'listening'  // between turns — about to re-arm; treat as listening

  const label = !active
    ? 'Start continuous voice'
    : state === 'listening'
    ? 'Listening — tap to stop'
    : state === 'thinking'
    ? 'Atlas is thinking'
    : state === 'speaking'
    ? 'Atlas is speaking'
    : 'Continuous voice on'

  // Visual ring + glow vary by state. Listening uses the audio level for a
  // breathing scale; thinking spins; speaking pulses.
  const levelScale = state === 'listening'
    ? 1 + Math.min(0.3, stt.level * 1.2)
    : 1

  if (!stt.supported) return null

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={() => onActiveChange(!active)}
      className={cn(
        'relative inline-flex items-center justify-center size-10 rounded-full shrink-0 transition-colors duration-200 outline-none',
        'focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-1',
        !active && 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:border-emerald-400 hover:text-emerald-600',
        active && state === 'listening' && 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30',
        active && state === 'thinking' && 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30',
        active && state === 'speaking' && 'bg-amber-500 text-white shadow-md shadow-amber-500/30',
        className,
      )}
    >
      {/* Outer breathing ring. Scale follows audio level when listening,
          spin when thinking, pulse when speaking. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 rounded-full transition-[transform,opacity] duration-200',
          active && state === 'listening' && 'bg-emerald-500/30 animate-pulse',
          active && state === 'thinking' && 'bg-indigo-500/30 animate-ping',
          active && state === 'speaking' && 'bg-amber-400/40 animate-ping',
        )}
        style={
          active && state === 'listening'
            ? { transform: `scale(${levelScale.toFixed(3)})` }
            : undefined
        }
      />
      {/* Center icon — swaps by state. */}
      <span className="relative z-10 inline-flex items-center justify-center">
        {!active ? (
          <Mic className="size-4" />
        ) : state === 'listening' ? (
          stt.transcribing
            ? <Loader2 className="size-4 animate-spin" />
            : <Mic className="size-4" />
        ) : state === 'thinking' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : state === 'speaking' ? (
          <Volume2 className="size-4" />
        ) : (
          <MicOff className="size-4" />
        )}
      </span>
    </button>
  )
}
