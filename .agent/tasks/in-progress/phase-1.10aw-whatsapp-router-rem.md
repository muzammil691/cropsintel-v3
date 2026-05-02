# Task: Phase 1.10aw-rem — WhatsApp Full Router Remediation (Parts A–F)

## Goal
The original phase-1.10aw shipped only a truncated partial file. This remediation delivers all 6 parts of the WhatsApp router: sentence-boundary splitter, auto-split send, inbound slash command parsing, conductor outbound integration, voice STT parity, and full slash command handlers.

## Files to create / modify
- `atlas/src/lib/whatsapp-split.ts` — sentence-boundary splitter; splits at sentence boundaries keeping under 1600 chars per Twilio segment; never cuts mid-word
- `atlas/src/lib/twilio.ts` — extend with `sendWhatsAppReplyAutoSplit(to, body)` using whatsapp-split.ts
- `atlas/src/lib/slash-commands-server.ts` — complete Parts A–F: /status, /queue, /done, /audit, /ingest, /help handlers; each returns structured WhatsApp-formatted reply
- `atlas/src/server.ts` — inbound webhook: `parseSlash(body)`, `dispatchSlashCommand(cmd, args)`, auto-split reply wiring; outbound: conductor trigger
- `atlas/src/conductor.ts` — outbound auto-split integration; all outbound WhatsApp calls route through sendWhatsAppReplyAutoSplit
- Voice STT parity: inbound voice transcript handler detects slash-style commands identically to text

## Success criteria
- `sendWhatsAppReplyAutoSplit` splits a 4000-char string into ≥2 segments, each ≤1600 chars, at sentence boundaries
- All 6 slash commands (/status /queue /done /audit /ingest /help) return non-empty formatted replies
- Inbound webhook correctly routes slash vs plain message
- Voice transcript with "/status" triggers same handler as text "/status"
- conductor.ts outbound never calls raw twilio.send directly — always goes through auto-split
- No stub, no TODO, no placeholder in any file
- Verifier stub-detector passes clean

## Risks + mitigations
- Risk: Twilio credentials not in env — mitigation: guard with process.env check, throw descriptive error if absent
- Risk: slash-commands-server.ts already partially exists — mitigation: read existing file first, extend don't overwrite
- Risk: voice STT shape unknown — mitigation: add null guard on transcript field, log warning if absent

## NEVER list
- NEVER delete existing slash-commands-server.ts content — extend only
- NEVER send raw unsplit messages through Twilio for bodies > 1600 chars
- NEVER add Twilio SDK version change
- NEVER touch Atlas chat routes or conductor logic unrelated to WhatsApp outbound
- NEVER leave TODO, "coming soon", or placeholder in any delivered file
