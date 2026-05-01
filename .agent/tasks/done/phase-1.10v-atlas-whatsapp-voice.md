# Task: Phase 1.10v — Atlas WhatsApp voice notes (in + out)

**Master plan reference:** Atlas master spec §11; user directive 2026-05-01: "voice messages will work perfect on WhatsApp."
**Context:** Atlas already does WhatsApp inbound text (1.10f). This spec extends to voice notes both ways: when Muzammil sends a voice note from his phone, Atlas downloads the audio, transcribes via Whisper, processes as a normal chat turn, and replies with BOTH a text message AND an ElevenLabs-generated voice note. No Twilio Voice API needed — standard WhatsApp media messages.
**Estimated effort:** ~65 min Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

1. Extend `/whatsapp/inbound` webhook handler in `atlas/src/server.ts` to detect voice-note messages (Twilio sends `MediaUrl0` + `MediaContentType0=audio/ogg`).
2. Download the audio from Twilio's media URL (auth required: same Account SID + Auth Token).
3. Send to Whisper for transcription (reuse `whisper.ts` from 1.10t).
4. Insert transcript into `atlas_conversations` with `role='user'`, `channel='whatsapp'`, `metadata={voice_note: true, audio_url: ...}`.
5. Process through existing chat handler — full Atlas reply with tools.
6. Send reply back as TWO WhatsApp messages: (a) text body, (b) voice note via ElevenLabs.
7. Voice note sending: Twilio supports outbound media via `MediaUrl` parameter — generate the audio, upload to Supabase Storage `atlas-voice-out/`, get a public URL, send.

## Architecture

```
atlas/
├── src/
│   ├── lib/
│   │   ├── twilio.ts                   (extend — sendWhatsAppVoiceNote, downloadTwilioMedia)
│   │   ├── elevenlabs.ts               (extend — generateVoiceNote returns Buffer)
│   │   ├── whisper.ts                  (existing from 1.10t)
│   │   └── voice-note-storage.ts       (NEW — upload to Supabase Storage)
│   └── server.ts                       (extend `/whatsapp/inbound` for voice)
```

## Twilio inbound voice handling

Twilio webhook payload for a voice note includes:

```
From=whatsapp:+971562556592
To=whatsapp:+19862022080
Body=                              ← empty for voice-only
NumMedia=1
MediaUrl0=https://api.twilio.com/2010-04-01/Accounts/AC.../Messages/MM.../Media/ME...
MediaContentType0=audio/ogg
```

In server.ts:

```typescript
const numMedia = parseInt(req.body.NumMedia ?? '0', 10)
const mediaUrl = req.body.MediaUrl0 as string | undefined
const mediaType = req.body.MediaContentType0 as string | undefined

if (numMedia > 0 && mediaType?.startsWith('audio/')) {
  const audio = await downloadTwilioMedia(mediaUrl!)
  const { text: transcript } = await transcribe(audio, mediaType)
  // Now handle as if user sent transcript as a text message
  await handleWhatsAppText({ from, to, body: transcript, isVoiceNote: true, audioUrl: mediaUrl })
} else {
  await handleWhatsAppText({ from, to, body: req.body.Body, isVoiceNote: false })
}
```

`downloadTwilioMedia` uses Twilio's basic auth (`TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`) to fetch the binary.

## Outbound voice note

After Atlas's text reply is generated:

```typescript
async function sendAtlasReply(toWhatsApp: string, replyText: string) {
  // 1. Send text first
  await whatsappSend(toWhatsApp.replace('whatsapp:', ''), replyText)

  // 2. Generate voice note (only if user enabled — see config)
  if (await isVoiceReplyEnabled(toWhatsApp)) {
    const audioBuffer = await generateVoiceNote(replyText.slice(0, 1500)) // truncate long replies
    const publicUrl = await uploadVoiceNote(audioBuffer)  // Supabase Storage
    await whatsappSendMedia(toWhatsApp.replace('whatsapp:', ''), publicUrl)
  }
}
```

`whatsappSendMedia` is a new helper extending `whatsappSend` with `MediaUrl` parameter.

## Voice-reply opt-in

Per-user config row in `atlas_user_prefs` (new lightweight table or atlas_config):

```sql
CREATE TABLE IF NOT EXISTS public.atlas_user_prefs (
  user_phone text PRIMARY KEY,
  voice_replies_enabled boolean NOT NULL DEFAULT true,
  preferred_voice_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Default `true` for Muzammil (+971562556592). Auto-disable if monthly ElevenLabs spend > $80 (shared cap with 1.10s).

## Storage

Atlas writes voice notes to Supabase Storage bucket `atlas-voice-out/` with path `<thread_id>/<message_id>.mp3`. Public-read bucket (Twilio fetches via URL). Auto-delete via Supabase scheduled job after 7 days (file size cleanup).

## Files

- `atlas/src/lib/twilio.ts` (extend — `downloadTwilioMedia`, `whatsappSendMedia`)
- `atlas/src/lib/elevenlabs.ts` (extend — `generateVoiceNote(text): Promise<Buffer>`)
- `atlas/src/lib/voice-note-storage.ts` (NEW — Supabase Storage upload)
- `atlas/src/server.ts` (extend — `/whatsapp/inbound` voice branch + `sendAtlasReply` voice path)
- `supabase/migrations/20260501020000_atlas_voice_prefs.sql` (NEW)
- `supabase/migrations/20260501020001_atlas_voice_storage.sql` (NEW — create `atlas-voice-out` bucket via SQL or document the manual creation step)

## Success criteria

- Send a voice note from +971562556592 to +19862022080 → Atlas replies with text + voice note within ≤ 8 s
- Reply audio plays in WhatsApp on phone (verify on iOS + Android if possible)
- `atlas_conversations` shows two rows per turn: user (with `metadata.voice_note=true`) + atlas (with `metadata.has_voice_reply=true`)
- Disable voice reply: send `disable voice` → next reply is text-only; re-enable with `enable voice`
- Long reply (> 1500 chars): voice note is truncated audio + text shows "(voice continues in chat)"
- `atlas_cost_log` shows Whisper (in) + Anthropic + ElevenLabs (out) per voice turn
- Storage cleanup: rows older than 7 d are deleted (verify scheduled job runs nightly)
- Twilio webhook signature validation passes (uses `X-Twilio-Signature` header — implement if not yet)

## Risks + mitigations

- **Risk:** Twilio media URL expires (24 h). **Mitigation:** download immediately on webhook; never store the URL for later use.
- **Risk:** Voice note > 16 MB hits Twilio limit. **Mitigation:** ElevenLabs Turbo at 32 kHz mono ~24 kB/s; 1500 chars ≈ 90 s ≈ 2 MB. Hard truncate at 2 MB.
- **Risk:** Public storage bucket leaks user voice replies. **Mitigation:** signed URL with 7-day expiry instead of fully-public; or rotate bucket → CloudFront with signed-cookie if scope grows.
- **Risk:** Twilio signature spoofing. **Mitigation:** validate `X-Twilio-Signature` against expected hash; reject unsigned webhooks.

## NEVER list

- Never reply with voice if user opted out.
- Never store user-sent voice notes server-side beyond the duration of transcription.
- Never expose `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / `TWILIO_AUTH_TOKEN` in any frontend or public storage.
- Never auto-call the user (Twilio Voice API is OUT of scope per user 2026-05-01).
