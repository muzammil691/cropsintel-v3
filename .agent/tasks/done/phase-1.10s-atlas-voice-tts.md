# Task: Phase 1.10s — Atlas voice (TTS via ElevenLabs)

**Master plan reference:** §10.3 (ElevenLabs $100/mo cap, voice ONLY); Atlas master spec §11. User directive 2026-05-01: Atlas chat powered by ElevenLabs.
**Context:** Atlas dashboard chat is text-only today. This spec adds optional text-to-speech: every Atlas reply in the dashboard is also rendered as audio via ElevenLabs. Toggle on/off; voice picker; cost tracked. Server-side proxy keeps API key out of the browser.
**Estimated effort:** ~55 min Builder time
**Model:** claude-opus-4-7 (UI + streaming audio matters)

model: claude-opus-4-7

---

## Goal

1. New endpoint `POST /atlas/tts` on the Atlas Railway service: takes `{ text, voice_id }`, streams audio back as `audio/mpeg`. ElevenLabs API key (`ELEVENLABS_API_KEY`) lives in Atlas env, never in browser bundle.
2. Dashboard adds a Voice toggle in the Atlas page header (next to TrustModeBadge).
3. When toggle is on, every assistant message played automatically once SSE stream closes (`event: done`). User can pause / replay / mute per-message.
4. Voice picker dropdown — list ElevenLabs voices via `GET /atlas/tts/voices`. Persist selected voice in `localStorage`.
5. Track cost per call: each TTS call logs to `atlas_cost_log` with `provider='elevenlabs'`, `service='atlas'`, `model='eleven_turbo_v2'`, `cost_usd` ≈ ($0.30 / 1000 characters for Turbo v2).
6. Budget gate: if monthly ElevenLabs spend would exceed $90 (90% of $100 cap), auto-disable TTS and ping user.

## Architecture

```
atlas/
├── src/
│   ├── lib/
│   │   ├── elevenlabs.ts               (NEW — TTS streaming client)
│   │   └── cost-log.ts                 (existing — extend with elevenlabs costs)
│   ├── server.ts                       (extend — /atlas/tts, /atlas/tts/voices)
│   └── ...
src/
├── components/
│   └── atlas/
│       ├── ChatPanel.tsx               (extend — auto-play audio when toggle on)
│       ├── VoiceToggle.tsx             (NEW)
│       ├── VoicePicker.tsx             (NEW)
│       └── AudioPlayer.tsx             (NEW — minimal play/pause UI under each message)
├── hooks/
│   └── useTts.ts                       (NEW — manage voice prefs, request audio, cache)
└── lib/
    └── atlas-client.ts                 (extend — fetchVoices, streamTts)
```

## Server side (`atlas/src/lib/elevenlabs.ts`)

```typescript
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'
const VOICE_DEFAULT = 'EXAVITQu4vr4xnSDxMaL' // Bella; user can change
const MODEL = 'eleven_turbo_v2'              // ~$0.30 / 1K chars

export async function streamTts(text: string, voiceId: string): Promise<Response> {
  return fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
}

export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } })
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`)
  const data = await res.json() as { voices: Voice[] }
  return data.voices
}
```

In `server.ts` wire `/atlas/tts` to `streamTts()` and pipe `Response.body` straight to the client (`Content-Type: audio/mpeg`, `Transfer-Encoding: chunked`).

## Cost logging

After each TTS call, write to `atlas_cost_log`:

```typescript
const charsCount = text.length
const costUsd = (charsCount / 1000) * 0.30
await sb.from('atlas_cost_log').insert({
  provider: 'elevenlabs',
  service: 'atlas',
  model: MODEL,
  input_tokens: charsCount,  // chars-as-tokens for ElevenLabs
  cost_usd: costUsd,
  request_metadata: { voice_id: voiceId, char_count: charsCount },
})
```

Before each call, query monthly spend; if > $90, return 429 with `{ error: 'budget_exceeded' }` and front-end shows toast "TTS disabled — monthly cap approaching."

## Frontend hook

```typescript
// src/hooks/useTts.ts
export function useTts() {
  const [enabled, setEnabled] = useLocalStorage('atlas-tts-enabled', false)
  const [voiceId, setVoiceId] = useLocalStorage('atlas-tts-voice', 'EXAVITQu4vr4xnSDxMaL')
  const [voices, setVoices] = useState<Voice[]>([])
  // ...
  const speak = async (text: string) => {
    if (!enabled || !text) return
    const res = await fetch(`${ATLAS_URL}/atlas/tts`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }),
    })
    if (!res.ok || !res.body) return
    const blob = await res.blob()
    const audio = new Audio(URL.createObjectURL(blob))
    audio.play()
  }
  return { enabled, setEnabled, voiceId, setVoiceId, voices, speak }
}
```

## Auto-play wiring in ChatPanel

When `useAtlasChat`'s `isStreaming` transitions from true to false AND last message is from `'atlas'` AND TTS is enabled, call `tts.speak(lastMessage.content)`.

## Files

- `atlas/src/lib/elevenlabs.ts` (NEW)
- `atlas/src/server.ts` (extend — `/atlas/tts`, `/atlas/tts/voices`)
- `atlas/src/lib/cost-log.ts` (extend — log_elevenlabs)
- `src/hooks/useTts.ts` (NEW)
- `src/components/atlas/VoiceToggle.tsx` (NEW)
- `src/components/atlas/VoicePicker.tsx` (NEW)
- `src/components/atlas/AudioPlayer.tsx` (NEW — per-message replay control)
- `src/components/atlas/ChatPanel.tsx` (extend — wire auto-play)
- `src/pages/Atlas.tsx` (extend — render VoiceToggle + VoicePicker in header)
- `src/lib/atlas-client.ts` (extend — fetchVoices, streamTts)

## Success criteria

- `npm run build` clean
- New env var `ELEVENLABS_API_KEY` documented in `atlas/README.md` (or new file)
- Toggle voice on, send Atlas a message → audio plays automatically when reply finishes
- Voice picker lists ≥3 voices; switching one persists across page refresh
- `atlas_cost_log` accumulates rows with `provider='elevenlabs'`
- Budget gate: with month_to_date stub at $95, next TTS request returns 429 + toast appears
- API key NOT present in `dist/` bundle (grep dist/ for partial substrings of the key — must return zero hits)
- Lighthouse accessibility ≥95 (audio elements have aria-label; toggle has role)

## Risks + mitigations

- **Risk:** Long replies = expensive. **Mitigation:** truncate text > 2000 chars before TTS with "… <reply continues in chat>" suffix; configurable.
- **Risk:** Audio autoplay blocked by browser policy. **Mitigation:** First user interaction (toggle click) registers gesture; subsequent autoplays pass. Show inline play button if autoplay fails.
- **Risk:** API key leak. **Mitigation:** Server proxy only; CI grep step in success criteria; docs warn against embedding in `VITE_*`.
- **Risk:** Quality vs cost: Turbo v2 is cheaper but less expressive than Multilingual v2. **Mitigation:** voice picker exposes both; default Turbo to keep budget.

## NEVER list

- Never put `ELEVENLABS_API_KEY` in `VITE_*` env (V2 mistake; explicit invariant).
- Never auto-play audio without user opting in via toggle.
- Never block the chat reply on TTS failure — text must always render even if audio errors.
