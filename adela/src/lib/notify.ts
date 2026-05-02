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
  const base = process.env.ATLAS_URL
  if (!base) {
    console.warn("[notify] ATLAS_URL not set — skipping Atlas notification:", payload)
    return
  }

  const url = `${base.replace(/\/+$/, "")}/atlas/adela/notify`

  try {
    const res = await axios.post(url, payload, {
      timeout: TIMEOUT_MS,
      headers: { "content-type": "application/json" },
    })
    console.log(`[notify] Atlas notified (${res.status}):`, payload)
  } catch (err) {
    const ax = err as AxiosError
    const status = ax.response?.status ?? "no-response"
    const body = ax.response?.data ?? ax.message
    console.warn(`[notify] Atlas notify failed (${status}):`, body)
  }
}
