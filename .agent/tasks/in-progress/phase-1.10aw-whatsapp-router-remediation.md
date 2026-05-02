# Task: Phase 1.10aw — WhatsApp Full Router Remediation

## Goal
Complete the WhatsApp router. Currently only a partial truncated `slash-commands-server.ts` exists. Parts B–F of the spec were never written. Builder must implement all missing parts.

## Files to create / extend
- `atlas/src/lib/whatsapp-split.ts` — sentence-boundary auto-splitter. Input: string. Output: string[]. Max chunk 1600 chars. Split on sentence boundaries (. ! ?) first, word boundaries second. Never cut mid-word.
- `atlas/src/lib/twilio.ts` — extend with `sendWhatsAppReplyAutoSplit(to: string, body: string): Promise<void>`. Calls whatsapp-split.ts, sends each chunk sequentially with 300ms delay between chunks.
- `atlas/src/server.ts` — extend inbound webhook handler: `POST /whatsapp/inbound` → parseSlash(body) → dispatchSlashCommand(cmd) → sendWhatsAppReplyAutoSplit(from, result). Wire auto-split to all outbound replies.
- `atlas/src/conductor.ts` — extend outbound path: all WhatsApp sends go through sendWhatsAppReplyAutoSplit, not raw twilio send.
- `atlas/src/lib/slash-commands-server.ts` — complete Parts A–F: /status, /queue, /done, /cancel <id>, /priority <id> <n>, /ask <question>. Each returns formatted string.
- Voice STT parity — inbound handler detects SpeechResult field (Twilio voice transcription), routes through same dispatchSlashCommand pipeline as text.

## Success criteria
- `POST /whatsapp/inbound` responds 200 to Twilio webhook with valid TwiML
- Messages over 1600 chars are split and all chunks delivered
- All 6 slash commands (/status /queue /done /cancel /priority /ask) return correct formatted responses
- Voice transcripts route through same command pipeline as text messages
- sendWhatsAppReplyAutoSplit is used for ALL outbound WhatsApp sends — no raw sends remain
- No placeholder text, no TODOs, no "coming soon" strings

## Risks + mitigations
- Risk: Twilio env vars absent → mitigation: guard with clear error log, do not crash server
- Risk: Chunk delivery order not guaranteed → mitigation: sequential await with 300ms delay, not Promise.all
- Risk: Voice SpeechResult field absent in some webhooks → mitigation: graceful fallback, log and ignore
- Risk: dispatchSlashCommand unknown command → mitigation: return "Unknown command. Try /status /queue /done /cancel /priority /ask"

## NEVER list
- NEVER use Promise.all for chunk sending — sequential only
- NEVER crash the server on Twilio env var absence — log and continue
- NEVER modify existing WhatsApp send calls that are already working — only replace raw sends with auto-split wrapper
- NEVER add new npm packages not already in package.json
- NEVER touch inbound webhook TwiML response format — Twilio requires exact XML structure
- NEVER store inbound message content in logs beyond task ID and command type (privacy)