---
phase: 1.10ac
title: Chat conversation upgrade — voice mode, voice messages, tool-call transparency
status: planned
gate: in-progress count <= 5 AND no spec stuck >2h
estimated_builder_minutes: 180
estimated_cost_usd: 6
master_plan_section: 11.3
---

# Phase 1.10ac — Chat conversation upgrade

## Why this exists

Three problems with today's chat:

1. **Voice button doesn't do real conversation.** It records and dictates. The user wants real-time, ElevenLabs-voiced, back-and-forth conversation like a phone call with Atlas.
2. **Voice message recording doesn't send.** User holds the mic button, recording happens, but the message never lands in the chat. The endpoint or the UI handler is broken.
3. **Tool calls show as `tool_call → pending → null`.** When Atlas is calling tools (which is most of what it does), the user sees opaque "pending" rows with no information about which tool, why, or what it returned. Expanding shows null. The user wants transparency.

These three live in the same chat component (`ChatPanel.tsx` + `ChatTimeline.tsx`), so they ship together.

## Foundation-first check

- ✅ `atlas/src/lib/elevenlabs.ts` exists (TTS already integrated for outgoing voice).
- ✅ `atlas/src/lib/whisper.ts` exists (Whisper STT already integrated for transcription).
- ✅ `atlas/src/lib/voice-note-storage.ts` exists.
- ✅ ChatTimeline + ChatPanel components exist.
- ✅ Tool dispatch records exist in `agent_audit_log` (the data is there; the UI doesn't show it).

We're connecting existing pieces, not building from scratch.

## What ships

### Part A — Voice conversation mode

#### A.1 New "talk" button behavior

Today's mic button in `ChatPanel.tsx` does push-to-talk single-message recording. Change to two-mode:

- **Tap** = single voice message (existing behavior, fix in Part B).
- **Hold** = enter conversation mode (NEW).

In conversation mode:

- Open a full-screen modal `<VoiceConversationModal>` (or a docked bottom-sheet on mobile).
- Connect to ElevenLabs Conversational AI WebSocket via the existing `elevenlabs-conversation-token` edge function (already in repo from V1 — port if not yet in V3, else use).
- Stream user audio → ElevenLabs → text → Atlas chat API → text response → ElevenLabs TTS → speaker. Both directions duplex.
- Show a live waveform animation while Atlas is speaking, a different waveform while user is speaking, and a still mic icon when neither is active.
- Show transcribed text below the waveform as it streams (small font, muted).
- "End call" button bottom-center, big and red.

#### A.2 Conversation persistence

When the user ends the call:

- Save the full transcript to the chat as one block, with role markers (`user voice → ...`, `atlas voice → ...`).
- Each call counts as one chat session for cost/audit purposes.
- Cost is logged in `cost_log` with `kind='voice_conversation'`.

#### A.3 Voice settings

Add a small gear icon in the conversation modal: choose voice (default to existing Atlas voice ID from V1's `zyraPrompts.ts` if present), volume, mic device (browser-default).

### Part B — Voice message fix

#### B.1 Diagnose first, then fix

The voice message button records but doesn't send. Builder must:

1. Open the browser console while reproducing the bug locally.
2. Identify which step fails: recording (Mediarecorder API), upload (Supabase Storage), transcription (Whisper edge function), or message append (chat API).
3. Fix that step. Most likely the upload-to-Storage path is broken because Storage RLS isn't configured for this bucket — verify `voice-notes` bucket policy.

#### B.2 Verify the round trip

After fix:

- User holds mic → records → releases.
- Audio uploads to `voice-notes` Supabase bucket.
- Transcription via `whisper-stt` edge function returns text.
- Both audio file (playable in chat) and transcribed text appear in chat as one message bubble.
- Atlas responds normally.

### Part C — Tool-call transparency

#### C.1 ChatTimeline.tsx — replace `pending → null` rendering

Today's `tool_call` row shows `pending` and expanding shows null. Replace with three-stage row:

- **In flight:** `🔧 Calling builder.list_queue...` with subtle pulsing animation. Show start timestamp.
- **Complete (success):** `✅ builder.list_queue → 3 queued, 16 in-progress (124ms)`. Bold the tool name. Show duration.
- **Complete (error):** `❌ builder.force_cancel → spec not found in queued/in-progress (after 4 retries)`. Show the error message verbatim.

#### C.2 Expand → show actual logs

Click the row → expands inline showing:

- Full tool input JSON (pretty-printed).
- Full tool output JSON (pretty-printed, scrollable max-height).
- Duration, cost (if applicable), retry count.
- Link to the underlying `agent_audit_log` row (`/audit?id=<row_id>` — admin only).

#### C.3 Source the data

The data already exists in `agent_audit_log` (every tool dispatch is logged). Build a small SSE endpoint `GET /atlas/chat/<conversation_id>/tool-events` that streams new tool calls + completions for the active conversation. ChatTimeline subscribes to it and updates rows in real-time.

#### C.4 Friendly tool names

Tool names like `builder_list_queue` should display as `Builder · List queue`. Add a small map in `src/lib/atlas/tool-display-names.ts`. Cover the 11 tools in `atlas/src/lib/tools.ts`. Unknown tools fall back to the raw name with title-cased segments.

## Acceptance criteria

**Voice conversation:**
- Holding the mic button opens conversation modal within 300ms.
- Speaking to Atlas → Atlas responds within 2s with voice + transcribed text.
- Ending the call saves transcript to chat correctly.
- Cost logged in `cost_log`.

**Voice message:**
- Tap mic, record 3-second message, release → message appears in chat with playable audio + transcribed text within 5s.
- Atlas responds normally as if the user typed the transcribed text.

**Tool-call display:**
- Every tool call Atlas makes in a conversation appears as a row with friendly name + status.
- Expanding any row shows real input + output JSON.
- A row that fails shows the actual error verbatim, not "null".

**Build / tests:**
- `npm run build` passes.
- `npx playwright test e2e/chat-voice.spec.ts e2e/chat-tool-display.spec.ts` green.

## Information walls

Voice conversation + voice messages: any authenticated tier (registered/verified/admin).
Tool-call expansion full detail: admin-tier only (the JSON contents may include internal IDs, costs, server names — protect this). Non-admin tiers see only the friendly summary line.

## Files touched

- `src/components/atlas/ChatPanel.tsx` (mic button two-mode behavior)
- `src/components/atlas/ChatTimeline.tsx` (tool-call rendering)
- `src/components/atlas/voice/VoiceConversationModal.tsx` (NEW)
- `src/components/atlas/voice/WaveformAnimation.tsx` (NEW)
- `src/components/atlas/chat/ToolCallRow.tsx` (NEW — replaces inline rendering)
- `src/lib/atlas/tool-display-names.ts` (NEW)
- `atlas/src/server.ts` (new SSE route)
- `atlas/src/lib/conversation-stream.ts` (NEW — SSE source)
- `supabase/functions/elevenlabs-conversation-token/index.ts` (port from V1 if missing)
- `e2e/chat-voice.spec.ts` (NEW)
- `e2e/chat-tool-display.spec.ts` (NEW)

## Out of scope

- Multi-language voice (English-only for v1).
- Custom voice training / cloning.
- Real-time interruptions (user can interrupt by speaking, but no fancy mid-sentence preemption).
- Group conversations (1:1 user ↔ Atlas only).
- Background noise suppression beyond browser default.
