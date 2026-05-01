// Twilio WhatsApp helpers — outbound text/media + inbound media download +
// inbound webhook signature validation. The auth token MUST stay server-side;
// never expose it to the browser or any non-Atlas service.

import { createHmac } from 'crypto'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+12345622692'
// Twilio rejects outbound WhatsApp media payloads >16 MB; surface here for callers.
export const TWILIO_WHATSAPP_MAX_MEDIA_BYTES = 16 * 1024 * 1024
// Twilio rejects WhatsApp text bodies >1600 chars; we cap conservatively at 1500.
export const TWILIO_WHATSAPP_MAX_BODY_CHARS = 1500

function basicAuthHeader(): string {
  const token = `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
  return `Basic ${Buffer.from(token).toString('base64')}`
}

function ensureWhatsAppPrefix(num: string): string {
  return num.startsWith('whatsapp:') ? num : `whatsapp:${num}`
}

export async function sendWhatsAppReply(
  toNumber: string,
  body: string,
): Promise<{ sid: string } | { error: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { error: 'Twilio creds not configured; reply not sent' }
  }
  const truncated = body.length > TWILIO_WHATSAPP_MAX_BODY_CHARS
    ? body.slice(0, TWILIO_WHATSAPP_MAX_BODY_CHARS - 3) + '...'
    : body
  const params = new URLSearchParams({
    From: ensureWhatsAppPrefix(TWILIO_FROM_NUMBER),
    To: ensureWhatsAppPrefix(toNumber),
    Body: truncated,
  })
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )
  if (!res.ok) return { error: `Twilio API error: ${res.status} ${await res.text()}` }
  const data = (await res.json()) as { sid: string }
  return { sid: data.sid }
}

// Outbound WhatsApp media (used for voice-note replies). Twilio fetches the
// MediaUrl synchronously when the API call returns; the URL must be reachable
// from Twilio's edge for several seconds at minimum (signed URLs are fine).
export async function sendWhatsAppMedia(
  toNumber: string,
  mediaUrl: string,
  options: { body?: string } = {},
): Promise<{ sid: string } | { error: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { error: 'Twilio creds not configured; media not sent' }
  }
  const params = new URLSearchParams({
    From: ensureWhatsAppPrefix(TWILIO_FROM_NUMBER),
    To: ensureWhatsAppPrefix(toNumber),
    MediaUrl: mediaUrl,
  })
  if (options.body) params.set('Body', options.body.slice(0, TWILIO_WHATSAPP_MAX_BODY_CHARS))
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )
  if (!res.ok) return { error: `Twilio API error: ${res.status} ${await res.text()}` }
  const data = (await res.json()) as { sid: string }
  return { sid: data.sid }
}

export interface DownloadedMedia {
  buffer: Buffer
  contentType: string
}

// Twilio's media URLs require basic-auth with the same Account SID + Auth Token.
// They redirect (302) to a signed S3 URL that does NOT need auth, but Node's
// fetch follows redirects automatically and re-uses the Authorization header
// only if hostnames match, so we follow manually to avoid 400s from S3.
export async function downloadTwilioMedia(mediaUrl: string): Promise<DownloadedMedia> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio creds not configured; cannot download media')
  }

  // Step 1: hit Twilio with auth — expect 302 to S3.
  const first = await fetch(mediaUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: { Authorization: basicAuthHeader() },
  })

  let target: Response
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get('location')
    if (!location) throw new Error(`Twilio media redirect missing Location header (status=${first.status})`)
    // Step 2: fetch the redirected URL WITHOUT the Twilio auth header.
    target = await fetch(location, { method: 'GET' })
  } else {
    target = first
  }

  if (!target.ok) {
    throw new Error(`Twilio media download failed: ${target.status} ${await target.text().catch(() => '')}`)
  }

  const arrayBuf = await target.arrayBuffer()
  const contentType =
    target.headers.get('content-type')
      ?? first.headers.get('content-type')
      ?? 'application/octet-stream'
  return { buffer: Buffer.from(arrayBuf), contentType }
}

// Twilio webhook signature validation per
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
//
// `expectedUrl` MUST be the full, public URL Twilio invoked (proto + host +
// path + query). For x-www-form-urlencoded bodies, params are appended in
// alphabetical order to that URL, then HMAC-SHA1'd with the auth token.
export function validateTwilioSignature(params: {
  expectedUrl: string
  formParams: Record<string, string>
  signatureHeader: string | null
}): boolean {
  const { expectedUrl, formParams, signatureHeader } = params
  if (!signatureHeader) return false
  if (!TWILIO_AUTH_TOKEN) return false

  const sortedKeys = Object.keys(formParams).sort()
  let data = expectedUrl
  for (const k of sortedKeys) data += k + formParams[k]

  const expected = createHmac('sha1', TWILIO_AUTH_TOKEN).update(data, 'utf-8').digest('base64')
  // Constant-time-ish compare; lengths must match for timingSafeEqual.
  if (expected.length !== signatureHeader.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i)
  }
  return mismatch === 0
}

export function phoneToThreadId(from: string): string {
  return from.replace('whatsapp:', '').replace('+', '')
}

export function isTwilioConfigured(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
}
