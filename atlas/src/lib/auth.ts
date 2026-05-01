// Phase 1.10aj — Atlas WhatsApp OTP + opaque session token primitives.
//
// All operations run server-side with the Supabase service role; OTP plaintext
// is never persisted (only its bcrypt hash) and session tokens are stored as
// sha256 hashes so a DB read gives an attacker nothing usable.

import { randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { getSupabaseClient } from './supabase'

// Cost factor 10 ≈ ~80 ms per hash on Railway shared CPU. Plenty for a 6-digit
// numeric secret with a 5-minute expiry and 5-attempt cap.
const BCRYPT_ROUNDS = 10

// OTP lifetime in seconds (used for both DB row expires_at and the response
// payload that tells the UI when to grey out the "Resend" button).
export const OTP_TTL_SECONDS = 5 * 60

// Rate-limit window + ceiling for /atlas/auth/request-otp. 5 OTP requests per
// phone per 15 min protects against accidental spam (and intentional flooding
// of Twilio costs) while leaving room for "I didn't get the message, resend".
export const OTP_RATE_LIMIT_WINDOW_SEC = 15 * 60
export const OTP_RATE_LIMIT_MAX = 5

// Max OTP entry attempts before all OTPs for the phone are forcibly burned and
// the user must request a fresh code.
export const OTP_MAX_ATTEMPTS = 5

export function getAllowedPhones(): string[] {
  const raw = process.env.ATLAS_ALLOWED_PHONES ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isPhoneAllowed(phone: string): boolean {
  const allowed = getAllowedPhones()
  if (allowed.length === 0) return false
  return allowed.includes(phone.trim())
}

// 6-digit numeric OTP. Use rejection sampling against the modulo bias of a
// raw uint32 — over six digits the bias is negligible, but it's free.
export function generateOtpCode(): string {
  let n: number
  do {
    n = randomBytes(4).readUInt32BE(0)
  } while (n >= 0xfffffffc) // discard the top 4 values to keep modulo uniform
  return String(n % 1_000_000).padStart(6, '0')
}

export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS)
}

export async function compareOtp(code: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(code, hash)
  } catch {
    return false
  }
}

// Opaque, URL-safe session token. 32 bytes → 64 hex chars; sha256(token) is
// what we persist, so even a full DB dump can't be replayed against the API.
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// Minimal UA → device-label heuristic. Keeps the /atlas/auth/sessions list
// readable ("logged in on phone, web, tablet") without pulling in a UA-parser
// dependency. Anything we can't classify falls back to 'web'.
export function deviceLabelFromUserAgent(ua: string | undefined | null): string {
  if (!ua) return 'web'
  const lower = ua.toLowerCase()
  if (/(ipad|tablet)/.test(lower)) return 'tablet'
  if (/(iphone|android|mobile)/.test(lower)) return 'phone'
  return 'web'
}

// Count OTP rows created within the rate-limit window. Used by the request-otp
// route to refuse the 6th request inside any rolling 15-minute window.
export async function countRecentOtpRequests(phone: string): Promise<number> {
  const sb = getSupabaseClient()
  if (!sb) return 0
  const since = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_SEC * 1000).toISOString()
  const { count } = await sb
    .from('atlas_otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('created_at', since)
  return count ?? 0
}

export interface OtpRow {
  id: string
  phone: string
  code_hash: string
  expires_at: string
  used_at: string | null
  attempts: number
  created_at: string
}

// Insert a fresh OTP row and return the id. Caller is expected to deliver the
// plaintext code via WhatsApp BEFORE this returns to the client (we never
// echo the code in our own response).
export async function insertOtp(phone: string, code: string): Promise<{ id: string } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const codeHash = await hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString()
  const { data, error } = await sb
    .from('atlas_otp_codes')
    .insert({ phone, code_hash: codeHash, expires_at: expiresAt })
    .select('id')
    .single()
  if (error || !data) return null
  return { id: (data as { id: string }).id }
}

