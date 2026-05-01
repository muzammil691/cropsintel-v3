import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadStt, openTtsWs, streamChat, type TtsWsHandle } from '@/lib/atlas-client'

// ─── Tunables ───────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD = 0.05
const SILENCE_END_TURN_MS = 2000     // 2s of silence ends a user turn
const MIN_SPEECH_MS = 1000           // ignore turns shorter than 1s of voiced audio
const HARD_TURN_CAP_MS = 60_000      // single turn can't exceed 60s
const SESSION_CAP_MS = 15 * 60_000   // 15-minute hard cap
const INTERRUPT_LEVEL = 0.18         // user voice level above this during SPEAKING → interrupt
const INTERRUPT_SUSTAIN_MS = 200     // must sustain above threshold this long to count
const POST_PLAYBACK_RESUME_MS = 200  // wait this long after audio ends before resuming mic
const FADE_OUT_MS = 200              // ducking fade when interrupting
const PREBUFFER_MS = 500             // queue this much audio before starting playback

export type LiveModeState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupting'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export interface LiveModeTranscriptItem {
  id: string
  role: 'user' | 'atlas'
  content: string
  createdAt: string
}

export interface UseLiveModeResult {
  state: LiveModeState
  active: boolean
  level: number              // 0..1 mic level (current)
  speakingLevel: number      // 0..1 atlas-output animation level
  errorMessage: string | null
  budgetBlocked: boolean
  sessionElapsedMs: number
  transcript: LiveModeTranscriptItem[]
  reconnectAttempt: number   // 0 when stable, 1..3 during reconnect retries
  start: () => Promise<void>
  end: () => void
}

