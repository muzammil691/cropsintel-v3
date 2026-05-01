// Phase 1.10aj — Atlas WhatsApp OTP + opaque session token primitives.
// Phase 1.10ao — env-var allowlist replaced with DB-backed atlas_members
// table; sessions cache role at issue-time and are revoked on role change.
//
// All operations run server-side with the Supabase service role; OTP plaintext
// is never persisted (only its bcrypt hash) and session tokens are stored as
// sha256 hashes so a DB read gives an attacker nothing usable.

import { randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { getSupabaseClient } from './supabase'
import { sendWhatsAppReply } from './twilio'

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

// Roles + ranks. Higher rank includes lower-rank capabilities.
export type Role = 'owner' | 'admin' | 'operator' | 'viewer'

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
}

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

// Result of looking up whether a phone may sign in. The "pending_invite"
// branch lets the OTP request flow surface a useful UX hint without granting
// access until the OTP itself is verified.
export type PhoneAllowResult =
  | { allowed: true; role: Role; memberId: string }
  | { allowed: false; reason: 'pending_invite'; inviteId: string; role: Role }
  | { allowed: false; reason: 'suspended' | 'revoked' | 'not_invited' }

interface MemberRow {
  id: string
  phone: string
  role: Role
  status: 'active' | 'suspended' | 'revoked'
}

interface InviteRow {
  id: string
  phone: string
  role: 'admin' | 'operator' | 'viewer'
  display_name: string | null
  invited_by: string
  invite_token: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
}

export async function isPhoneAllowed(phone: string): Promise<PhoneAllowResult> {
  const sb = getSupabaseClient()
  if (!sb) return { allowed: false, reason: 'not_invited' }

  const trimmed = phone.trim()

  // 1. Check for an active member.
  const { data: memberRow } = await sb
    .from('atlas_members')
    .select('id, phone, role, status')
    .eq('phone', trimmed)
    .maybeSingle()

  if (memberRow) {
    const m = memberRow as MemberRow
    if (m.status === 'active') {
      return { allowed: true, role: m.role, memberId: m.id }
    }
    if (m.status === 'suspended') return { allowed: false, reason: 'suspended' }
    if (m.status === 'revoked') return { allowed: false, reason: 'revoked' }
  }

  // 2. No active member — look for a usable invite (unconsumed, unrevoked, unexpired).
  const nowIso = new Date().toISOString()
  const { data: inviteRow } = await sb
    .from('atlas_invites')
    .select('id, phone, role, display_name, invited_by, invite_token, expires_at, consumed_at, revoked_at')
    .eq('phone', trimmed)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (inviteRow) {
    const inv = inviteRow as InviteRow
    return { allowed: false, reason: 'pending_invite', inviteId: inv.id, role: inv.role }
  }

  return { allowed: false, reason: 'not_invited' }
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
  role: Role | null
  member_id: string | null
}

// Mint a session: insert the token_hash and surrounding metadata, return the
// caller-issued plaintext token (never persisted). The role is cached on the
// session row so we don't have to JOIN to atlas_members on every authenticated
// request — change-of-role explicitly revokes all sessions.
export async function createSession(params: {
  phone: string
  memberId: string
  role: Role
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
      member_id: params.memberId,
      role: params.role,
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
    .select('id, phone, token_hash, device_label, user_agent, ip, created_at, last_seen_at, revoked_at, role, member_id')
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

// Revoke every active session for a member. Called on role change or status
// change so the new role takes effect on next login (the cached role on the
// existing tokens would otherwise stay stale).
export async function revokeAllSessionsForMember(memberId: string): Promise<number> {
  const sb = getSupabaseClient()
  if (!sb) return 0
  const { data } = await sb
    .from('atlas_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('member_id', memberId)
    .is('revoked_at', null)
    .select('id')
  return Array.isArray(data) ? data.length : 0
}

export async function listSessionsForPhone(phone: string): Promise<SessionRow[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_sessions')
    .select('id, phone, token_hash, device_label, user_agent, ip, created_at, last_seen_at, revoked_at, role, member_id')
    .eq('phone', phone)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  return (data ?? []) as SessionRow[]
}

// Touch a member's last_seen_at; on first ever login, also stamp first_login_at.
export async function touchMemberLogin(memberId: string): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  const nowIso = new Date().toISOString()
  // Read first_login_at to know if we should set it.
  const { data } = await sb
    .from('atlas_members')
    .select('first_login_at')
    .eq('id', memberId)
    .maybeSingle()
  const update: Record<string, string> = { last_seen_at: nowIso, updated_at: nowIso }
  if (!data || !(data as { first_login_at: string | null }).first_login_at) {
    update.first_login_at = nowIso
  }
  await sb.from('atlas_members').update(update).eq('id', memberId)
}

// Atomic invite-consume + member-create on first login. The invite has been
// validated (unconsumed, unrevoked, unexpired, phone matches) by the caller.
export async function consumeInviteAndCreateMember(params: {
  inviteId: string
  phone: string
  role: 'admin' | 'operator' | 'viewer'
  displayName: string | null
  invitedBy: string
}): Promise<{ memberId: string } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const nowIso = new Date().toISOString()
  // Insert the new member row first.
  const { data: memberRow, error: memberErr } = await sb
    .from('atlas_members')
    .insert({
      phone: params.phone,
      display_name: params.displayName,
      role: params.role,
      status: 'active',
      invited_by: params.invitedBy,
      invited_at: nowIso,
      first_login_at: nowIso,
      last_seen_at: nowIso,
    })
    .select('id')
    .single()
  if (memberErr || !memberRow) return null
  const memberId = (memberRow as { id: string }).id

  // Mark the invite consumed. If the update fails we still have the member;
  // returning the id is more important than the audit completeness here.
  await sb
    .from('atlas_invites')
    .update({ consumed_at: nowIso })
    .eq('id', params.inviteId)

  return { memberId }
}

// Send the OTP via the V2 WhatsApp Edge Function. We call this rather than
// Twilio directly because Atlas's own Twilio creds are configured for inbound
// dispatch — V2's whatsapp-send function already centralizes outbound auth.
//
// IMPORTANT: We never log the code itself; the only place it is materialized
// is the bcrypt'd row in atlas_otp_codes and the body of the WhatsApp message
// the user receives.
export async function sendOtpViaWhatsApp(phone: string, code: string): Promise<boolean> {
  // Atlas already has TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM
  // for the conductor's WhatsApp pings — reuse that path instead of routing through
  // V2's whatsapp-send Edge Function (which would need a V2 anon key we don't ship).
  const body = `Atlas login code: ${code} (valid ${Math.round(OTP_TTL_SECONDS / 60)} min). If you didn't request this, ignore.`
  try {
    const result = await sendWhatsAppReply(phone, body)
    if ('error' in result) {
      console.error(`[atlas-auth] sendWhatsAppReply failed: ${result.error}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[atlas-auth] sendWhatsAppReply threw:', err)
    return false
  }
}
