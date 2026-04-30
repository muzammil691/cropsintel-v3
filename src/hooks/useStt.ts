import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadStt } from '@/lib/atlas-client'

// Silence detection threshold (0..1 average normalized FFT magnitude).
const SILENCE_THRESHOLD = 0.05
// Continuous silence required before auto-stop kicks in.
const SILENCE_AUTO_STOP_MS = 2000
// Minimum recording length before silence-stop is allowed (avoids cutting off
// a slow-speaker who hesitates after pressing record).
const MIN_RECORDING_MS = 1500
// Hard cap — mirrored on the server (90 s with margin) and the OpenAI 25 MB limit.
const HARD_CAP_MS = 60_000

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
  ]
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

export interface UseSttResult {
  recording: boolean
  transcribing: boolean
  level: number
  supported: boolean
  lastError: string | null
  budgetBlocked: boolean
  start: (onResult: (text: string) => void) => Promise<void>
  stop: () => void
  cancel: () => void
}

export function useStt(): UseSttResult {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [level, setLevel] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [budgetBlocked, setBudgetBlocked] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const silenceStartRef = useRef<number | null>(null)
  const startedAtRef = useRef<number>(0)
  const onResultRef = useRef<((text: string) => void) | null>(null)
  const cancelledRef = useRef<boolean>(false)

  const supported = typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
    && pickMimeType() !== null

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => { /* ignore */ })
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    setLevel(0)
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* ignore */ }
    }
    setRecording(false)
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    stop()
    cleanupAudio()
    chunksRef.current = []
    setTranscribing(false)
  }, [stop, cleanupAudio])

  const start = useCallback(async (onResult: (text: string) => void) => {
    if (recording || transcribing) return
    if (!supported) {
      setLastError('Voice not supported on this browser')
      return
    }

    setLastError(null)
    cancelledRef.current = false
    onResultRef.current = onResult

    const mimeType = pickMimeType()!

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Surface a friendly inline error rather than only logging.
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setLastError('Microphone permission denied. Enable it in your browser settings to use voice input.')
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setLastError('No microphone detected on this device.')
      } else {
        setLastError(`Microphone error: ${msg}`)
      }
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    silenceStartRef.current = null
    startedAtRef.current = Date.now()

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch (err) {
      cleanupAudio()
      setLastError(`Recorder init failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    recorderRef.current = recorder

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onerror = (e: Event) => {
      const errEvent = e as Event & { error?: { message?: string } }
      setLastError(`Recording error: ${errEvent.error?.message ?? 'unknown'}`)
    }
    recorder.onstop = async () => {
      cleanupAudio()
      setRecording(false)
      if (cancelledRef.current) {
        chunksRef.current = []
        return
      }

      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []

      // Avoid uploading near-empty audio (no speech captured at all).
      if (blob.size < 1024) {
        setLastError('No audio captured — try again and speak closer to the mic.')
        return
      }

      setTranscribing(true)
      const result = await uploadStt(blob)
      setTranscribing(false)

      if (!result.ok) {
        if (result.budgetExceeded) {
          setBudgetBlocked(true)
          setLastError(result.message ?? 'Voice input disabled — monthly cap approaching.')
        } else {
          setLastError(result.message ?? result.error)
        }
        return
      }

      setBudgetBlocked(false)
      const text = result.transcript.trim()
      if (text) {
        onResultRef.current?.(text)
      } else {
        setLastError('Could not understand audio — try speaking again.')
      }
    }

    // 250 ms chunks balance memory pressure with smooth resumption on stop.
    recorder.start(250)
    setRecording(true)

    // VU meter + silence detection via Web Audio API.
    let audioCtx: AudioContext
    try {
      audioCtx = new AudioContext()
    } catch (err) {
      // Recording can still proceed without VU meter / silence detect.
      setLastError(`Audio analyzer unavailable: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    audioCtxRef.current = audioCtx
    const src = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      if (!recorderRef.current || recorderRef.current.state === 'inactive') return
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const avg = sum / data.length / 255
      setLevel(avg)

      const now = Date.now()
      const elapsed = now - startedAtRef.current

      if (avg < SILENCE_THRESHOLD) {
        if (silenceStartRef.current === null) silenceStartRef.current = now
        else if (
          now - silenceStartRef.current > SILENCE_AUTO_STOP_MS
          && elapsed > MIN_RECORDING_MS
        ) {
          stop()
          return
        }
      } else {
        silenceStartRef.current = null
      }

      if (elapsed > HARD_CAP_MS) {
        stop()
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [recording, transcribing, supported, cleanupAudio, stop])

  // Final cleanup on unmount — stop any active recording / streams.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop() } catch { /* ignore */ }
      }
      cleanupAudio()
    }
  }, [cleanupAudio])

  return {
    recording,
    transcribing,
    level,
    supported,
    lastError,
    budgetBlocked,
    start,
    stop,
    cancel,
  }
}
