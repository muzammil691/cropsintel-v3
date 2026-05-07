/**
 * Adela — CropsIntel V3 runtime nervous system (Phase 1.6e)
 *
 * Entry point: starts cron scheduler + lightweight health HTTP server.
 *
 * Required env vars:
 *   SUPABASE_URL (or V3_SUPABASE_URL)
 *   SUPABASE_SERVICE_KEY (or V3_SUPABASE_SECRET_KEY)
 *   GEMINI_API_KEY
 *   ANTHROPIC_API_KEY (for ai-analyst)
 *
 * Optional env vars:
 *   PORT - /health port (default 3001; Railway sets it dynamically)
 */

import http from "http"
import { startScheduler, lastRun } from "./scheduler"

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

console.log("[adela] Starting Adela — CropsIntel V3 runtime nervous system")
console.log("[adela] Time:", new Date().toISOString())

// 1. Start the scheduler (registers all cron jobs)
startScheduler()

// 2. Start the health HTTP server
const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400).end()
    return
  }

  if (req.method === "GET" && (req.url === "/health" || req.url.startsWith("/health?"))) {
    const body = JSON.stringify(
      {
        status: "ok",
        lastRun,
        uptime: process.uptime(),
      },
      null,
      2
    )
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    res.end(body)
    return
  }

  // All other paths return 404
  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found\n")
})

server.listen(PORT, () => {
  console.log(`[adela] Health server listening on port ${PORT}`)
})

console.log("[adela] Adela scheduler started. Health server on port", PORT)

// 3. Keep process alive — never exit on uncaught errors
process.on("uncaughtException", (err) => {
  console.error("[adela] Uncaught exception:", err)
})

process.on("unhandledRejection", (reason) => {
  console.error("[adela] Unhandled rejection:", reason)
})
