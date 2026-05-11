// Session 5 — Verifier pause/resume dialog controller.
//
// Owns the lifecycle of `atlas_dispatches.builder_pause_token`:
//   • pauseBuilder  — sets the token + dispatches a WhatsApp alert so the
//                      operator can decide RESUME / ABORT without opening the
//                      cockpit.
//   • resumeBuilder — clears the token; the builder loop resumes on the next
//                      poll tick.
//   • abortBuilder  — clears the token AND transitions status to 'aborted'.
//
// WhatsApp dispatch reuses sendWhatsAppReply from ./twilio (same Twilio
// account/auth as the existing OTP edge function, but in-process so we
// bypass the OTP-specific rate limits + log to atlas_events instead of
// whatsapp_otp_logs). The build prompt cites the edge function as the
// reference path — same Twilio leg, different table for alert telemetry.
//
// Alert phone is configurable via VERIFIER_ALERT_PHONE; the default falls
// back to the operator number from the Session 5 build prompt.

import { getSupabaseClient } from './supabase'
import { sendWhatsAppReply } from './twilio'

const DEFAULT_ALERT_PHONE = '+971562556592'

export interface PauseBuilderResult {
  ok: boolean
  pauseToken?: string
  whatsappSid?: string
  whatsappError?: string
  reason?: string
}

export interface ResumeBuilderResult {
  ok: boolean
  reason?: string
}

/**
 * Pause a running dispatch.
 *
 * Idempotent: if the row already has a non-null builder_pause_token, returns
 * the existing token and does NOT re-send the WhatsApp message.
 */
export async function pauseBuilder(
  dispatchId: string,
  reason: string,
  paths: string[],
): Promise<PauseBuilderResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'supabase client unavailable' }

  const { data: existing, error: readErr } = await sb
    .from('atlas_dispatches')
    .select('id, status, builder_pause_token')
    .eq('id', dispatchId)
    .maybeSingle()
  if (readErr) return { ok: false, reason: `dispatch lookup failed: ${readErr.message}` }
  if (!existing) return { ok: false, reason: `dispatch ${dispatchId} not found` }
  if ((existing as { builder_pause_token?: string | null }).builder_pause_token) {
    return {
      ok: true,
      pauseToken: (existing as { builder_pause_token: string }).builder_pause_token,
      reason: 'already paused — no-op',
    }
  }

  const pauseToken = makePauseToken()
  const { error: writeErr } = await sb
    .from('atlas_dispatches')
    .update({ builder_pause_token: pauseToken })
    .eq('id', dispatchId)
  if (writeErr) return { ok: false, reason: `set pause token failed: ${writeErr.message}` }

  const phone = process.env.VERIFIER_ALERT_PHONE
    ?? process.env.ATLAS_ALERT_PHONE
    ?? DEFAULT_ALERT_PHONE
  const message = formatWhatsAppAlert({ reason, paths })

  let whatsappSid: string | undefined
  let whatsappError: string | undefined
  try {
    const sendResult = await sendWhatsAppReply(phone, message)
    if ('error' in sendResult) whatsappError = sendResult.error
    else whatsappSid = sendResult.sid
  } catch (err) {
    whatsappError = err instanceof Error ? err.message : String(err)
  }

  // Audit log — best-effort. The pause is durable in atlas_dispatches; this
  // row is only for surfacing the alert in admin tooling.
  try {
    await sb.from('atlas_events').insert({
      event_type: 'verifier_dialog_pause',
      event_category: 'atlas',
      source: 'verifier-dialog',
      severity: 'warning',
      description: `Builder paused: ${reason.slice(0, 200)}`,
      metadata: {
        dispatch_id: dispatchId,
        pause_token: pauseToken,
        paths,
        whatsapp_sid: whatsappSid ?? null,
        whatsapp_error: whatsappError ?? null,
        alert_phone_redacted: phone.replace(/\d(?=\d{4})/g, '*'),
      },
    })
  } catch {
    // Telemetry never breaks the control path.
  }

  return { ok: true, pauseToken, whatsappSid, whatsappError }
}

/** Clear the pause token. Status stays 'building' — the loop picks it up. */
export async function resumeBuilder(dispatchId: string): Promise<ResumeBuilderResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'supabase client unavailable' }

  const { error } = await sb
    .from('atlas_dispatches')
    .update({ builder_pause_token: null })
    .eq('id', dispatchId)
  if (error) return { ok: false, reason: `clear pause token failed: ${error.message}` }

  try {
    await sb.from('atlas_events').insert({
      event_type: 'verifier_dialog_resume',
      event_category: 'atlas',
      source: 'verifier-dialog',
      severity: 'info',
      description: `Builder resumed`,
      metadata: { dispatch_id: dispatchId },
    })
  } catch {
    // ignore
  }

  return { ok: true }
}

/** Clear the pause token AND mark the dispatch aborted. */
export async function abortBuilder(dispatchId: string, reason?: string): Promise<ResumeBuilderResult> {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, reason: 'supabase client unavailable' }

  const { error } = await sb
    .from('atlas_dispatches')
    .update({
      builder_pause_token: null,
      status: 'aborted',
      error_message: reason ?? 'Aborted via Verifier dialog',
    })
    .eq('id', dispatchId)
  if (error) return { ok: false, reason: `abort failed: ${error.message}` }

  try {
    await sb.from('atlas_events').insert({
      event_type: 'verifier_dialog_abort',
      event_category: 'atlas',
      source: 'verifier-dialog',
      severity: 'warning',
      description: `Builder aborted: ${(reason ?? '').slice(0, 200)}`,
      metadata: { dispatch_id: dispatchId, reason: reason ?? null },
    })
  } catch {
    // ignore
  }

  return { ok: true }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makePauseToken(): string {
  // 16 hex chars is enough entropy for a per-dispatch lock; not a security token.
  const bytes = new Uint8Array(8)
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return `pause_${Date.now()}_${hex}`
}

function formatWhatsAppAlert(args: { reason: string; paths: string[] }): string {
  const pathList = args.paths.length > 0
    ? args.paths.map((p, i) => `${i + 1}. ${p}`).join(' / ')
    : 'RESUME / ABORT'
  return `[Atlas Verifier] Build paused: ${args.reason}. Options: ${pathList}. Reply RESUME or ABORT.`
}
