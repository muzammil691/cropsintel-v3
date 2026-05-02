# Task: Phase 1.10aw-rem — Atlas WhatsApp Router Full Implementation

## Goal
Complete the WhatsApp router from ~20% to 100%. Only a truncated `slash-commands-server.ts` exists. Parts B–F and all integration wiring are absent.

## Files to create / modify
1. `atlas/src/lib/whatsapp-split.ts` — sentence-boundary auto-splitter. Splits messages at sentence boundaries, max 1600 chars per chunk. Export `splitMessage(text: string): string[]`.
2. `atlas/src/lib/twilio.ts` — extend with `sendWhatsAppReplyAutoSplit(to: string, body: string): Promise<void>`. Uses `splitMessage` internally. Never throws — logs errors, resolves.
3. `atlas/src/lib/slash-commands-server.ts` — complete ALL parts A–F:
   - Part A: `/status` → call status.snapshot, format reply
   - Part B: `/queue` → call builder.list_queue, format reply
   - Part C: `/done [filter]` → call builder.list_done, format reply
   - Part D: `/audit [taskId]` → call verifier.audit, format reply
   - Part E: `/ingest [source]` → call memory.ingest, format reply
   - Part F: `/help` → list all commands with descriptions
4. `atlas/src/server.ts` — extend inbound WhatsApp webhook:
   - Parse slash commands via `parseSlash(body: string)`
   - Dispatch to `dispatchSlashCommand(cmd, args)`
   - Auto-split all outbound replies via `sendWhatsAppReplyAutoSplit`
5. `atlas/src/conductor.ts` — wire outbound notifications through `sendWhatsAppReplyAutoSplit` instead of raw Twilio send
6. Voice STT parity — in inbound handler, detect commands from voice transcripts (same slash dispatch, prefix detection on transcript text)

## Success criteria
- `splitMessage("x".repeat(3200))` returns array of 2 chunks each ≤1600 chars
- `splitMessage` splits at sentence boundaries not mid-word
- `/status` slash command returns status snapshot text over WhatsApp
- `/queue` slash command returns current queue list
- `/done` slash command returns done list
- `/audit taskId` slash command triggers verifier and returns verdict
- `/help` returns all 6 commands listed
- Inbound webhook routes all slash commands without 500 errors
- Voice transcript with `/status` prefix dispatches correctly
- No TODO / coming soon / placeholder strings anywhere
- TypeScript compiles with zero errors

## Risks + mitigations
- Risk: Twilio env vars absent → mitigation: guard with `if (!process.env.TWILIO_AUTH_TOKEN) { log warn; return; }` — never throw
- Risk: Slash command dispatch async errors → mitigation: wrap every dispatch in try/catch, reply with "Error: <message>" not silence
- Risk: Voice transcript format varies → mitigation: normalize to lowercase, trim, then prefix-match
- Risk: Existing inbound webhook already partially implemented → mitigation: read existing server.ts before writing; extend, never replace

## NEVER list
- NEVER delete existing Twilio send functions — only extend
- NEVER replace existing inbound webhook handler — extend only
- NEVER throw errors upward from sendWhatsAppReplyAutoSplit
- NEVER hardcode phone numbers or Twilio credentials
- NEVER add npm packages not already in package.json
- NEVER leave TODO, "coming soon", or placeholder strings
- NEVER send unsplit messages >1600 chars via raw Twilio client
