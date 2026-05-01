---
priority: 2
depends-on: [phase-1.10aj-atlas-auth-and-live-sync]
---

# Task: Phase 1.10am — Atlas v2 rich chat (uploads, clipboard, both-ends recording, hardened live mode)

**Master plan reference:** §1.10s/t/u voice + live mode; §1.10v WhatsApp voice.

**Context:** Chat works (1.10k) and voice STT/TTS works (1.10s/t), but the user can't upload files/images/videos, clipboard shortcuts (paste image, paste table, etc.) aren't wired, and the live conversation mode (1.10u) drops the connection mid-conversation. This spec hardens chat into a real workspace.

**Estimated effort:** ~70 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

### Part A — File / image / video uploads

**Frontend `src/components/atlas/ComposeBar.tsx` (extend):**
- Existing send button + mic button + text input
- Add: paperclip "attach" button + drag-drop zone overlay (shows when user drags any file over the chat pane)
- On file selected:
  - Image (`image/*`) → preview thumbnail above input
  - Video (`video/mp4`, `video/webm`) → preview with play button
  - PDF/text/markdown → file icon + filename
  - Other → reject with toast "unsupported type" (allowlist: image/*, video/mp4, application/pdf, text/*, application/json, application/zip up to 25MB each)

**Storage:** Supabase Storage bucket `atlas_chat_attachments` (NEW migration to create + service-role-only policy).

**Server route `POST /atlas/chat/upload`:**
- Multipart form (use `busboy` already in deps if available, else `formidable`)
- For each file: virus-check via `clamav` if available else size+type guard, upload to Supabase Storage, return `{ id, name, size, mime, storage_path, public_url }`
- Returned IDs get attached to the next chat message via `attachments` field on `atlas_conversations`.

**Server route `POST /atlas/chat`:** extend body to accept `attachments: AttachmentRef[]`. On send, the attachments are stored in the row's `metadata.attachments` and rendered in the message bubble.

**Frontend `MessageBubble.tsx` (extend):**
- Render image attachments as `<img>` thumbnails (click to open lightbox)
- Render videos as `<video controls>`
- Render PDFs as a card with file icon + "Open in new tab" link
- Render text/json/md inline as a `<details>` collapsible code block

**Pass attachments to Claude:** when the chat handler builds the messages array for Claude, image attachments are sent as Claude vision input (base64-encoded via the storage URL → fetch → buffer). Text/JSON attachments get inlined into the message as a code block. Videos/PDFs are referenced by URL only (Claude can't process them but knows they're there).

### Part B — Clipboard shortcuts + paste handling

**Frontend `ComposeBar.tsx` (extend):**
- Listen for `paste` event:
  - If clipboard has an image → upload via `POST /atlas/chat/upload` and attach
  - If clipboard has a file → same
  - If clipboard has rich text (HTML) → preserve formatting in markdown (use `turndown` lib to convert)
  - If clipboard has a Slack/GitHub/Linear URL → fetch URL via `GET /atlas/chat/preview-url` (server-side scrape) and inline a card preview
  - If clipboard has a Claude Code transcript (markdown with `>` quotes) → paste as quoted block
- Keyboard shortcuts (using `react-hotkeys-hook`):
  - `Cmd+K` → focus search across chat history
  - `Cmd+/` → open shortcut help dialog
  - `Cmd+Enter` → send message
  - `Shift+Enter` → newline (already works)
  - `Cmd+;` → toggle voice mode
  - `Cmd+Shift+V` → paste as plain text (strip rich formatting)
  - `Cmd+Shift+C` → copy last Atlas response as markdown
  - `Esc` → cancel ongoing tool call / streaming response

### Part C — Both-ends transcription / recording

**Today:** STT records the user's mic; TTS plays Atlas's voice; neither persists the audio.

**Add:**
- `atlas/src/server.ts` — when STT runs, save the user's audio blob to `atlas_chat_attachments` and link in the user message metadata (`metadata.audio.user`)
- `atlas/src/server.ts` — when TTS generates Atlas's voice, save the same way (`metadata.audio.atlas`)
- `MessageBubble.tsx` — render a small `▶ Play original` button below any message with audio metadata; uses an existing `<audio>` element.
- New table `atlas_voice_sessions` to log live-mode WebSocket sessions with start/end timestamps + total user speech seconds + total atlas speech seconds.

**Privacy clause:** Add a one-time consent banner on first voice-mode use: "Voice recordings are stored in your private Supabase bucket and used only for replay/transcript. You can delete recordings any time via Settings."

### Part D — Live conversation hardening

**Current bug (per user):** "live conversation should be fixed and natural — it breaks."

**Root causes (from logs review):**
1. WebSocket drops on Railway after ~60s of inactivity (Railway proxies idle out)
2. Atlas's TTS streaming chunks pause when LLM thinks → user hears a 3s silent gap, assumes call dropped
3. No explicit "call ended" signal; client just sees connection close

**Fixes:**

1. **Heartbeat:** Server sends a `{type: 'heartbeat'}` frame every 20s during silent periods so Railway proxy doesn't idle-out. Client responds with `{type: 'heartbeat-ack'}`.
2. **Filler audio during LLM think time:** When server gets to "Atlas is generating response" state, immediately stream a short ElevenLabs filler ("uh-huh, give me a moment...") so user hears continuous audio. Library of 5 short fillers, randomly chosen.
3. **Reconnection on drop:** Client detects disconnect → tries 3 reconnects with exponential backoff (1s, 3s, 9s). If all fail, show "Reconnecting..." UI then "Call ended — reason: <code>" if exhausted.
4. **End-of-turn signaling:** Server sends explicit `{type: 'turn-end', reason: 'user-finished' | 'atlas-finished' | 'silence-timeout'}` so the UI knows when each speaker is done.
5. **Visualised state machine:** Frontend `LiveConversationPanel.tsx` shows a clear state pill: 🎤 Listening / 🤔 Atlas thinking / 🔊 Atlas speaking / 🔇 Idle / 🔄 Reconnecting / ❌ Disconnected. User always knows what's happening.

### Part E — Same-thread persistence (depends on 1.10aj)

Once 1.10aj ships and `thread_id = 'web-default'` is canonical, this spec ensures:
- All file uploads attach to that thread
- Live conversation transcripts append as messages to that thread
- WhatsApp inbound voice notes also write to that thread
- Refreshing any device shows the unified history (file uploads, voice clips, text — all together)

## Files

- `atlas/src/server.ts` (extend — `/atlas/chat/upload`, `/atlas/chat/preview-url`, WS heartbeat, audio persistence)
- `atlas/src/lib/storage.ts` (NEW — Supabase Storage helpers)
- `src/components/atlas/ComposeBar.tsx` (extend — attach button, paste handler, hotkeys)
- `src/components/atlas/MessageBubble.tsx` (extend — render attachments, audio playback)
- `src/components/atlas/LiveConversationPanel.tsx` (extend — state pill, reconnect logic, filler audio)
- `src/components/atlas/AttachmentPreview.tsx` (NEW)
- `src/components/atlas/ShortcutHelpDialog.tsx` (NEW — Cmd+/ opens this)
- `src/lib/turndown.ts` (NEW — HTML→Markdown helper for paste)
- `supabase/migrations/20260501160000_atlas_chat_attachments.sql` (NEW — Storage bucket + sessions table)
- `package.json` (add `react-hotkeys-hook`, `turndown`, `formidable` if not present)

## Success criteria

- Drag a 5MB PNG into the chat pane → uploads in <3s, renders as thumbnail, Atlas's next response acknowledges the image content (vision call worked)
- Paste an image from screenshot → same as drag
- `Cmd+K` opens search dialog and filters messages by typed text
- Live conversation mode runs for 5 min uninterrupted (heartbeat keeps WS alive)
- Disconnect mid-conversation → UI shows "Reconnecting (1/3)" and recovers within 10s
- Voice mode "Atlas thinking" → user hears a filler within 800ms (no silent gap)
- After voice exchange ends, user message bubble has `▶ Play your audio`, Atlas bubble has `▶ Play Atlas`
- Attachments persist across refresh (already covered by 1.10aj sync)
- Bundle size delta < 200KB after additions (turndown is lightweight; reactflow already gated by route)

## Risks + mitigations

- **Risk:** Vision API costs explode if user uploads many images. **Mitigation:** Hard cap: 4 images per message; reject with toast if more.
- **Risk:** Live mode filler audio annoys user ("Atlas keeps saying uh-huh"). **Mitigation:** Filler triggers ONLY after >2s of silent thinking; toggleable in voice settings.
- **Risk:** Storage bucket fills up over months. **Mitigation:** Add a cleanup cron in 1.10aj+1 that deletes attachments older than 90 days unless pinned.

## NEVER list

- Never upload a file without size + type validation server-side (defense-in-depth even though client also checks).
- Never log clipboard contents — paste handler reads + uploads but does not record what was on the clipboard for telemetry.
- Never expose attachments via public URLs without RLS — Supabase Storage policy must require service-role read for now (until 1.10aj's multi-device auth lets per-phone signed URLs work).