// Find the latest non-used, non-expired OTP for a phone. Returns null if
// either there is no row or the row is past its expires_at.
export async function findActiveOtp(phone: string): Promise<OtpRow | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb
    .from('atlas_otp_codes')
    .select('id, phone, code_hash, expires_at, used_at, attempts, created_at')
    .eq('phone', phone)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const row = data as OtpRow
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  return row
}

// Mark every non-used OTP for this phone as used. Called on rate-limit /
// attempt-cap breach so an attacker who got close can't keep grinding.
export async function burnAllOtpsForPhone(phone: string): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb
    .from('atlas_otp_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('phone', phone)
    .is('used_at', null)
}

export async function incrementOtpAttempts(id: string, current: number): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb.from('atlas_otp_codes').update({ attempts: current + 1 }).eq('id', id)
}

export async function markOtpUsed(id: string): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb
    .from('atlas_otp_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', id)
}

export interface SessionRow {
  id: string
  phone: string
  token_hash: string
  device_label: string | null
  user_agent: string | null
  ip: string | null
  created_at: string
  last_seen_at: string
  revoked_at: string | null
}

// Mint a session: insert the token_hash and surrounding metadata, return the
// caller-issued plaintext token (never persisted).
export async function createSession(params: {
  phone: string
  userAgent?: string
  ip?: string
}): Promise<{ token: string; sessionId: string } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const token = generateSessionToken()
  const tokenHash = sha256(token)
  const deviceLabel = deviceLabelFromUserAgent(params.userAgent)
  const { data, error } = await sb
    .from('atlas_sessions')
    .insert({
      phone: params.phone,
      token_hash: tokenHash,
      device_label: deviceLabel,
      user_agent: params.userAgent ?? null,
      ip: params.ip ?? null,
    })
    .select('id')
    .single()
  if (error || !data) return null
  return { token, sessionId: (data as { id: string }).id }
}

// Look up a session row by its token (we hash and query token_hash). Returns
// null if the row is missing or already revoked.
export async function findSessionByToken(token: string): Promise<SessionRow | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const tokenHash = sha256(token)
  const { data } = await sb
    .from('atlas_sessions')
    .select('id, phone, token_hash, device_label, user_agent, ip, created_at, last_seen_at, revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle()
  if (!data) return null
  return data as SessionRow
}

export async function touchSessionLastSeen(id: string): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb
    .from('atlas_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', id)
}

export async function revokeSession(id: string): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  await sb
    .from('atlas_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
}

export async function listSessionsForPhone(phone: string): Promise<SessionRow[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_sessions')
    .select('id, phone, token_hash, device_label, user_agent, ip, created_at, last_seen_at, revoked_at')
    .eq('phone', phone)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  return (data ?? []) as SessionRow[]
}

// Send the OTP via the V2 WhatsApp Edge Function. We call this rather than
// Twilio directly because Atlas's own Twilio creds are configured for inbound
// dispatch — V2's whatsapp-send function already centralizes outbound auth.
//
// IMPORTANT: We never log the code itself; the only place it is materialized
// is the bcrypt'd row in atlas_otp_codes and the body of the WhatsApp message
// the user receives.
export async function sendOtpViaWhatsApp(phone: string, code: string): Promise<boolean> {
  const url = process.env.ATLAS_WHATSAPP_SEND_URL
    ?? 'https://eywsfmixzrdfcywmdaaw.supabase.co/functions/v1/whatsapp-send'
  const anonKey = process.env.V2_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (anonKey) {
    headers.Authorization = `Bearer ${anonKey}`
    headers.apikey = anonKey
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        body: `Atlas login code: ${code} (valid ${Math.round(OTP_TTL_SECONDS / 60)} min)`,
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[atlas-auth] whatsapp-send returned ${res.status}: ${errText.slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[atlas-auth] whatsapp-send request failed:', err)
    return false
  }
}
