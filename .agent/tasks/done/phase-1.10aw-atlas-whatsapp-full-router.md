---
priority: 2
depends-on: []
---

# Task: Phase 1.10aw — WhatsApp full command router + auto-split (sentence-aware)

**Master plan reference:** §1.10v WhatsApp voice; §1.10 Atlas conductor; user vision discussion 2026-05-02 ("Operate Atlas from WhatsApp — not just notifications, full commands. Atlas knows the character limit → auto-splits long messages into multiple. Never cuts mid-sentence or mid-word. Voice messages on WhatsApp → Atlas transcribes and acts").

**Context:** Atlas's WhatsApp inbound today (`atlas/src/server.ts` `[whatsapp-inbound]`) accepts text + voice notes and forwards them to the chat handler. It already replies via Twilio. What's missing:

1. **Full slash-command parity over WhatsApp** — typing `/queue` or `/status` in WhatsApp should run the same tool the cockpit chat does and reply with the result.
2. **Auto-split for long replies** — Twilio caps at 1600 chars per message; long Atlas responses get truncated mid-sentence. Need sentence-aware splitting that respects paragraph + sentence boundaries and never breaks a word.
3. **Voice command parity** — voice notes get STT'd already; need to detect slash commands inside the transcript ("slash status") and run them.

**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — Slash command detection

`atlas/src/lib/slash-commands-server.ts` (NEW):

Mirror of the frontend's `atlas-slash-commands.ts` but server-side. Exports:

```typescript
type ParsedSlashCommand = { name: string; args: string[]; raw: string }
function parseSlash(text: string): ParsedSlashCommand | null
async function dispatchSlashCommand(cmd: ParsedSlashCommand, principal: AuthPrincipal): Promise<{ text: string; cost_usd?: number }>
```

Supported commands (subset of the frontend's, with sensible defaults):
- `/status` → calls `status.snapshot`, formats as "Queue: N | In flight: M | Cost today: $X.XX | Done: K"
- `/queue` → calls `builder.list_queue`, formats as numbered list
- `/done` → calls `builder.list_done`, last 5
- `/cost` → today's cost + MTD
- `/agents` → 7-agent health line ("Atlas 🟢 · Builder 🟢 · ...")
- `/help` → list of available commands

Voice-friendly aliases: voice STT often produces "slash status" (with a space) or "status" (no slash). Recognize both:
- Plain "status" / "queue" / "done" / "cost" / "agents" / "help" at the start of the message → treat as slash command
- "slash X" / "atlas X" prefix → also accepted

### Part B — Auto-split long messages (sentence-aware)

`atlas/src/lib/whatsapp-split.ts` (NEW):

```typescript
const TWILIO_LIMIT = 1500  // 1600 minus margin for safety
function splitForWhatsApp(text: string, limit = TWILIO_LIMIT): string[]
```

Algorithm:
1. If `text.length <= limit`, return `[text]`.
2. Split on paragraph boundaries (`\n\n` or `\n` runs).
3. For each paragraph:
   - If it fits in the current chunk, append.
   - If not, finalize the current chunk and start a new one. If the paragraph itself > limit, sentence-split it (regex on `[.!?]\s+(?=[A-Z])` — rough but works for English; preserves the punctuation).
   - If a single sentence > limit, soft-break on word boundaries (regex `\s`), never mid-word.
4. Tag each part with `(part N/M)` suffix at the end so the user knows there's more coming.
5. Insert a small delay (250ms) between sequential sends in `sendWhatsAppReply` to keep ordering.

### Part C — Wire into inbound handler

`atlas/src/server.ts` `[whatsapp-inbound]`:

```
incoming text or voice transcript
  → strip Twilio "whatsapp:" prefix
  → check parseSlash() — if matches, dispatchSlashCommand() and reply with result (auto-split if needed)
  → else: existing flow (forward to chat handler, Claude responds)
  → reply via splitForWhatsApp() + sequential sendWhatsAppReply() loop
```

### Part D — Outbound — wire splitter into ALL existing send sites

Update every `sendWhatsAppReply(to, body)` call site that may exceed the limit:
- conductor.ts WhatsApp pings (status snapshots, escalations) — usually short, but wrap to be safe
- server.ts whatsapp-inbound replies — definitely need it
- twilio.ts itself — add a `sendWhatsAppReplyAutoSplit(to, body)` helper that wraps `sendWhatsAppReply` per-part

### Part E — Voice command parity

When STT runs on a voice note (existing 1.10t flow), pass the transcript through `parseSlash()` first. If a command matches, run it. Otherwise treat as a normal chat message. The voice reply should also auto-split if Atlas's response is long.

### Part F — Cost-gate the slash dispatch

A slash command itself shouldn't trigger Multi-Brain debate or any expensive call beyond the underlying tool. For example, `/status` is a single Supabase query — it shouldn't cost more than $0.001. If a slash command's underlying tool is expensive (e.g., `/diagnose <commit>` that runs the diagnose classifier) — gate it with `checkBudget` before dispatching.

## Files

- `atlas/src/lib/slash-commands-server.ts` (NEW)
- `atlas/src/lib/whatsapp-split.ts` (NEW)
- `atlas/src/lib/twilio.ts` (extend — `sendWhatsAppReplyAutoSplit`)
- `atlas/src/server.ts` (extend — wire slash detection in `[whatsapp-inbound]`, replace `sendWhatsAppReply` calls with auto-split version where bodies may exceed limit)
- `atlas/src/cron/conductor.ts` (extend — same wrap on outgoing pings)

## Success criteria

- `npm run build` clean
- Send WhatsApp text "/status" to Atlas number → reply within ~5s with formatted snapshot.
- Send WhatsApp text "queue" (no slash, no leading spaces) → same `/queue` reply.
- Send WhatsApp voice note saying "slash status" → STT transcribes, slash dispatched, reply.
- Send WhatsApp text "explain what's blocking the build right now in detail" → Atlas replies with a long answer. Reply is split into parts, each <1600 chars, never breaks mid-sentence, suffixed `(part 1/3)` … `(part 3/3)`.
- Send `/help` → reply lists all 6 supported slash commands.
- Slash command on a budget-exceeded day → reply "Budget gate hit, command skipped" instead of running.

## Risks + mitigations

- **Risk:** Sentence regex misclassifies abbreviations (e.g., "Mr. Smith"). **Mitigation:** Acceptable for Atlas's domain (no proper-noun abbrevs in build messages); document the limitation.
- **Risk:** 250ms delay between parts causes timeouts on the Twilio webhook. **Mitigation:** Send replies asynchronously (don't block the webhook 200 response).
- **Risk:** Slash command dispatched when user actually wanted to discuss "status of build" conversationally. **Mitigation:** Plain-word recognition only triggers when the message is JUST that word (or `slash X` / `atlas X` with no other content). Anything longer falls through to chat.

## NEVER list

- Never split mid-word — fail-safe to no-split if the splitter can't find a clean boundary.
- Never run a slash command that requires an unauthenticated tool — every dispatch carries the principal.
- Never log voice note transcripts containing OTP codes (filter at parse time).
- Never expose the `/help` listing to a `viewer` role member — they get a subset (read-only commands only).
