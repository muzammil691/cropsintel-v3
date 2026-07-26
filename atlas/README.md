# cropsintel-atlas

Atlas runtime service. Runs on Railway. Holds AI provider API keys; the browser
proxies through this service so secrets never ship in the bundle.

## Required environment variables

| Var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude (chat reasoning, spec authorship) |
| `OPENAI_API_KEY` | OpenAI (embeddings, Multi-Brain judge) |
| `GEMINI_API_KEY` | Gemini (fast extraction, Multi-Brain) |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS for Atlas dashboard voice replies. **Server-only — never set as `VITE_ELEVENLABS_API_KEY`.** |
| `V3_SUPABASE_URL` / `V3_SUPABASE_SECRET_KEY` | Supabase (persistence, cost log, conversations) |
| `ATLAS_API_TOKEN` | Bearer token clients use for `Authorization: Bearer …` |
| `BUDGET_OVERRIDE_TOKEN` | Optional one-shot override for the cost gate |

## Safety controls

| Var | Default | Purpose |
| --- | --- | --- |
| `ATLAS_EMERGENCY_STOP` | `false` | Process-level kill switch. When `true`, `1`, `yes`, or `on`, persisted trust-mode settings are ignored, all autonomous/background work and interactive endpoints are disabled, and only `GET /health` remains available. |
| `ATLAS_TRUST_MODE` | `passive` | Normal operating mode when the emergency stop is off. Invalid or missing values fail safely to `passive`; a persisted `atlas_config.trust_mode` may override it during normal operation. |

The emergency stop has higher authority than `ATLAS_TRUST_MODE` and the
persisted `atlas_config.trust_mode` row. The health response reports
`status: "emergency_stopped"` and `trust_mode: "stopped"` while it is active.

## Optional budget tuning

| Var | Default | Purpose |
| --- | --- | --- |
| `ATLAS_BUDGET_MONTHLY` | `400` | Hard monthly cap across all providers (USD) |
| `ATLAS_BUDGET_DAILY_PAUSE` | `40` | Daily soft cap (USD); auto-dispatch pauses 1h |
| `ATLAS_BUDGET_ANTHROPIC` | `200` | Anthropic sub-cap (USD/mo) |
| `ATLAS_BUDGET_OPENAI` | `50` | OpenAI sub-cap (USD/mo) |
| `ATLAS_BUDGET_GEMINI` | `50` | Gemini sub-cap (USD/mo) |
| `ATLAS_BUDGET_ELEVENLABS` | `100` | ElevenLabs sub-cap (USD/mo) |
| `ATLAS_BUDGET_ELEVENLABS_GATE` | `90` | TTS short-circuit threshold; once monthly elevenlabs spend ≥ this, `/atlas/tts` returns 429 `budget_exceeded` |

## TTS endpoints (Phase 1.10s)

- `POST /atlas/tts` — body `{ text, voice_id }`. Streams `audio/mpeg`. Truncates input to 2000 chars. Logs each call to `atlas_cost_log` with `provider='elevenlabs'`, `model='eleven_turbo_v2'`, `cost_usd ≈ chars / 1000 × $0.30`.
- `GET /atlas/tts/voices` — proxies the ElevenLabs voice catalog.

## Security invariant

`ELEVENLABS_API_KEY` is read **only** in `atlas/` (this service). It must never be
added to any `VITE_*` env or read by code under `src/` — that would leak the key
into the browser bundle, repeating the V2 mistake. CI greps the production
build to confirm absence.

## Scripts

- `npm run build` — `tsc` to `dist/`
- `npm run start` — `node dist/index.js server`
- `npm run dev` — `tsc --watch`
