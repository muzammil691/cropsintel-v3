/**
 * Adela notification wrappers.
 *
 * Two responsibilities live in this module per phase-1.00e-rem:
 *
 *   1. notifyAtlas(payload)
 *      POSTs the scrape summary to Atlas (master plan §9.2 / R3) so the
 *      runtime-control sibling service can update its dashboard and trigger
 *      multi-brain debates if the row count looks anomalous.
 *
 *   2. notify({ event_type, message, payload })
 *      Sends a WhatsApp notification via Twilio AND inserts an audit row into
 *      `adela_events` so the team admin UI can replay every event Adela
 *      emitted. Both side effects are best-effort: a WhatsApp failure does
 *      NOT block the DB insert and vice versa.
 *
 * Neither function ever throws — Adela's scraper pipeline must complete its
 * own audit + DB writes regardless of notification outcome.
 */

import axios, { type AxiosError } from "axios"
import { supabase } from "./supabase.js"

// ---------------------------------------------------------------------------
// Atlas notifier
// ---------------------------------------------------------------------------
export interface NotifyPayload {
  scraper: string
  rows_inserted: number
  storage_path: string | null
}

const ATLAS_TIMEOUT_MS = 5000

export async function notifyAtlas(payload: NotifyPayload): Promise<void> {
  // ATLAS_NOTIFY_URL is the canonical full endpoint URL (per phase-1.00e-rem
  // spec). ATLAS_URL is the legacy base form — when set, the path is appended.
  const explicit = process.env.ATLAS_NOTIFY_URL
  const base = process.env.ATLAS_URL
  let url: string
  if (explicit) {
    url = explicit
  } else if (base) {
    url = `${base.replace(/\/+$/, "")}/atlas/adela/notify`
  } else {
    console.warn(
      "[notify] Neither ATLAS_NOTIFY_URL nor ATLAS_URL set — skipping Atlas notification:",
      payload
    )
    return
  }

  // Retry once on failure per phase-1.00e-rem spec. Never block the scraper —
  // both attempts are wrapped; the second failure is logged and swallowed.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        timeout: ATLAS_TIMEOUT_MS,
        headers: { "content-type": "application/json" },
      })
      console.log(`[notify] Atlas notified (${res.status}):`, payload)
      return
    } catch (err) {
      const ax = err as AxiosError
      const status = ax.response?.status ?? "no-response"
      const body = ax.response?.data ?? ax.message
      if (attempt === 1) {
        console.warn(`[notify] Atlas notify attempt 1 failed (${status}), retrying:`, body)
        continue
      }
      console.warn(`[notify] Atlas notify failed after retry (${status}):`, body)
    }
  }
}

// ---------------------------------------------------------------------------
// WhatsApp + adela_events notifier (phase-1.00e-rem)
// ---------------------------------------------------------------------------
export interface NotifyEvent {
  scraper?: string
  event_type: string
  message: string
  payload?: Record<string, unknown>
}

/**
 * Send a WhatsApp message via Twilio AND insert an `adela_events` row.
 *
 * Both sides are best-effort. If Twilio creds are absent we log and skip the
 * WhatsApp leg. If the DB insert fails we log and continue. The function never
 * throws — scrapers are not coupled to notifier success.
 */
export async function notify(event: NotifyEvent): Promise<void> {
  // 1. WhatsApp via Twilio (skipped silently when not configured)
  await sendWhatsApp(event.message)

  // 2. Audit row in adela_events
  const { error } = await supabase.from("adela_events").insert({
    scraper: event.scraper ?? null,
    event_type: event.event_type,
    message: event.message,
    payload: event.payload ?? {},
  })
  if (error) {
    console.warn("[notify] adela_events insert failed (non-fatal):", error.message)
  }
}

async function sendWhatsApp(message: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM
  const to = process.env.TWILIO_WHATSAPP_TO

  if (!sid || !token || !from || !to) {
    console.warn("[notify] Twilio not configured — message logged only:", message)
    return
  }

  const body = new URLSearchParams({ From: from, To: to, Body: message })
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      console.warn("[notify] Twilio WhatsApp failed:", res.status, text)
    } else {
      console.log("[notify] WhatsApp sent:", message)
    }
  } catch (err) {
    console.warn("[notify] Twilio WhatsApp threw:", err)
  }
}
