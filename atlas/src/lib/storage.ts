// Phase 1.10am: Supabase Storage helpers for chat attachments + persisted
// audio (user mic recordings, Atlas TTS replies).
//
// Bucket: `atlas-chat-attachments` (created by 20260501160000 migration).
// All access is service-role only — clients receive 6-hour signed URLs.
//
// Layout:
//   <thread_id>/<message_id>/<file_id>__<safe_filename>
//   <thread_id>/audio/user/<message_id>.<ext>
//   <thread_id>/audio/atlas/<message_id>.<ext>

import { randomUUID } from 'crypto'
import { getSupabaseClient } from './supabase'

export const CHAT_ATTACHMENTS_BUCKET = 'atlas-chat-attachments'

// 25 MB per file — also enforced at the bucket level by the migration.
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

// Per-message caps to bound vision API costs.
export const ATTACHMENTS_PER_MESSAGE_MAX = 10
export const IMAGES_PER_MESSAGE_MAX = 4

// Signed URL expiry. Six hours is enough for the user to scroll back through
// chat history without forcing a refetch, but bounded enough that scraped URLs
// die quickly.
export const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60

export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'text/',
  'audio/',
] as const

export const ALLOWED_MIME_EXACT = new Set<string>([
  'video/mp4',
  'video/webm',
  'application/pdf',
  'application/json',
  'application/zip',
])

export function isMimeAllowed(mime: string): boolean {
  const lc = mime.toLowerCase().split(';')[0].trim()
  if (!lc) return false
  if (ALLOWED_MIME_EXACT.has(lc)) return true
  return ALLOWED_MIME_PREFIXES.some(p => lc.startsWith(p))
}

export interface UploadAttachmentParams {
  data: Buffer
  filename: string
  mimeType: string
  threadId: string
  messageId?: string
  // For audio recordings, lets callers pin the path under audio/user or audio/atlas.
  subPath?: 'audio/user' | 'audio/atlas' | null
}

export interface AttachmentRecord {
  id: string
  name: string
  size: number
  mime: string
  storage_path: string
  signed_url: string
  signed_url_expires_at: string
}

function safeSegment(s: string, max = 64): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, max) || 'unknown'
}

// Upload a single buffer to the chat-attachments bucket and return a fully
// populated AttachmentRecord (including a freshly-issued signed URL).
export async function uploadAttachment(params: UploadAttachmentParams): Promise<AttachmentRecord> {
  const { data, filename, mimeType, threadId, messageId, subPath } = params
  if (data.length === 0) throw new Error('uploadAttachment: empty buffer')
  if (data.length > ATTACHMENT_MAX_BYTES) {
    throw new Error(`uploadAttachment: exceeds ${ATTACHMENT_MAX_BYTES} bytes (${data.length})`)
  }
  if (!isMimeAllowed(mimeType)) {
    throw new Error(`uploadAttachment: mime ${mimeType} not allowed`)
  }

  const sb = getSupabaseClient()
  if (!sb) throw new Error('uploadAttachment: Supabase not configured')

  const safeThread = safeSegment(threadId, 64)
  const safeMsg = messageId ? safeSegment(messageId, 64) : `${Date.now()}`
  const safeName = safeSegment(filename || 'file', 80)
  const fileId = randomUUID()

  const path = subPath
    ? `${safeThread}/${subPath}/${safeMsg}__${safeName}`
    : `${safeThread}/${safeMsg}/${fileId}__${safeName}`

  const { error: uploadErr } = await sb.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(path, data, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: true,
    })
  if (uploadErr) throw new Error(`uploadAttachment: upload failed: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await sb.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) {
    throw new Error(`uploadAttachment: signed URL failed: ${signErr?.message ?? 'no url'}`)
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()

  return {
    id: fileId,
    name: filename,
    size: data.length,
    mime: mimeType,
    storage_path: path,
    signed_url: signed.signedUrl,
    signed_url_expires_at: expiresAt,
  }
}

// Re-issue a signed URL for an existing storage path (used to refresh URLs
// stored in atlas_conversations.metadata.attachments after they expire).
export async function refreshSignedUrl(storagePath: string): Promise<{ signed_url: string; expires_at: string } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data: signed, error } = await sb.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error || !signed?.signedUrl) return null
  return {
    signed_url: signed.signedUrl,
    expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  }
}

// Fetch the bytes for an image attachment (used to feed it into Claude's
// vision input as base64). Caller is responsible for size + budget limits.
export async function downloadAttachment(storagePath: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data, error } = await sb.storage.from(CHAT_ATTACHMENTS_BUCKET).download(storagePath)
  if (error || !data) return null
  const ab = await data.arrayBuffer()
  return { buffer: Buffer.from(ab), mime: data.type || 'application/octet-stream' }
}
