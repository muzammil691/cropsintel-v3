/**
 * Adela runtime config.
 *
 * Most values can be overridden by env vars so deployments don't require code
 * changes. Each ABC_* override is documented in adela/README.md so operators
 * know how to retarget the scraper at a staging mirror or change the User-Agent.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  abc: {
    indexUrl:
      process.env.ABC_INDEX_URL ??
      "https://www.almonds.org/tools-and-resources/crop-reports/position-reports",
    baseUrl: process.env.ABC_BASE_URL ?? "https://www.almonds.org",
    userAgent:
      process.env.ABC_USER_AGENT ??
      "CropsIntel-Adela/1.0 (+https://cropsintel.com; market-intelligence-bot)",
    retryAttempts: intFromEnv("ABC_RETRY_ATTEMPTS", 3),
    retryDelayMs: intFromEnv("ABC_RETRY_DELAY_MS", 2000),
  },

  cron: {
    // Phase 1.00e-rem — abc runs once daily at 06:00 UTC (ABC posts the
    // monthly position report overnight US time, so 06:00 UTC is well after
    // it lands). Strata + news still run on their faster cadences.
    abc: process.env.CRON_ABC ?? "0 6 * * *", // 06:00 UTC daily
    strata: process.env.CRON_STRATA ?? "0 * * * *", // top of every hour
    news: process.env.CRON_NEWS ?? "*/30 * * * *", // every 30 min
  },

  scheduler: {
    // Max times the scheduler will retry a scraper run before dead-lettering
    // to scraper_errors. Each individual fetch in a scraper has its own retry
    // (fetchWithRetry); this is the outer retry around the whole run.
    maxAttempts: intFromEnv("SCHEDULER_MAX_ATTEMPTS", 3),
    retryDelayMs: intFromEnv("SCHEDULER_RETRY_DELAY_MS", 5000),
    // Max time stopScheduler() waits for in-flight jobs to drain on SIGTERM
    // before abandoning them. Railway's default container kill grace is 30s.
    shutdownTimeoutMs: intFromEnv("SCHEDULER_SHUTDOWN_TIMEOUT_MS", 25_000),
  },

  health: {
    port: intFromEnv("PORT", 8080),
  },

  supabase: {
    storageBucket: "adela-raw",
    storagePrefix: "abc",
  },

  gemini: {
    // gemini-1.5-pro returned 404 from v1beta in May 2026; current default is
    // gemini-2.0-flash. Override via GEMINI_MODEL env var.
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    maxRetries: intFromEnv("GEMINI_MAX_RETRIES", 2),
  },
} as const
