import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchVoices, streamTts, type TtsVoice } from '@/lib/atlas-client'

const STORAGE_KEY_ENABLED = 'atlas-tts-enabled'
const STORAGE_KEY_VOICE = 'atlas-tts-voice'
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL' // Bella

function readStoredEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY_ENABLED) === 'true'
  } catch { return false }
}

function readStoredVoice(): string {
  if (typeof window === 'undefined') return DEFAULT_VOICE_ID
  try {
    return window.localStorage.getItem(STORAGE_KEY_VOICE) || DEFAULT_VOICE_ID
  } catch { return DEFAULT_VOICE_ID }
}

export interface UseTtsResult {
  enabled: boolean
  setEnabled: (v: boolean) => void
  voiceId: string
  setVoiceId: (v: string) => void
  voices: TtsVoice[]
  voicesLoading: boolean
  voicesError: string | null
  speak: (text: string) => Promise<void>
  stopAll: () => void
  budgetBlocked: boolean
  lastError: string | null
}

export function useTts(): UseTtsResult {
  const [enabled, setEnabledState] = useState<boolean>(readStoredEnabled)
  const [voiceId, setVoiceIdState] = useState<string>(readStoredVoice)
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voicesError, setVoicesError] = useState<string | null>(null)
  const [budgetBlocked, setBudgetBlocked] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeUrlRef = useRef<string | null>(null)

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    try { window.localStorage.setItem(STORAGE_KEY_ENABLED, v ? 'true' : 'false') } catch { /* ignore */ }
    if (!v) {
      activeAudioRef.current?.pause()
    }
  }, [])

  const setVoiceId = useCallback((v: string) => {
    setVoiceIdState(v)
    try { window.localStorage.setItem(STORAGE_KEY_VOICE, v) } catch { /* ignore */ }
  }, [])

  // Load voices on first mount when enabled, or when toggled on.
  useEffect(() => {
    if (!enabled || voices.length > 0 || voicesLoading) return
    let cancelled = false
    setVoicesLoading(true)
    setVoicesError(null)
    fetchVoices()
      .then(list => {
        if (cancelled) return
        setVoices(list)
      })
      .catch(err => {
        if (cancelled) return
        setVoicesError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setVoicesLoading(false)
      })
    return () => { cancelled = true }
  }, [enabled, voices.length, voicesLoading])

  const stopAll = useCallback(() => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
      activeAudioRef.current = null
    }
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current)
      activeUrlRef.current = null
    }
  }, [])

  const speak = useCallback(async (text: string) => {
    if (!enabled) return
    const trimmed = (text ?? '').trim()
    if (!trimmed) return

    setLastError(null)
    const result = await streamTts(trimmed, voiceId)
    if (!result.ok) {
      if (result.budgetExceeded) {
        setBudgetBlocked(true)
        setEnabledState(false)
        try { window.localStorage.setItem(STORAGE_KEY_ENABLED, 'false') } catch { /* ignore */ }
        setLastError(result.message ?? 'TTS disabled — monthly cap approaching.')
      } else {
        setLastError(result.error)
      }
      return
    }
    setBudgetBlocked(false)

    stopAll()
    const url = URL.createObjectURL(result.blob)
    activeUrlRef.current = url
    const audio = new Audio(url)
    activeAudioRef.current = audio
    audio.addEventListener('ended', () => {
      if (activeUrlRef.current === url) {
        URL.revokeObjectURL(url)
        activeUrlRef.current = null
      }
    })
    try {
      await audio.play()
    } catch (err) {
      // Autoplay blocked — user can use AudioPlayer to play manually.
      setLastError(err instanceof Error ? err.message : 'Audio play failed')
    }
  }, [enabled, voiceId, stopAll])

  // Cleanup any active audio on unmount.
  useEffect(() => {
    return () => { stopAll() }
  }, [stopAll])

  return {
    enabled, setEnabled,
    voiceId, setVoiceId,
    voices, voicesLoading, voicesError,
    speak, stopAll,
    budgetBlocked,
    lastError,
  }
}
