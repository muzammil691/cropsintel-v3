# Task: Phase 1.10u — Atlas live conversation mode

**Master plan reference:** Atlas master spec §11; user directive 2026-05-01: "live call where it will discuss with me as human."
**Context:** 1.10s + 1.10t add half-duplex voice (one side at a time, with explicit toggles). 1.10u packages the same plumbing into a continuous-conversation mode — one button, hold the mic open, Atlas listens + replies + listens again until you stop. Voice in / voice out / voice in / … without clicking. Uses ElevenLabs WebSocket streaming for low-latency TTS.
**Estimated effort:** ~80 min Builder time
**Model:** claude-opus-4-7 (concurrency + state-machine)

model: claude-opus-4-7

---

## Goal

1. Dashboard "Start live conversation" button (large, prominent — green when idle, red when active).
2. While active:
   - Continuous mic capture, segmented by silence (2 s of silence ends a turn)
   - Each turn → Whisper transcribe → Atlas chat → Atlas streams reply text → ElevenLabs streams audio over WebSocket → audio plays instantly (no full-message wait)
   - Atlas auto-listens again the moment audio playback finishes
   - "End conversation" stops the loop
3. Visual states in UI: idle / listening (you) / thinking (Atlas) / speaking (Atlas) — matching color + waveform animation.
4. Interruptible: while Atlas is speaking, if user starts talking, audio playback ducks then stops.
5. Live transcript renders both sides in chat below the call panel — same SSE stream as 1.10s, just with audio.
6. Hard cap: 15 min per session ($cap_protection); cost log per turn.

## Architecture

```
atlas/
├── src/
│   ├── lib/
│   │   ├── elevenlabs.ts               (extend — WebSocket streaming endpoint)
│   │   └── ...
│   └── server.ts                       (extend — `/atlas/tts/stream` returns SSE chunks of base64-encoded audio)
src/
├── components/
│   └── atlas/
│       ├── LiveModePanel.tsx           (NEW — full-bleed call UI)
│       ├── LiveModeButton.tsx          (NEW — start/stop)
│       └── WaveformVisualizer.tsx      (NEW — animated bars)
├── hooks/
│   └── useLiveMode.ts                  (NEW — orchestrates state machine)
└── lib/
    └── atlas-client.ts                 (extend — streamTts WS connection)
```

## State machine (`useLiveMode`)

```
IDLE
  → user clicks "Start" → LISTENING
LISTENING
  → silence 2s detected AND speech ≥ 1s → THINKING (POST audio to Whisper)
  → user clicks "End" → IDLE (cleanup all streams)
THINKING
  → Whisper returns transcript → POST to /atlas/chat with stream=true → SPEAKING (start consuming TTS WS)
SPEAKING
  → audio playback ends → LISTENING
  → user voice level rises mid-playback → INTERRUPTING
INTERRUPTING
  → fade out current audio over 200ms → LISTENING
```

## ElevenLabs WS streaming

ElevenLabs supports WebSocket TTS at `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`. Atlas Railway service mediates: dashboard opens its own WS to Atlas at `wss://courteous-simplicity-production.up.railway.app/atlas/tts-ws`, Atlas opens upstream WS to ElevenLabs, pipes chunks (base64 audio) back to dashboard. Dashboard plays via Web Audio API decode + AudioBufferSourceNode chain.

```typescript
// atlas/src/server.ts — pseudocode using ws library
import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ server: httpServer, path: '/atlas/tts-ws' })
wss.on('connection', (ws, req) => {
  // auth bearer check on req.headers['sec-websocket-protocol'] or query param
  if (!authOk(req)) { ws.close(1008); return }
  let upstream: WebSocket | null = null
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.type === 'open') {
      upstream = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${msg.voiceId}/stream-input?model_id=eleven_turbo_v2`)
      upstream.on('message', (chunk) => ws.send(chunk)) // base64 audio
    } else if (msg.type === 'text') {
      upstream?.send(JSON.stringify({ text: msg.text, try_trigger_generation: true }))
    } else if (msg.type === 'flush') {
      upstream?.send(JSON.stringify({ text: '' })) // EOS
    }
  })
  ws.on('close', () => upstream?.close())
})
```

## Cost tracking

Each live-mode turn logs three rows:
- Whisper STT (per 1.10t)
- Anthropic chat (per existing `cost-log.ts`)
- ElevenLabs TTS (per 1.10s, but use char count of streamed text)

## Files

- `atlas/src/server.ts` (extend — WS upgrade + `/atlas/tts-ws`)
- `atlas/src/lib/elevenlabs.ts` (extend — openWsStream)
- `atlas/package.json` (add `ws` + `@types/ws`)
- `src/hooks/useLiveMode.ts` (NEW)
- `src/components/atlas/LiveModePanel.tsx` (NEW)
- `src/components/atlas/LiveModeButton.tsx` (NEW)
- `src/components/atlas/WaveformVisualizer.tsx` (NEW)
- `src/pages/Atlas.tsx` (extend — render LiveModeButton in header; LiveModePanel as overlay/modal when active)
- `src/lib/atlas-client.ts` (extend — `openTtsWs`)

## Success criteria

- Click Start → permission prompt → "Listening… speak when ready" message
- Speak a question → 2 s pause → "Thinking…" → audio reply begins playing within 2 s
- After audio ends, returns to listening automatically
- Click End at any state → all streams close cleanly; mic releases (browser indicator goes away)
- Interrupt test: while Atlas is mid-reply, start speaking → audio fades out within 300 ms; new turn captured
- 15-min hard cap fires with toast "Live mode session ended (15 min cap). Click Start to resume."
- Cost log shows three rows per turn (Whisper + Anthropic + ElevenLabs)
- Live transcript renders both sides in ChatPanel exactly as if it were typed
- Atlas's honesty rules from 1.10q still apply — verbal claims must be tool-grounded

## Risks + mitigations

- **Risk:** ElevenLabs WS rate limits. **Mitigation:** docs note Free / Starter limits; budget gate disables live mode if monthly TTS spend > $80.
- **Risk:** Audio decoder lag on slow devices. **Mitigation:** chunked decode + buffer 500 ms ahead before play; if buffer underruns, pause & resume.
- **Risk:** Echo cancellation issues (mic picks up Atlas's voice). **Mitigation:** default suspend mic during SPEAKING state; only resume after 200 ms post-playback.
- **Risk:** WebSocket auth token in URL leaks via logs. **Mitigation:** use `Sec-WebSocket-Protocol` header for token; server validates before accepting connection.

## NEVER list

- Never auto-start a live mode session — always require explicit user click.
- Never record without showing the active mic indicator in UI.
- Never bill the user for a turn if Whisper or ElevenLabs errored mid-stream.
- Never let echo create infinite loop (Atlas hearing itself, replying, looping).
