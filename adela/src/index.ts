/**
 * Adela — CropsIntel V3 runtime nervous system
 * Entrypoint: starts cron scheduler + /health HTTP server, then keeps the
 * process alive.
 *
 * Required env vars:
 *   V3_SUPABASE_URL         - https://hzrnohsxigrqlmzegwlb.supabase.co
 *   V3_SUPABASE_SECRET_KEY  - sb_secret_... (Supabase new key format)
 *   GEMINI_API_KEY          - Google AI Studio key
 *
 * Optional env vars:
 *   PORT                    - /health port (default 8080; Railway sets it)
 *   CRON_ABC                - override default ABC cron ("*​/15 * * * *")
 *   CRON_STRATA             - override default Strata cron ("0 * * * *")
 *   CRON_NEWS               - override default news cron ("*​/30 * * * *")
 *   STRATA_BASE_URL         - Strata host; absent → strata scraper skips
 *   STRATA_USERNAME
 *   STRATA_PASSWORD
 *   NEWS_FEEDS              - comma-separated RSS/Atom feed URLs
 *   TWILIO_ACCOUNT_SID      - WhatsApp notifications (optional)
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM
 *   TWILIO_WHATSAPP_TO
 */

import { startScheduler } from "./scheduler"
import { notifyWhatsApp } from "./notify"
import { startHealthServer } from "./health"
import { config } from "./config"

console.log("[adela] Starting Adela v1.1 — CropsIntel runtime nervous system")
console.log("[adela] Time:", new Date().toISOString())

// 1. Start the /health HTTP server (Railway expects this on $PORT)
startHealthServer(config.health.port)

// 2. Register and start cron jobs
startScheduler()

// 3. Startup notification (non-fatal if Twilio not configured).
// Keep this message in sync with the matching block in adela/README.md.
const STARTUP_MESSAGE = "🤖 Adela v1.1 online. Cron jobs registered. ABC scrape at 06:00 UTC daily."

notifyWhatsApp(STARTUP_MESSAGE).catch((err) =>
  console.warn("[adela] Startup notification failed:", err)
)

// 4. Keep process alive — never exit on uncaught errors
process.on("uncaughtException", (err) => {
  console.error("[adela] Uncaught exception:", err)
})

process.on("unhandledRejection", (reason) => {
  console.error("[adela] Unhandled rejection:", reason)
})

console.log("[adela] Ready. Scheduler armed; health server up.")