interface UseLiveModeOptions {
  threadId: string
  voiceId: string
  onUserMessage?: (text: string) => void
  onAtlasChunk?: (text: string) => void
  onAtlasComplete?: (fullText: string) => void
}

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

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function useLiveMode(opts: UseLiveModeOptions): UseLiveModeResult {
  const { threadId, voiceId, onUserMessage, onAtlasChunk, onAtlasComplete } = opts

  const [state, setState] = useState<LiveModeState>('idle')
  const [level, setLevel] = useState(0)
  const [speakingLevel, setSpeakingLevel] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [budgetBlocked, setBudgetBlocked] = useState(false)
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0)
  const [transcript, setTranscript] = useState<LiveModeTranscriptItem[]>([])
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const reconnectTimerRef = useRef<number | null>(null)

  // ─── Refs (mutable runtime state — never trigger renders) ─────────────────
  const stateRef = useRef<LiveModeState>('idle')
  const sessionStartRef = useRef<number>(0)
  const sessionTickerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderMimeRef = useRef<string>('audio/webm')
  const chunksRef = useRef<Blob[]>([])
  const turnStartedAtRef = useRef<number>(0)
  const silenceStartRef = useRef<number | null>(null)
  const speechAccumMsRef = useRef<number>(0)
  const lastTickAtRef = useRef<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const ttsWsRef = useRef<TtsWsHandle | null>(null)
  const playbackCtxRef = useRef<AudioContext | null>(null)
  const playbackGainRef = useRef<GainNode | null>(null)
  const playbackQueueRef = useRef<AudioBuffer[]>([])
  const playbackTailRef = useRef<number>(0)
  const playbackActiveSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const playbackStartedRef = useRef<boolean>(false)
  const playbackFinalReceivedRef = useRef<boolean>(false)
  const turnCleanupTimerRef = useRef<number | null>(null)
  const interruptSustainStartRef = useRef<number | null>(null)
  const chatAbortRef = useRef<(() => void) | null>(null)
  const atlasReplyBufferRef = useRef<string>('')
  const atlasSentBufferRef = useRef<string>('')
  const atlasChatDoneRef = useRef<boolean>(false)

  const setStateBoth = useCallback((s: LiveModeState) => {
    stateRef.current = s
    setState(s)
  }, [])

  const appendTranscript = useCallback((role: 'user' | 'atlas', content: string) => {
    setTranscript((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        content,
        createdAt: new Date().toISOString(),
      },
    ])
  }, [])

  // ─── Mic capture & analyser ────────────────────────────────────────────────
  const stopAnalyser = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stopRecorder = useCallback(() => {
    const r = recorderRef.current
    if (!r) return
    if (r.state !== 'inactive') {
      try { r.stop() } catch { /* ignore */ }
    }
  }, [])

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => { /* ignore */ })
      audioCtxRef.current = null
    }
    analyserRef.current = null
  }, [])

  // ─── Playback ──────────────────────────────────────────────────────────────
  const ensurePlaybackCtx = useCallback((): AudioContext | null => {
    if (playbackCtxRef.current) return playbackCtxRef.current
    try {
      const ctx = new AudioContext()
      const gain = ctx.createGain()
      gain.gain.value = 1
      gain.connect(ctx.destination)
      playbackCtxRef.current = ctx
      playbackGainRef.current = gain
      return ctx
    } catch (err) {
      setErrorMessage(`Audio playback unavailable: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }, [])

  const scheduleNextChunks = useCallback(() => {
    const ctx = playbackCtxRef.current
    const gain = playbackGainRef.current
    if (!ctx || !gain) return
    while (playbackQueueRef.current.length > 0) {
      const buf = playbackQueueRef.current.shift()!
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gain)
      const startAt = Math.max(ctx.currentTime, playbackTailRef.current)
      src.start(startAt)
      playbackTailRef.current = startAt + buf.duration
      playbackActiveSourcesRef.current.add(src)
      src.onended = () => {
        playbackActiveSourcesRef.current.delete(src)
        // When the very last queued source ends and we've received `isFinal`,
        // transition back to listening.
        if (
          playbackActiveSourcesRef.current.size === 0
          && playbackFinalReceivedRef.current
          && stateRef.current === 'speaking'
        ) {
          finishSpeakingAndResume()
        }
      }
    }
  }, [])

  const finishSpeakingAndResume = useCallback(() => {
    // Persist Atlas reply to transcript.
    const fullText = atlasReplyBufferRef.current
    if (fullText.trim()) {
      appendTranscript('atlas', fullText.trim())
      onAtlasComplete?.(fullText.trim())
    }
    atlasReplyBufferRef.current = ''
    atlasSentBufferRef.current = ''
    atlasChatDoneRef.current = false
    playbackStartedRef.current = false
    playbackFinalReceivedRef.current = false
    playbackTailRef.current = 0
    if (playbackGainRef.current) playbackGainRef.current.gain.value = 1
    // Close TTS WS for this turn (a fresh one is opened per turn).
    try { ttsWsRef.current?.close() } catch { /* ignore */ }
    ttsWsRef.current = null
    setSpeakingLevel(0)

    // Wait briefly so the speaker actually goes silent before re-opening mic
    // (avoids re-capturing tail-end of audio output through the mic).
    if (turnCleanupTimerRef.current !== null) {
      clearTimeout(turnCleanupTimerRef.current)
    }
    turnCleanupTimerRef.current = window.setTimeout(() => {
      turnCleanupTimerRef.current = null
      if (stateRef.current === 'idle') return
      void beginListening()
    }, POST_PLAYBACK_RESUME_MS)
  }, [appendTranscript, onAtlasComplete])

  const fadeOutAndStopPlayback = useCallback(() => {
    const ctx = playbackCtxRef.current
    const gain = playbackGainRef.current
    if (!ctx || !gain) return
    try {
      const now = ctx.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0.0001, now + FADE_OUT_MS / 1000)
    } catch { /* ignore */ }

    window.setTimeout(() => {
      for (const src of playbackActiveSourcesRef.current) {
        try { src.stop() } catch { /* ignore */ }
      }
      playbackActiveSourcesRef.current.clear()
      playbackQueueRef.current = []
      playbackTailRef.current = 0
      if (playbackGainRef.current) playbackGainRef.current.gain.value = 1
    }, FADE_OUT_MS + 20)
  }, [])

  // ─── Per-turn pipeline ─────────────────────────────────────────────────────
  const startTurn = useCallback(async (audioBlob: Blob) => {
    if (audioBlob.size < 1024) {
      // Too quiet — go straight back to listening.
      void beginListening()
      return
    }
    setStateBoth('thinking')

    // Whisper STT
    const sttResult = await uploadStt(audioBlob)
    if (!sttResult.ok) {
      if (sttResult.budgetExceeded) {
        setBudgetBlocked(true)
        setErrorMessage(sttResult.message ?? 'Voice input disabled — monthly cap approaching.')
        endSession()
        return
      }
      setErrorMessage(sttResult.message ?? sttResult.error)
      // Recoverable — go back to listening.
      void beginListening()
      return
    }
    const userText = sttResult.transcript.trim()
    if (!userText) {
      void beginListening()
      return
    }
    appendTranscript('user', userText)
    onUserMessage?.(userText)

    // Atlas chat (SSE) — stream text to TTS WS as it arrives.
    atlasReplyBufferRef.current = ''
    atlasSentBufferRef.current = ''
    atlasChatDoneRef.current = false
    playbackFinalReceivedRef.current = false
    playbackStartedRef.current = false
    playbackTailRef.current = 0
    if (playbackGainRef.current) playbackGainRef.current.gain.value = 1

    const ctx = ensurePlaybackCtx()
    if (!ctx) {
      // Without playback we can't continue the live loop — fall back to listening.
      void beginListening()
      return
    }
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch { /* ignore */ }
    }

    // Open TTS WS.
    const ws = openTtsWs(voiceId, (event) => {
      if (event.kind === 'budget_exceeded') {
        setBudgetBlocked(true)
        setErrorMessage('Voice output disabled — monthly cap approaching.')
        endSession()
        return
      }
      if (event.kind === 'error') {
        // Don't bill / don't loop — surface error and go back to listening.
        setErrorMessage(`TTS: ${event.error}${event.detail ? ` (${event.detail})` : ''}`)
        return
      }
      if (event.kind === 'ready') {
        // Push any text the chat stream has already produced.
        flushBufferedTextToTts()
        return
      }
      if (event.kind === 'audio') {
        if (event.base64) {
          // First audio chunk arriving cancels filler/thinking on the server.
          try { ws.thinkingEnd() } catch { /* ignore */ }
          void decodeAndQueue(event.base64)
        }
        if (event.isFinal) {
          playbackFinalReceivedRef.current = true
          // If chat is done and no playback is queued/active, resume immediately.
          if (
            atlasChatDoneRef.current
            && playbackActiveSourcesRef.current.size === 0
            && playbackQueueRef.current.length === 0
            && stateRef.current === 'speaking'
          ) {
            finishSpeakingAndResume()
          }
        }
        return
      }
      if (event.kind === 'heartbeat') {
        // Server keep-alive — atlas-client already replies with heartbeat-ack;
        // nothing to render but it confirms the socket is alive.
        return
      }
      if (event.kind === 'turn_end') {
        // Server told us this turn ended — useful for the UI state pill in case
        // we miss the audio isFinal flag.
        return
      }
      if (event.kind === 'closed') {
        // Upstream WS closed mid-turn — let any queued audio finish, then try
        // to reconnect if the user hasn't ended the session.
        playbackFinalReceivedRef.current = true
        if (stateRef.current !== 'idle' && stateRef.current !== 'disconnected') {
          tryReconnect()
        }
      }
    })
    ttsWsRef.current = ws

    // Tell the server "we're entering thinking" so it can prepare a filler if
    // text doesn't arrive within FILLER_DELAY_MS.
    try { ws.thinkingStart() } catch { /* ignore */ }

    setStateBoth('speaking')

    chatAbortRef.current = streamChat(threadId, userText, (evt, data) => {
      const d = data as Record<string, unknown>
      if (evt === 'message' || evt === 'text') {
        const chunk = typeof d.text === 'string' ? d.text
          : typeof d.content === 'string' ? d.content
            : ''
        if (chunk) {
          atlasReplyBufferRef.current += chunk
          onAtlasChunk?.(chunk)
          flushBufferedTextToTts()
        }
      } else if (evt === 'done') {
        atlasChatDoneRef.current = true
        flushBufferedTextToTts(true /* final */)
        try { ttsWsRef.current?.flush() } catch { /* ignore */ }
        try { ttsWsRef.current?.close() } catch { /* ignore */ }
      } else if (evt === 'error') {
        atlasChatDoneRef.current = true
        const errMsg = typeof d.error === 'string' ? d.error : 'chat_error'
        setErrorMessage(`Chat: ${errMsg}`)
        try { ttsWsRef.current?.close() } catch { /* ignore */ }
        // If nothing was generated, return to listening.
        if (!atlasReplyBufferRef.current.trim()) {
          void beginListening()
        }
      }
    })
  }, [appendTranscript, ensurePlaybackCtx, finishSpeakingAndResume, onAtlasChunk, onUserMessage, threadId, voiceId])

  // Send any newly-buffered chat text to the TTS WS (only the delta since last send).
  const flushBufferedTextToTts = useCallback((final = false) => {
    const ws = ttsWsRef.current
    if (!ws) return
    const sent = atlasSentBufferRef.current
    const full = atlasReplyBufferRef.current
    if (full.length > sent.length) {
      const delta = full.slice(sent.length)
      atlasSentBufferRef.current = full
      // Strip markdown structure for spoken output (basic — keep prose punctuation).
      const cleaned = delta
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[*_`#>]/g, '')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      if (cleaned.trim()) {
        try { ws.sendText(cleaned) } catch { /* ignore */ }
      }
    }
    if (final) {
      try { ws.flush() } catch { /* ignore */ }
    }
  }, [])

  const decodeAndQueue = useCallback(async (b64: string) => {
    const ctx = playbackCtxRef.current
    if (!ctx) return
    try {
      const ab = base64ToArrayBuffer(b64)
      const buf = await ctx.decodeAudioData(ab.slice(0))
      playbackQueueRef.current.push(buf)
      // Pre-buffer ~500ms worth before starting playback to avoid underruns.
      if (!playbackStartedRef.current) {
        const total = playbackQueueRef.current.reduce((s, b) => s + b.duration * 1000, 0)
        if (total >= PREBUFFER_MS || playbackFinalReceivedRef.current) {
          playbackStartedRef.current = true
          scheduleNextChunks()
        }
      } else {
        scheduleNextChunks()
      }
    } catch (err) {
      // Don't kill the session for one bad chunk.
      void err
    }
  }, [scheduleNextChunks])

  // ─── Listening state — open mic, watch level, segment by silence ──────────
  const beginListening = useCallback(async () => {
    if (stateRef.current === 'idle') return
    stopAnalyser()
    chunksRef.current = []
    silenceStartRef.current = null
    speechAccumMsRef.current = 0
    turnStartedAtRef.current = Date.now()
    lastTickAtRef.current = Date.now()
    interruptSustainStartRef.current = null

    // Reuse existing stream if present, otherwise grab a new one.
    let stream = streamRef.current
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        const isPermission = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
        setErrorMessage(isPermission
          ? 'Microphone permission denied. Enable it in your browser settings to use live mode.'
          : `Microphone error: ${err instanceof Error ? err.message : String(err)}`)
        endSession()
        return
      }
      streamRef.current = stream
    }

    const mimeType = pickMimeType()
    if (!mimeType) {
      setErrorMessage('Voice not supported on this browser.')
      endSession()
      return
    }
    recorderMimeRef.current = mimeType

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch (err) {
      setErrorMessage(`Recorder init failed: ${err instanceof Error ? err.message : String(err)}`)
      endSession()
      return
    }
    recorderRef.current = recorder

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      // If the recorder stopped because we're shutting down or interrupting,
      // don't send to Whisper.
      if (stateRef.current !== 'listening') return
      // Also skip if the captured speech was below the minimum.
      if (speechAccumMsRef.current < MIN_SPEECH_MS) {
        // Reopen listening (don't bill Whisper for noise).
        void beginListening()
        return
      }
      void startTurn(blob)
    }

    // Audio analyser for level + silence detection.
    let audioCtx: AudioContext
    try {
      audioCtx = audioCtxRef.current ?? new AudioContext()
    } catch (err) {
      setErrorMessage(`Audio analyzer unavailable: ${err instanceof Error ? err.message : String(err)}`)
      endSession()
      return
    }
    audioCtxRef.current = audioCtx
    const src = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.frequencyBinCount)

    setStateBoth('listening')
    recorder.start(250)

    const tick = () => {
      const a = analyserRef.current
      const r = recorderRef.current
      if (!a || !r || stateRef.current !== 'listening') {
        rafRef.current = null
        return
      }
      a.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const avg = sum / data.length / 255
      setLevel(avg)

      const now = Date.now()
      const dt = Math.min(now - lastTickAtRef.current, 100)
      lastTickAtRef.current = now
      const elapsed = now - turnStartedAtRef.current

      if (avg < SILENCE_THRESHOLD) {
        if (silenceStartRef.current === null) silenceStartRef.current = now
        else if (
          now - silenceStartRef.current > SILENCE_END_TURN_MS
          && speechAccumMsRef.current >= MIN_SPEECH_MS
        ) {
          stopRecorder()
          return
        }
      } else {
        silenceStartRef.current = null
        speechAccumMsRef.current += dt
      }

      if (elapsed > HARD_TURN_CAP_MS && r.state !== 'inactive') {
        stopRecorder()
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [setStateBoth, startTurn, stopAnalyser, stopRecorder])

  // ─── Interrupt detection during SPEAKING ─────────────────────────────────
  // Mic is suspended during SPEAKING (echo prevention). We detect interrupts
  // via a separate, non-recording analyser on the same stream (analyser is kept
  // alive across states; recorder is recreated per turn).
  useEffect(() => {
    if (state !== 'speaking') return
    const stream = streamRef.current
    let interruptCtx: AudioContext | null = null
    let interruptAnalyser: AnalyserNode | null = null
    let raf: number | null = null
    let cancelled = false

    if (stream) {
      try {
        interruptCtx = new AudioContext()
        const src = interruptCtx.createMediaStreamSource(stream)
        const an = interruptCtx.createAnalyser()
        an.fftSize = 512
        src.connect(an)
        interruptAnalyser = an
      } catch {
        return
      }
    }

    const data = interruptAnalyser ? new Uint8Array(interruptAnalyser.frequencyBinCount) : null
    const tick = () => {
      if (cancelled || stateRef.current !== 'speaking') return
      if (interruptAnalyser && data) {
        interruptAnalyser.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]
        const avg = sum / data.length / 255
        if (avg > INTERRUPT_LEVEL) {
          if (interruptSustainStartRef.current === null) {
            interruptSustainStartRef.current = Date.now()
          } else if (Date.now() - interruptSustainStartRef.current > INTERRUPT_SUSTAIN_MS) {
            // Trigger interrupt
            interruptSustainStartRef.current = null
            handleInterrupt()
            return
          }
        } else {
          interruptSustainStartRef.current = null
        }
      }
      // Drive the speaking-level visualizer from the playback gain when we have
      // active audio sources.
      if (playbackActiveSourcesRef.current.size > 0) {
        setSpeakingLevel(0.4 + Math.random() * 0.5)
      } else {
        setSpeakingLevel(0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (raf !== null) cancelAnimationFrame(raf)
      if (interruptCtx) {
        void interruptCtx.close().catch(() => { /* ignore */ })
      }
    }
  }, [state])

  const handleInterrupt = useCallback(() => {
    if (stateRef.current !== 'speaking') return
    setStateBoth('interrupting')
    fadeOutAndStopPlayback()
    // Cancel any in-flight chat stream — we're abandoning Atlas's reply.
    try { chatAbortRef.current?.() } catch { /* ignore */ }
    chatAbortRef.current = null
    try { ttsWsRef.current?.close() } catch { /* ignore */ }
    ttsWsRef.current = null

    // Persist whatever we managed to capture as a partial Atlas turn.
    const partial = atlasReplyBufferRef.current.trim()
    if (partial) {
      appendTranscript('atlas', partial + ' …')
    }
    atlasReplyBufferRef.current = ''
    atlasSentBufferRef.current = ''
    atlasChatDoneRef.current = false
    playbackStartedRef.current = false
    playbackFinalReceivedRef.current = false
    playbackTailRef.current = 0

    setSpeakingLevel(0)
    window.setTimeout(() => {
      if (stateRef.current === 'idle') return
      void beginListening()
    }, FADE_OUT_MS + 50)
  }, [appendTranscript, beginListening, fadeOutAndStopPlayback, setStateBoth])

  // ─── Session lifecycle ────────────────────────────────────────────────────
  const endSession = useCallback(() => {
    if (stateRef.current === 'idle') return
    setStateBoth('idle')
    stopAnalyser()
    stopRecorder()
    if (turnCleanupTimerRef.current !== null) {
      clearTimeout(turnCleanupTimerRef.current)
      turnCleanupTimerRef.current = null
    }
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    setReconnectAttempt(0)
    if (sessionTickerRef.current !== null) {
      clearInterval(sessionTickerRef.current)
      sessionTickerRef.current = null
    }
    try { chatAbortRef.current?.() } catch { /* ignore */ }
    chatAbortRef.current = null
    try { ttsWsRef.current?.close() } catch { /* ignore */ }
    ttsWsRef.current = null
    fadeOutAndStopPlayback()
    if (playbackCtxRef.current) {
      const ctx = playbackCtxRef.current
      void ctx.close().catch(() => { /* ignore */ })
      playbackCtxRef.current = null
      playbackGainRef.current = null
    }
    playbackQueueRef.current = []
    playbackActiveSourcesRef.current.clear()
    playbackStartedRef.current = false
    playbackFinalReceivedRef.current = false
    playbackTailRef.current = 0
    atlasReplyBufferRef.current = ''
    atlasSentBufferRef.current = ''
    atlasChatDoneRef.current = false
    releaseStream()
    setLevel(0)
    setSpeakingLevel(0)
  }, [fadeOutAndStopPlayback, releaseStream, setStateBoth, stopAnalyser, stopRecorder])

  // ─── Reconnect on WS drop ────────────────────────────────────────────────
  // 3 attempts with 1s / 3s / 9s exponential backoff. While reconnecting we
  // flip into a 'reconnecting' state pill and reset the recorder so the user
  // doesn't lose their next utterance silently.
  const tryReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) return // already retrying
    setStateBoth('reconnecting')
    let attempt = reconnectAttempt
    const schedule = () => {
      if (stateRef.current === 'idle') return
      attempt += 1
      setReconnectAttempt(attempt)
      if (attempt > 3) {
        setErrorMessage('Call ended — could not reconnect after 3 attempts.')
        setStateBoth('disconnected')
        reconnectTimerRef.current = null
        return
      }
      const backoffMs = attempt === 1 ? 1000 : attempt === 2 ? 3000 : 9000
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        // Defer to beginListening — it will reset recorder + analyser.
        if (stateRef.current === 'idle' || stateRef.current === 'disconnected') return
        try {
          // Drop any stale handle; beginListening will reopen on next turn.
          ttsWsRef.current = null
        } catch { /* ignore */ }
        // Probe network with a noop fetch to /health; if it succeeds we treat
        // the WS as recoverable and resume listening.
        const probe = fetch(
          ((import.meta.env.VITE_ATLAS_URL ?? 'https://courteous-simplicity-production.up.railway.app') + '/health'),
          { method: 'GET' },
        ).then(r => r.ok).catch(() => false)
        void probe.then((ok) => {
          if (!ok) {
            schedule()
            return
          }
          // Network looks healthy — clear reconnect counter and resume.
          setReconnectAttempt(0)
          if (stateRef.current === 'reconnecting') {
            void beginListening()
          }
        })
      }, backoffMs)
    }
    schedule()
  }, [reconnectAttempt, setStateBoth])

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return
    setErrorMessage(null)
    setBudgetBlocked(false)
    setTranscript([])
    setReconnectAttempt(0)
    sessionStartRef.current = Date.now()
    setSessionElapsedMs(0)
    setStateBoth('connecting')

    if (sessionTickerRef.current !== null) clearInterval(sessionTickerRef.current)
    sessionTickerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - sessionStartRef.current
      setSessionElapsedMs(elapsed)
      if (elapsed >= SESSION_CAP_MS) {
        setErrorMessage('Live mode session ended (15 min cap). Click Start to resume.')
        endSession()
      }
    }, 250)

    await beginListening()
  }, [beginListening, endSession, setStateBoth])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stateRef.current = 'idle'
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (sessionTickerRef.current !== null) clearInterval(sessionTickerRef.current)
      if (turnCleanupTimerRef.current !== null) clearTimeout(turnCleanupTimerRef.current)
      try { chatAbortRef.current?.() } catch { /* ignore */ }
      try { ttsWsRef.current?.close() } catch { /* ignore */ }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop() } catch { /* ignore */ }
      }
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop()
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => { /* ignore */ })
      }
      if (playbackCtxRef.current) {
        void playbackCtxRef.current.close().catch(() => { /* ignore */ })
      }
    }
  }, [])

  return {
    state,
    active: state !== 'idle',
    level,
    speakingLevel,
    errorMessage,
    budgetBlocked,
    sessionElapsedMs,
    transcript,
    reconnectAttempt,
    start,
    end: endSession,
  }
}
