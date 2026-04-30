# Task: Phase 1.10t — Atlas voice (STT — browser mic to chat input)

**Master plan reference:** Atlas master spec §11; user directive 2026-05-01 (voice with Atlas).
**Context:** With 1.10s adding TTS, this spec adds the inverse — voice input. Browser mic captures user speech, streams to a server-side STT (Whisper or Deepgram), inserts the transcript into the chat input field. Push-to-talk + auto-stop-on-silence. Combined with 1.10s, this is half-duplex voice chat (one side at a time).
**Estimated effort:** ~60 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. New endpoint `POST /atlas/stt` on Atlas Railway service: receives `multipart/form-data` audio blob, returns `{ transcript, duration_ms }`. Backed by OpenAI Whisper API (`whisper-1`) — already covered under §10.3 OpenAI $50/mo cap.
2. Dashboard adds a mic button next to the Send button in `ChatPanel`. Click to start recording; click again to stop. Visual VU-meter while recording.
3. Auto-stop on 2 s of silence (configurable). Hard cap: 60 s recording max.
4. Transcript pre-populates the chat input — user reviews, can edit, then sends. (Hands-free option in 1.10u live mode.)
5. Cost log per call to `atlas_cost_log` (Whisper: $0.006 / minute).

## Architecture

```
atlas/
├── src/
│   ├── lib/
│   │   ├── whisper.ts                  (NEW — POST audio to OpenAI Whisper)
│   │   └── ...
│   └── server.ts                       (extend — /atlas/stt with multipart)
src/
├── components/
│   └── atlas/
│       ├── MicButton.tsx               (NEW — record toggle + VU meter)
│       └── ChatPanel.tsx               (extend — wire MicButton → input)
├── hooks/
│   └── useStt.ts                       (NEW — MediaRecorder + silence detect + upload)
└── lib/
    └── atlas-client.ts                 (extend — uploadStt(blob))
```

## Server side

```typescript
// atlas/src/lib/whisper.ts
import OpenAI from 'openai'
import { File } from 'node:buffer'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function transcribe(audio: ArrayBuffer, mimeType: string): Promise<{ text: string; duration: number }> {
  const file = new File([audio], 'audio.webm', { type: mimeType })
  const start = Date.now()
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'json',
    language: 'en',
  })
  return { text: result.text, duration: Date.now() - start }
}
```

`server.ts` accepts `audio/webm`, `audio/mp4`, or `audio/wav` — Chrome typically sends `audio/webm; codecs=opus`. Returns `{ transcript: string, duration_ms: number }`.

## Cost log

```typescript
// duration estimate: file size in seconds (rough — better: read header but that's overkill)
const audioSeconds = audioBytes.length / (16000 * 2) // assume 16kHz 16-bit
const costUsd = (audioSeconds / 60) * 0.006
await sb.from('atlas_cost_log').insert({
  provider: 'openai',
  service: 'atlas',
  model: 'whisper-1',
  cost_usd: costUsd,
  input_tokens: Math.ceil(audioSeconds),  // seconds-as-tokens
  request_metadata: { duration_seconds: audioSeconds },
})
```

## Frontend `useStt` hook

```typescript
export function useStt() {
  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0) // 0..1 for VU meter
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const silenceStartRef = useRef<number | null>(null)
  const startedAtRef = useRef<number>(0)

  const start = async (onResult: (text: string) => void) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    chunksRef.current = []
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      const fd = new FormData()
      fd.append('audio', blob, 'audio.webm')
      const res = await fetch(`${ATLAS_URL}/atlas/stt`, { method: 'POST', headers: authHeaders(), body: fd })
      const json = await res.json()
      onResult(json.transcript ?? '')
    }
    recorder.start(250) // chunk every 250ms
    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    setRecording(true)

    // VU meter + silence detect
    const audioCtx = new AudioContext()
    const src = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!recorderRef.current) return
      analyser.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255
      setLevel(avg)
      const now = Date.now()
      if (avg < 0.05) {
        if (silenceStartRef.current === null) silenceStartRef.current = now
        else if (now - silenceStartRef.current > 2000 && now - startedAtRef.current > 1500) stop()
      } else {
        silenceStartRef.current = null
      }
      // Hard 60s cap
      if (now - startedAtRef.current > 60000) stop()
      requestAnimationFrame(tick)
    }
    tick()
  }

  const stop = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    setLevel(0)
  }

  return { recording, level, start, stop }
}
```

## Files

- `atlas/src/lib/whisper.ts` (NEW)
- `atlas/src/server.ts` (extend — multipart parsing + `/atlas/stt`)
- `src/components/atlas/MicButton.tsx` (NEW)
- `src/components/atlas/ChatPanel.tsx` (extend — render MicButton; on transcript, set input)
- `src/hooks/useStt.ts` (NEW)
- `src/lib/atlas-client.ts` (extend — `uploadStt`)

## Success criteria

- Mic button visible in ChatPanel input row
- Click → browser permission prompt (first time only) → recording starts → VU meter animates
- Speak "Hello Atlas, what's the queue status?" → 2 s silence → transcript appears in input field
- User can edit + send normally
- Manual stop button works mid-recording
- 60 s hard cap kicks in (record continuously, verify auto-stop)
- `atlas_cost_log` shows `provider='openai'`, `model='whisper-1'` rows
- Mic permissions denial → graceful inline error, not console-only
- Lighthouse accessibility: mic button has aria-label, recording state announced via aria-live

## Risks + mitigations

- **Risk:** Whisper latency 1–3 s for 10 s audio. **Mitigation:** show "transcribing…" state; never block UI.
- **Risk:** iOS Safari `audio/webm` unsupported. **Mitigation:** detect via `MediaRecorder.isTypeSupported` and fall back to `audio/mp4`. If neither, show "Voice not supported on this browser".
- **Risk:** Background noise causes false silence-detection trigger. **Mitigation:** threshold 0.05 + minimum 1.5 s recording before silence-stop kicks in.
- **Risk:** User leaks confidential speech to OpenAI. **Mitigation:** docs note Whisper has 30-day retention by default; OpenAI zero-data-retention available on enterprise plan; surface this in toggle tooltip.

## NEVER list

- Never start recording without user click (no auto-listen).
- Never store recorded audio server-side beyond the duration of the transcribe call (delete after Whisper returns).
- Never expose `OPENAI_API_KEY` in browser bundle.
