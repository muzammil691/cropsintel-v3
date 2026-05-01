// Phase 1.10ao — Atlas team management helpers.
//
// Backs the /atlas/team/* HTTP routes. All ops use the Supabase service role.
// Role-change and revoke paths must call revokeAllSessionsForMember from auth.ts
// so the cached role on existing tokens cannot drift; this module always does
// that on its own and audit-logs the action.

import { randomBytes } from 'crypto'
import { getSupabaseClient } from './supabase'
import { revokeAllSessionsForMember, type Role } from './auth'
import { sendWhatsAppReply } from './twilio'

// 7-day expiry for invite tokens. Long enough that a Sunday-evening invite
// doesn't expire before the user reads it; short enough to limit blast
// radius if a token leaks via a screenshot.
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

// 32 bytes → 64 hex chars; URL-safe (hex only) so it goes into a query
// param without encoding surprises.
export function generateInviteToken(): string {
  return randomBytes(32).toString('hex')
}

export interface MemberRecord {
  id: string
  phone: string
  display_name: string | null
  role: Role
  status: 'active' | 'suspended' | 'revoked'
  invited_by: string | null
  invited_at: string
  first_login_at: string | null
  last_seen_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InviteRecord {
  id: string
  phone: string
  role: 'admin' | 'operator' | 'viewer'
  display_name: string | null
  invited_by: string
  invite_token: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface MemberWithStats extends MemberRecord {
  active_session_count: number
}

export async function listMembers(): Promise<MemberWithStats[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data: members } = await sb
    .from('atlas_members')
    .select('*')
    .order('role', { ascending: false })
    .order('created_at', { ascending: true })
  if (!members) return []

  // Count active sessions per member in a single query, group client-side.
  const { data: sessions } = await sb
    .from('atlas_sessions')
    .select('member_id')
    .is('revoked_at', null)
  const sessionsByMember = new Map<string, number>()
  for (const row of (sessions ?? []) as Array<{ member_id: string | null }>) {
    if (!row.member_id) continue
    sessionsByMember.set(row.member_id, (sessionsByMember.get(row.member_id) ?? 0) + 1)
  }

  return (members as MemberRecord[]).map((m) => ({
    ...m,
    active_session_count: sessionsByMember.get(m.id) ?? 0,
  }))
}

export async function listPendingInvites(): Promise<InviteRecord[]> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_invites')
    .select('*')
    .is('consumed_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  return (data ?? []) as InviteRecord[]
}

// Idempotent invite: if an unconsumed/unrevoked invite for this phone already
// exists, regenerate the token + extend expiry instead of inserting a duplicate.
export async function createOrRefreshInvite(params: {
  phone: string
  role: 'admin' | 'operator' | 'viewer'
  displayName: string | null
  invitedBy: string
}): Promise<{ invite: InviteRecord; isNew: boolean } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString()
  const newToken = generateInviteToken()

  // Look for existing usable row first.
  const { data: existing } = await sb
    .from('atlas_invites')
    .select('id')
    .eq('phone', params.phone)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const existingId = (existing as { id: string }).id
    const { data: updated, error } = await sb
      .from('atlas_invites')
      .update({
        invite_token: newToken,
        expires_at: expiresAt,
        role: params.role,
        display_name: params.displayName,
        invited_by: params.invitedBy,
      })
      .eq('id', existingId)
      .select('*')
      .single()
    if (error || !updated) return null
    return { invite: updated as InviteRecord, isNew: false }
  }

  const { data: inserted, error } = await sb
    .from('atlas_invites')
    .insert({
      phone: params.phone,
      role: params.role,
      display_name: params.displayName,
      invited_by: params.invitedBy,
      invite_token: newToken,
      expires_at: expiresAt,
      created_at: nowIso,
    })
    .select('*')
    .single()
  if (error || !inserted) return null
  return { invite: inserted as InviteRecord, isNew: true }
}

export async function revokeInvite(inviteId: string): Promise<InviteRecord | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data, error } = await sb
    .from('atlas_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .is('consumed_at', null)
    .is('revoked_at', null)
    .select('*')
    .single()
  if (error || !data) return null
  return data as InviteRecord
}

export async function getMember(id: string): Promise<MemberRecord | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb.from('atlas_members').select('*').eq('id', id).maybeSingle()
  return data ? (data as MemberRecord) : null
}

export async function getInvite(id: string): Promise<InviteRecord | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const { data } = await sb.from('atlas_invites').select('*').eq('id', id).maybeSingle()
  return data ? (data as InviteRecord) : null
}

