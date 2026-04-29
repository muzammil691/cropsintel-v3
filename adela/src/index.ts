/**
 * Adela — CropsIntel V3 runtime nervous system
 * Entrypoint: starts cron scheduler and keeps the process alive.
 *
 * Required env vars:
 *   V3_SUPABASE_URL         - https://hzrnohsxigrqlmzegwlb.supabase.co
 *   V3_SUPABASE_SECRET_KEY  - sb_secret_... (Supabase new key format)
 *   GEMINI_API_KEY          - Google AI Studio key
 *   TWILIO_ACCOUNT_SID      - for WhatsApp notifications
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM    - "whatsapp:+12345622692"
 *   TWILIO_WHATSAPP_TO      - "whatsapp:+971562556592"
 */

import { startScheduler } from "./scheduler.js"
import { notifyWhatsApp } from "./notify.js"

console.log("[adela] Starting Adela v1.0 — CropsIntel runtime nervous system")
console.log("[adela] Time:", new Date().toISOString())

// Start all cron jobs
startScheduler()

// Startup notification
notifyWhatsApp("🤖 Adela online. Cron jobs registered. Scraping almonds.org daily at 06:00 UTC.").catch(
  (err) => console.warn("[adela] Startup notification failed:", err)
)

// Keep process alive (cron library handles the loop internally, but we prevent exit)
process.on("uncaughtException", (err) => {
  console.error("[adela] Uncaught exception:", err)
  // Do not exit — stay running
})

process.on("unhandledRejection", (reason) => {
  console.error("[adela] Unhandled rejection:", reason)
  // Do not exit — stay running
})

console.log("[adela] Ready. Waiting for scheduled jobs...")
