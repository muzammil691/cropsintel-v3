---
phase: 1.10ad
title: Chat attachments — paperclip button for image and PDF upload
status: planned
gate: in-progress count <= 5 AND no spec stuck >2h
estimated_builder_minutes: 90
estimated_cost_usd: 2
master_plan_section: 11.3
---

# Phase 1.10ad — Chat attachments

## Why this exists

Today's chat is text + voice only. The user wants to attach images (screenshots, charts, photos of contracts) and PDFs (position reports, contracts) directly to a chat message so Atlas can read them. Atlas already has Claude vision capability — this spec wires the upload pipeline so files reach it.

## Foundation-first check

- ✅ Atlas chat backend supports multimodal input (Claude vision is built into the model).
- ✅ Supabase Storage exists, `voice-notes` bucket already configured (we have storage policies as a reference template).
- ✅ `atlas/src/lib/storage.ts` exists.
- ✅ ChatPanel.tsx is the consumer.

We're adding a new Storage bucket + UI control + edge function.

## What ships

### 1. Supabase Storage bucket

New bucket `chat-attachments`. RLS policies:

- Authenticated users: insert allowed only if `path` starts with `<their_user_id>/`.
- Authenticated users: select allowed only on objects they own.
- Service role: full access.

Migration: `supabase/migrations/<ts>_chat_attachments_bucket.sql`.

### 2. Paperclip button in ChatPanel.tsx

Add a button left of the mic button. Icon: paperclip from `lucide-react`. On click:

- Open native file picker. `accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"`.
- `multiple` enabled — user can pick up to 5 files at once.
- After selection, files appear as **pending attachments** above the message input. Each pending attachment shows: filename, size, a thumbnail (for images) or a PDF icon, and an "x" to remove.

### 3. Upload pipeline

When the user hits send (with text + attachments, or attachments-only):

1. Client uploads each file to `chat-attachments/<user_id>/<message_id>/<filename>`.
2. MIME-validate client-side; reject anything not in the allowed list with a toast.
3. Size-cap client-side: 10MB per image, 25MB per PDF, 50MB total per message. Reject with toast if exceeded.
4. Once uploads succeed, call the chat send endpoint with the message text + an `attachments` array containing `{path, mime, size, filename}` per file.
5. The chat send endpoint creates the message in the conversation with `attachment_refs` populated.
6. UI replaces pending attachments with sent attachments in the message bubble.

### 4. Render attachments in ChatTimeline.tsx

Each message bubble renders attachments below the text:

- Images: thumbnail (max 240×240, lightbox on click).
- PDFs: PDF icon + filename + size + "open" link (opens signed URL in new tab).

Use Supabase signed URLs (TTL 1h) so the rendered image isn't a public link.

### 5. Atlas reads attachments

When the chat backend processes a user message with attachments:

- For each attachment, generate a signed URL (TTL 5min) and pass to Claude as a `image` or `document` content block per the Anthropic API multimodal spec.
- Atlas can now answer questions like "what does this position report show?" or "extract the table from this image."

The model already supports this; we're just plumbing it through.

### 6. Edge function: `chat-attachment-upload-url`

To avoid exposing service-role keys client-side, add an edge function that:

- Takes `{filename, mime, size}` from the client.
- Validates server-side (re-check MIME, size, extension).
- Returns a signed upload URL with TTL 60s.

Client uploads via the signed URL, not directly with anon key.

### 7. Vision audit log

Each attachment Atlas reads → log to `agent_audit_log` with `kind='vision_read'`, `attachment_path`, `tokens_consumed`. This lets the cost-gate cap vision usage.

## Acceptance criteria

- Paperclip button exists left of mic button.
- File picker accepts JPEG, PNG, HEIC, WEBP, PDF only. Tries to upload .docx → toast "unsupported file type."
- 5 files at once works. 6th rejected with toast "max 5 files per message."
- 11MB image rejected with "image too large (max 10MB)."
- Sent message bubble shows image thumbnails clickable to lightbox; PDFs show with open link.
- Atlas can answer about an attached image ("describe this chart") or PDF ("extract the totals from page 2").
- Signed URLs expire correctly — refreshing the page after 1h forces re-fetch.
- `npm run build` passes.
- `npx playwright test e2e/chat-attachments.spec.ts` green.

## Information walls

Any authenticated tier can attach. Storage RLS guarantees user A cannot read user B's attachments. Admin tier can read all (for support).

## Files touched

- `src/components/atlas/ChatPanel.tsx` (add paperclip)
- `src/components/atlas/chat/PendingAttachmentTray.tsx` (NEW)
- `src/components/atlas/chat/AttachmentRender.tsx` (NEW — thumbnail / PDF icon / lightbox)
- `src/lib/atlas/upload-attachment.ts` (NEW — client uploader)
- `atlas/src/server.ts` (extend send endpoint to accept attachments)
- `atlas/src/lib/chat-with-attachments.ts` (NEW — Claude multimodal call)
- `supabase/migrations/<ts>_chat_attachments_bucket.sql` (NEW)
- `supabase/functions/chat-attachment-upload-url/index.ts` (NEW)
- `e2e/chat-attachments.spec.ts` (NEW)

## Out of scope

- Audio attachments (covered by voice messages in 1.10ac).
- Video attachments.
- Office docs (.docx, .xlsx, .pptx) — these need conversion pipeline, separate spec if needed.
- OCR on images (Claude vision handles text-in-image natively for most cases).
- Attachment search across conversation history.
