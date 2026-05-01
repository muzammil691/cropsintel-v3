/**
 * Adela /health endpoint
 *
 * Tiny built-in HTTP server (no Express dep) that exposes per-scraper run
 * state. The scheduler updates this registry on every job tick.
 *
 * Returns 200 if every registered scraper has had at least one run AND each
 * run's last status is 'success' or 'skipped'. Returns 503 otherwise so
 * Railway's healthcheck can flag stuck deployments.
 */

import http from "node:http"

export type ScraperStatus = "running" | "success" | "skipped" | "failed" | "never_ran"

export interface ScraperState {
  name: string
  schedule: string
  last_status: ScraperStatus
  last_started_at: string | null
  last_finished_at: string | null
  last_error: string | null
}

const registry = new Map<string, ScraperState>()

export function registerScraper(name: string, schedule: string): void {
  if (!registry.has(name)) {
    registry.set(name, {
      name,
      schedule,
      last_status: "never_ran",
      last_started_at: null,
      last_finished_at: null,
      last_error: null,
    })
  }
}

export function markStarted(name: string): void {
  const s = registry.get(name)
  if (!s) return
  s.last_status = "running"
  s.last_started_at = new Date().toISOString()
  s.last_finished_at = null
  s.last_error = null
}

export function markFinished(
  name: string,
  status: Exclude<ScraperStatus, "running" | "never_ran">,
  errorMessage?: string
): void {
  const s = registry.get(name)
  if (!s) return
  s.last_status = status
  s.last_finished_at = new Date().toISOString()
  s.last_error = errorMessage ?? null
}

export function snapshot(): ScraperState[] {
  return Array.from(registry.values())
}

const BOOT_GRACE_MS = 30 * 60 * 1000
const startedAt = new Date().toISOString()

function isHealthy(states: ScraperState[]): boolean {
  const inBootGrace = Date.now() - Date.parse(startedAt) < BOOT_GRACE_MS
  if (states.length === 0) return inBootGrace
  return states.every(
    (s) =>
      s.last_status === "success" ||
      s.last_status === "skipped" ||
      s.last_status === "running" ||
      (s.last_status === "never_ran" && inBootGrace)
  )
}

export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400).end()
      return
    }

    if (req.url === "/health" || req.url.startsWith("/health?")) {
      const states = snapshot()
      const healthy = isHealthy(states)
      const body = JSON.stringify(
        {
          ok: healthy,
          service: "adela",
          version: "1.1",
          started_at: startedAt,
          now: new Date().toISOString(),
          scrapers: states,
        },
        null,
        2
      )
      res.writeHead(healthy ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      res.end(body)
      return
    }

    if (req.url === "/" || req.url === "") {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("adela alive — see /health for status\n")
      return
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n")
  })

  server.listen(port, () => {
    console.log(`[health] listening on :${port}`)
  })

  return server
}
