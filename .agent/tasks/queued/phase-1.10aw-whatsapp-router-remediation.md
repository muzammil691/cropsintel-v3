# Task: Phase 1.10aw-rem — WhatsApp Router Full Implementation Remediation

## Goal
Complete the WhatsApp full router implementation. Only a partial slash-commands-server.ts shipped. Parts B–F are entirely absent. Six files need to be created or completed.

## Background
phase-1.10aw-atlas-whatsapp-full-router shipped one truncated file. Verifier o3 confirmed: whatsapp-split.ts absent, sendWhatsAppReplyAutoSplit absent, inbound parseSlash + dispatchSlashCommand absent, conductor.ts outbound integration absent, voice STT parity absent.

## Files To Create / Modify

### 1. atlas/src/lib/whatsapp-split.ts (CREATE)
- `splitMessage(text: string, maxLen?: number): string[]`
- Default maxLen = 1600 chars (Twilio WhatsApp limit)
- Split on sentence boundaries (. ! ?) first, then word boundaries, never mid-word
- If single sentence > maxLen, hard split at maxLen
- Export splitMessage as named export

### 2. atlas/src/lib/twilio.ts (EXTEND)
- Add `sendWhatsAppReplyAutoSplit(to: string, body: string): Promise<void>`
- Uses splitMessage from whatsapp-split.ts
- Sends each chunk sequentially with 200ms delay between chunks
- Logs each chunk send to atlas_events table
- Never throws — catches errors, logs to atlas_events with error flag

### 3. atlas/src/server.ts — Inbound Handler (EXTEND)
- Add `POST /whatsapp/inbound` route (Twilio webhook)
- Parse incoming body: From, Body, MediaUrl0
- Call `parseSlash(body: string): SlashCommand | null`
- Call `dispatchSlashCommand(cmd: SlashCommand, from: string): Promise<string>`
- Reply via sendWhatsAppReplyAutoSplit
- Verify Twilio webhook signature (X-Twilio-Signature header)
- Return 200 TwiML with empty response body (reply sent via API not TwiML)

### 4. atlas/src/lib/slash-commands-server.ts (COMPLETE Parts A–F)
- Part A: /status → calls status_snapshot, formats summary
- Part B: /queue → calls builder.list_queue, returns top 5
- Part C: /done [filter] → calls builder.list_done with filter
- Part D: /audit [taskId] → triggers verifier.audit
- Part E: /scrape [source] → triggers adela.trigger_scrape
- Part F: /help → returns command list
- parseSlash: regex-based, returns { command, args } or null
- dispatchSlashCommand: routes to correct handler, returns formatted string

### 5. atlas/src/conductor.ts (EXTEND)
- Add outbound WhatsApp notification on task completion
- `notifyWhatsApp(to: string, message: string): Promise<void>`
- Wire to existing task-done event emitter
- Uses sendWhatsAppReplyAutoSplit
- Only fires if WHATSAPP_NOTIFY_NUMBER env var is set

### 6. Voice STT Parity (EXTEND inbound handler)
- If MediaUrl0 is present in inbound, detect as voice message
- Download media, pass to existing STT pipeline if available
- Extract text transcript, run through parseSlash
- If no STT pipeline, reply "Voice not yet supported" gracefully

## Success Criteria
- [ ] `whatsapp-split.ts` exists, splitMessage handles 1600 char limit correctly
- [ ] `sendWhatsAppReplyAutoSplit` sends multi-chunk messages sequentially
- [ ] `POST /whatsapp/inbound` route exists and verifies Twilio signature
- [ ] All 6 slash commands (Parts A–F) implemented and routing correctly
- [ ] `parseSlash` correctly parses /status, /queue, /done, /audit, /scrape, /help
- [ ] conductor.ts fires WhatsApp notification on task completion
- [ ] Voice STT path exists with graceful fallback
- [ ] No TypeScript errors
- [ ] No stub/placeholder text anywhere in implementation

## Risks + Mitigations
- Risk: Twilio signature verification fails in dev → Mitigation: skip signature check if NODE_ENV=development, always enforce in production
- Risk: STT pipeline not present → Mitigation: graceful "Voice not yet supported" reply, never crash
- Risk: conductor.ts event emitter shape unknown → Mitigation: read existing conductor.ts before extending, match existing event patterns
- Risk: Rate limiting on multi-chunk sends → Mitigation: 200ms delay between chunks, exponential backoff on 429

## NEVER List
- NEVER disable Twilio signature verification in production
- NEVER throw unhandled errors from slash command handlers — always catch and return error string
- NEVER send WhatsApp messages without auto-split — raw sendWhatsApp calls must not bypass split
- NEVER modify existing Twilio voice call routes
- NEVER hardcode phone numbers — always read from env vars
- NEVER add new npm packages without checking package.json first
- NEVER modify existing conductor.ts logic — only extend with new notifyWhatsApp function