// PATCH a member. Owner cannot be demoted/revoked through this path
// (caller enforces; see server.ts). On role-change or status flip away
// from 'active', we revoke ALL sessions so the next request forces re-auth.
export async function updateMember(params: {
  id: string
  role?: Role
  displayName?: string | null
  status?: 'active' | 'suspended' | 'revoked'
  notes?: string | null
}): Promise<{ member: MemberRecord; sessionsRevoked: number } | null> {
  const sb = getSupabaseClient()
  if (!sb) return null
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (params.role !== undefined) update.role = params.role
  if (params.displayName !== undefined) update.display_name = params.displayName
  if (params.status !== undefined) update.status = params.status
  if (params.notes !== undefined) update.notes = params.notes

  const { data, error } = await sb
    .from('atlas_members')
    .update(update)
    .eq('id', params.id)
    .select('*')
    .single()
  if (error || !data) return null
  const member = data as MemberRecord

  // If role changed OR status moved to suspended/revoked, revoke sessions.
  let sessionsRevoked = 0
  const shouldRevoke =
    params.role !== undefined ||
    (params.status !== undefined && params.status !== 'active')
  if (shouldRevoke) {
    sessionsRevoked = await revokeAllSessionsForMember(member.id)
  }
  return { member, sessionsRevoked }
}

// Audit-log helper. Best-effort — we don't want a DB write hiccup to block
// the team-management action that triggered the log.
export async function recordTeamAudit(params: {
  actorId: string
  actorPhone: string
  action: string
  targetMemberId?: string | null
  targetInviteId?: string | null
  targetPhone?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  const sb = getSupabaseClient()
  if (!sb) return
  try {
    await sb.from('atlas_team_audit').insert({
      actor_id: params.actorId,
      actor_phone: params.actorPhone,
      action: params.action,
      target_member_id: params.targetMemberId ?? null,
      target_invite_id: params.targetInviteId ?? null,
      target_phone: params.targetPhone ?? null,
      details: params.details ?? null,
    })
  } catch (err) {
    console.warn('[atlas-team-audit] insert failed:', err)
  }
}

export async function listTeamAudit(limit = 100): Promise<Array<{
  id: string
  actor_id: string | null
  actor_phone: string | null
  action: string
  target_member_id: string | null
  target_invite_id: string | null
  target_phone: string | null
  details: Record<string, unknown> | null
  created_at: string
}>> {
  const sb = getSupabaseClient()
  if (!sb) return []
  const { data } = await sb
    .from('atlas_team_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as Array<{
    id: string
    actor_id: string | null
    actor_phone: string | null
    action: string
    target_member_id: string | null
    target_invite_id: string | null
    target_phone: string | null
    details: Record<string, unknown> | null
    created_at: string
  }>
}

// Build the public invite URL the WhatsApp message points the invitee at.
// The browser side reads `?invite=<token>` to prefill the phone number and
// hint to the user that they need an OTP to claim it.
export function buildInviteUrl(token: string): string {
  const base = process.env.ATLAS_DASHBOARD_URL ?? 'https://muzammil691.github.io/atlas'
  return `${base}/login?invite=${encodeURIComponent(token)}`
}

// Send the invite WhatsApp. Best-effort; the caller has already inserted
// the row, so if WhatsApp fails the owner can re-issue via "resend".
export async function sendInviteWhatsApp(params: {
  phone: string
  role: Role
  inviterName: string
  token: string
}): Promise<boolean> {
  const url = buildInviteUrl(params.token)
  const body =
    `You've been invited to Atlas (CropsIntel) by ${params.inviterName} with role ${params.role}. ` +
    `Open ${url} and request a code with this number.`
  const result = await sendWhatsAppReply(params.phone, body)
  if ('error' in result) {
    console.error('[atlas-team] invite WhatsApp send failed:', result.error)
    return false
  }
  return true
}

export async function sendInviteRevokedWhatsApp(phone: string): Promise<boolean> {
  const body = 'Your invite to Atlas (CropsIntel) was revoked. If this was a mistake, ask the owner to re-invite you.'
  const result = await sendWhatsAppReply(phone, body)
  if ('error' in result) {
    console.error('[atlas-team] invite-revoked WhatsApp send failed:', result.error)
    return false
  }
  return true
}

// Send a "request elevation" WhatsApp ping to the owner. Used when a viewer
// or operator hits a tool gated by a higher role and clicks "Request elevation
// from owner" in the artifact card.
export async function sendElevationRequestWhatsApp(params: {
  ownerPhone: string
  requesterPhone: string
  requesterDisplayName: string | null
  tool: string
  requiredRole: Role
}): Promise<boolean> {
  const who = params.requesterDisplayName ?? params.requesterPhone
  const body =
    `Atlas elevation request: ${who} (${params.requesterPhone}) tried to invoke ` +
    `\`${params.tool}\` which requires role ${params.requiredRole}. ` +
    `Reply on the Atlas dashboard to grant or deny.`
  const result = await sendWhatsAppReply(params.ownerPhone, body)
  if ('error' in result) {
    console.error('[atlas-team] elevation-request WhatsApp send failed:', result.error)
    return false
  }
  return true
}
