import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Loader2 } from 'lucide-react'
import { streamTts } from '@/lib/atlas-client'
import { cn } from '@/lib/utils'

interface AudioPlayerProps {
  text: string
  voiceId: string
  enabled: boolean
  className?: string
}

export function AudioPlayer({ text, voiceId, enabled, className }: AudioPlayerProps) {
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [])

  async function ensureAudio(): Promise<HTMLAudioElement | null> {
    if (audioRef.current) return audioRef.current
    setLoading(true)
    setError(null)
    const result = await streamTts(text, voiceId)
    setLoading(false)
    if (!result.ok) {
      setError(result.budgetExceeded ? 'TTS disabled — monthly cap approaching.' : result.error)
      return null
    }
    const url = URL.createObjectURL(result.blob)
    urlRef.current = url
    const audio = new Audio(url)
    audio.addEventListener('ended', () => setPlaying(false))
    audio.addEventListener('pause', () => setPlaying(false))
    audio.addEventListener('play', () => setPlaying(true))
    audioRef.current = audio
    return audio
  }

  async function handleClick() {
    if (!enabled) return
    if (audioRef.current && playing) {
      audioRef.current.pause()
      return
    }
    const audio = await ensureAudio()
    if (!audio) return
    try {
      await audio.play()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio play failed')
    }
  }

  if (!enabled) return null

  const label = loading
    ? 'Loading audio'
    : playing
      ? 'Pause Atlas reply'
      : 'Replay Atlas reply'

  return (
    <div className={cn('mt-1 flex items-center gap-2 text-[11px] text-muted-foreground', className)}>
      <button
        type="button"
        aria-label={label}
        onClick={handleClick}
        disabled={loading}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 hover:bg-muted/60 transition-colors',
          loading && 'opacity-60 cursor-wait',
        )}
      >
        {loading ? <Loader2 className="size-3 animate-spin" />
          : playing ? <Pause className="size-3" />
            : <Play className="size-3" />}
        <span>{playing ? 'Pause' : loading ? '…' : 'Play'}</span>
      </button>
      {error && <span className="text-red-600 dark:text-red-400" role="alert">{error}</span>}
    </div>
  )
}
