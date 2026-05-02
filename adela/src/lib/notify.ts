/**
 * Atlas notification client.
 *
 * Atlas is the runtime-control sibling service (master plan section 9.2 / R3).
 * After every successful scrape, Adela POSTs a small JSON payload to
 * `${ATLAS_URL}/atlas/adela/notify` so Atlas can update its own dashboard
 * and trigger downstream multi-brain debates if the row count is anomalous.
 *
 * If ATLAS_URL is not set, or the endpoint is unreachable, the call logs a
 * warning and resolves — we never want notification failures to block the
 * scraper's own audit + DB writes.
 */

import axios, { type AxiosError } from "axios"

export interface NotifyPayload {
  scraper: string
  rows_inserted: number
  storage_path: string | null
}

const TIMEOUT_MS = 5000

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
        timeout: TIMEOUT_MS,
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
