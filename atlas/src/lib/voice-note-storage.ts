// Supabase Storage helper for outbound Atlas voice notes.
// Uploads MP3 audio to the `atlas-voice-out` bucket and returns a signed URL
// (7-day expiry) that Twilio fetches when sending the WhatsApp media message.
//
// We deliberately avoid public-read URLs to prevent any user voice reply from
// being indexable; signed URLs scope access to the issued window only.
// Twilio fetches the URL within seconds of the API call, so a 7-day window is
// generous but bounded.

import { getSupabaseClient } from './supabase'

export const VOICE_OUT_BUCKET = 'atlas-voice-out'
// Hard cap: Twilio rejects WhatsApp media > 16 MB. ElevenLabs Turbo v2 at
// 44.1 kHz mono ≈ 16 kB/s, so 1500 chars ≈ 90 s ≈ 1.4 MB. The cap defends
// against runaway TTS payloads.
export const VOICE_OUT_MAX_BYTES = 2 * 1024 * 1024
// Signed URL expiry — Twilio fetches immediately, but we keep a margin so
// Storage's auto-cleanup window (7 d) is the only authoritative deletion path.
export const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60

export interface UploadVoiceNoteParams {
  audio: Buffer
  threadId: string
  messageId: string
}

export interface UploadVoiceNoteResult {
  path: string
  signedUrl: string
  bytes: number
}

export async function uploadVoiceNote(params: UploadVoiceNoteParams): Promise<UploadVoiceNoteResult> {
  const { audio, threadId, messageId } = params
  if (audio.length === 0) throw new Error('uploadVoiceNote: empty buffer')
  if (audio.length > VOICE_OUT_MAX_BYTES) {
    throw new Error(`uploadVoiceNote: audio exceeds ${VOICE_OUT_MAX_BYTES} bytes (${audio.length})`)
  }

  const sb = getSupabaseClient()
  if (!sb) throw new Error('uploadVoiceNote: Supabase not configured')

  const safeThread = threadId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
  const safeMsg = messageId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || `${Date.now()}`
  const path = `${safeThread}/${safeMsg}.mp3`

  const { error: uploadErr } = await sb.storage
    .from(VOICE_OUT_BUCKET)
    .upload(path, audio, {
      contentType: 'audio/mpeg',
      cacheControl: '3600',
      upsert: true,
    })
  if (uploadErr) throw new Error(`uploadVoiceNote: upload failed: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await sb.storage
    .from(VOICE_OUT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) {
    throw new Error(`uploadVoiceNote: signed URL failed: ${signErr?.message ?? 'no url'}`)
  }

  return { path, signedUrl: signed.signedUrl, bytes: audio.length }
}

// Cleanup helper — removes any voice-out blob older than the retention window.
// Called by the nightly cron in atlas/src/cron.
export async function cleanupOldVoiceNotes(retentionDays = 7): Promise<{ removed: number }> {
  const sb = getSupabaseClient()
  if (!sb) return { removed: 0 }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const { data: top } = await sb.storage.from(VOICE_OUT_BUCKET).list('', { limit: 1000 })
  if (!top) return { removed: 0 }

  const toDelete: string[] = []
  for (const entry of top) {
    // Folders surface as entries with no `id` and represent a thread directory.
    if (!entry.id) {
      const { data: inner } = await sb.storage.from(VOICE_OUT_BUCKET).list(entry.name, { limit: 1000 })
      for (const f of inner ?? []) {
        const ts = f.created_at ? Date.parse(f.created_at) : NaN
        if (Number.isFinite(ts) && ts < cutoff) toDelete.push(`${entry.name}/${f.name}`)
      }
      continue
    }
    const ts = entry.created_at ? Date.parse(entry.created_at) : NaN
    if (Number.isFinite(ts) && ts < cutoff) toDelete.push(entry.name)
  }
  if (toDelete.length === 0) return { removed: 0 }
  await sb.storage.from(VOICE_OUT_BUCKET).remove(toDelete)
  return { removed: toDelete.length }
}
